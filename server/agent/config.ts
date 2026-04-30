import { join } from "path";
import { homedir, tmpdir } from "os";
import type { Role } from "../../src/config/roles.js";
import { mcpTools, isMcpToolEnabled } from "./mcp-tools/index.js";
import { MCP_PLUGIN_NAMES } from "./plugin-names.js";
import type { McpServerSpec } from "../system/config.js";
import { getCurrentToken } from "../api/auth/token.js";
import type { Attachment } from "@mulmobridge/protocol";
import { isImageMime, isNativeAttachmentMime } from "@mulmobridge/client";
import { convertAttachment } from "./attachmentConverter.js";
import { log } from "../system/logger/index.js";

export const CONTAINER_WORKSPACE_PATH = "/home/node/mulmoclaude";

const BASE_ALLOWED_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "WebSearch"];

const MCP_PLUGINS = new Set([...MCP_PLUGIN_NAMES, ...mcpTools.filter(isMcpToolEnabled).map((toolDef) => toolDef.definition.name)]);

export function getActivePlugins(role: Role): string[] {
  return role.availablePlugins.filter((pluginName) => MCP_PLUGINS.has(pluginName));
}

export interface McpConfigParams {
  /** Stable chat session ID (not the per-run UUID). Used as SESSION_ID
   *  env var so the MCP server's /internal/* callbacks address the
   *  session store by chatSessionId. */
  chatSessionId: string;
  port: number;
  activePlugins: string[];
  roleIds: string[];
  useDocker?: boolean;
  // User-defined MCP servers from <workspace>/config/mcp.json.
  // Keys become the server id in the generated --mcp-config file;
  // values are the standard Claude CLI server spec (HTTP or stdio).
  userServers?: Record<string, McpServerSpec>;
}

// In Docker mode the sandbox container can't reach the host's
// `localhost` / `127.0.0.1` — those refer to the container's own
// loopback interface. Rewriting to `host.docker.internal` keeps
// user-configured local MCP servers reachable.
export function rewriteLocalhostForDocker(url: string, useDocker: boolean): string {
  if (!useDocker) return url;
  return url.replace(/^(https?:\/\/)(localhost|127\.0\.0\.1)(?=[:/]|$)/, "$1host.docker.internal");
}

function prepareUserHttpServer(spec: Extract<McpServerSpec, { type: "http" }>, useDocker: boolean): McpServerSpec {
  return {
    ...spec,
    url: rewriteLocalhostForDocker(spec.url, useDocker),
  };
}

// Rewrite stdio args so paths that point inside the host workspace are
// translated to their container equivalents. Paths outside the
// workspace are left alone — the caller surfaces a warning in the UI
// before they get this far.
function prepareUserStdioServer(spec: Extract<McpServerSpec, { type: "stdio" }>, useDocker: boolean, hostWorkspacePath: string): McpServerSpec {
  if (!useDocker) return spec;
  const normalisedWs = hostWorkspacePath.endsWith("/") ? hostWorkspacePath : `${hostWorkspacePath}/`;
  const args = spec.args?.map((arg) => {
    if (arg === hostWorkspacePath) return CONTAINER_WORKSPACE_PATH;
    if (arg.startsWith(normalisedWs)) {
      const rel = arg.slice(normalisedWs.length);
      return `${CONTAINER_WORKSPACE_PATH}/${rel}`;
    }
    return arg;
  });
  return { ...spec, args };
}

export function prepareUserServers(userServers: Record<string, McpServerSpec>, useDocker: boolean, hostWorkspacePath: string): Record<string, McpServerSpec> {
  const out: Record<string, McpServerSpec> = {};
  for (const [serverId, spec] of Object.entries(userServers)) {
    if (spec.enabled === false) continue;
    if (spec.type === "http") {
      out[serverId] = prepareUserHttpServer(spec, useDocker);
    } else {
      out[serverId] = prepareUserStdioServer(spec, useDocker, hostWorkspacePath);
    }
  }
  return out;
}

// When running in Docker the MCP server subprocess won't inherit the host
// environment. Pass sentinel values for required env vars of enabled tools
// so isMcpToolEnabled() returns the same result inside the container.
// The actual API calls happen on the host server, so real values aren't needed.
function collectMcpToolSentinelEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const tool of mcpTools.filter(isMcpToolEnabled)) {
    for (const key of tool.requiredEnv ?? []) {
      if (process.env[key]) env[key] = "1";
    }
  }
  return env;
}

function buildMulmoclaudeServer(params: { chatSessionId: string; port: number; activePlugins: string[]; roleIds: string[]; useDocker: boolean }): object {
  const { chatSessionId, port, activePlugins, roleIds, useDocker } = params;
  const projectRoot = process.cwd();
  const command = useDocker ? "tsx" : join(projectRoot, "node_modules/.bin/tsx");
  const mcpServerPath = useDocker ? "/app/server/agent/mcp-server.ts" : join(projectRoot, "server/agent/mcp-server.ts");

  const dockerEnv = useDocker
    ? {
        MCP_HOST: "host.docker.internal",
        NODE_PATH: "/app/node_modules",
        ...collectMcpToolSentinelEnv(),
      }
    : {};

  // Bearer token for MCP subprocess to call /api/* back to this server
  // (#272). The MCP bridge also has a file-read fallback from
  // <workspace>/.session-token, but env is faster and works in Docker
  // where the token file may not be bind-mounted.
  const token = getCurrentToken();
  const authEnv = token ? { MULMOCLAUDE_AUTH_TOKEN: token } : {};

  return {
    command,
    args: [mcpServerPath],
    env: {
      SESSION_ID: chatSessionId,
      PORT: String(port),
      PLUGIN_NAMES: activePlugins.join(","),
      ROLE_IDS: roleIds.join(","),
      ...authEnv,
      ...dockerEnv,
    },
  };
}

// Never let a user-defined server shadow the built-in internal bridge —
// even if they pick "mulmoclaude" as the id. Drop the entry silently:
// the UI already validates ids against the slug pattern, so this is
// defence-in-depth.
function excludeReservedKeys(servers: Record<string, McpServerSpec>): Record<string, McpServerSpec> {
  const out: Record<string, McpServerSpec> = {};
  for (const [serverId, spec] of Object.entries(servers)) {
    if (serverId === "mulmoclaude") continue;
    out[serverId] = spec;
  }
  return out;
}

export function buildMcpConfig(params: McpConfigParams): { mcpServers: Record<string, unknown> } {
  const { chatSessionId, port, activePlugins, roleIds, useDocker = false, userServers = {} } = params;
  return {
    mcpServers: {
      mulmoclaude: buildMulmoclaudeServer({
        chatSessionId,
        port,
        activePlugins,
        roleIds,
        useDocker,
      }),
      ...excludeReservedKeys(userServers),
    },
  };
}

// User-facing `mcp__<server>` wildcard form for --allowedTools. Enabled
// HTTP servers always participate; stdio servers only participate when
// we're running natively (since the sandbox image is minimal in Docker).
export function userServerAllowedToolNames(userServers: Record<string, McpServerSpec>, useDocker: boolean): string[] {
  const names: string[] = [];
  for (const [serverId, spec] of Object.entries(userServers)) {
    if (spec.enabled === false) continue;
    // Stdio servers are dropped under Docker because the sandbox
    // image is too minimal to run most of them (see #162).
    if (spec.type === "stdio" && useDocker) continue;
    names.push(`mcp__${serverId}`);
  }
  return names;
}

export interface CliArgsParams {
  systemPrompt: string;
  activePlugins: string[];
  claudeSessionId?: string;
  mcpConfigPath?: string;
  // Web UI-managed extension of the allowed-tools list. Merged with
  // BASE_ALLOWED_TOOLS and the mcp__mulmoclaude__ plugin names.
  extraAllowedTools?: string[];
}

export function buildCliArgs(params: CliArgsParams): string[] {
  const { systemPrompt, activePlugins, claudeSessionId, mcpConfigPath, extraAllowedTools = [] } = params;

  const mcpToolNames = activePlugins.map((pluginName) => `mcp__mulmoclaude__${pluginName}`);
  const allowedTools = [...BASE_ALLOWED_TOOLS, ...extraAllowedTools, ...mcpToolNames];

  // stream-json input mode: the user message is streamed through
  // stdin (see `writeUserMessage` in server/agent.ts) rather than
  // passed as a `-p <text>` argument. This path is required so that
  // Claude resolves slash-command invocations (e.g. `/shiritori` from
  // the manageSkills Run button) against `~/.claude/skills/`. In the
  // old `-p <text>` mode the CLI treats the message as literal text
  // and "/shiritori" never reaches the skill resolver.
  const args = [
    "--output-format",
    "stream-json",
    "--input-format",
    "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--system-prompt",
    systemPrompt,
    "--allowedTools",
    allowedTools.join(","),
    "-p",
  ];

  if (claudeSessionId) {
    args.push("--resume", claudeSessionId);
  }

  if (mcpConfigPath) {
    args.push("--mcp-config", mcpConfigPath);
  }

  return args;
}

/** JSON line to write to the Claude CLI's stdin when running in
 *  stream-json input mode. One line per user turn.
 *
 *  Supported attachment types:
 *  - `image/*` → vision content blocks (`type: "image"`)
 *  - `application/pdf` → document content blocks (`type: "document"`)
 *  - `text/*`, JSON, XML, YAML, CSV → decoded UTF-8 → text block
 *  - DOCX → mammoth text extraction → text block
 *  - XLSX → xlsx CSV extraction → text block
 *  - PPTX → libreoffice PDF conversion → document block (Docker only)
 *  - Other MIME types → skipped with a console hint.
 *
 *  Without attachments, content is a plain string (smaller,
 *  backward-compatible). */
export async function buildUserMessageLine(message: string, attachments?: Attachment[]): Promise<string> {
  const all = attachments ?? [];
  if (all.length === 0) {
    return `${JSON.stringify({
      type: "user",
      message: { role: "user", content: message },
    })}\n`;
  }

  const blocks: Record<string, unknown>[] = [];
  const skippedReasons: string[] = [];

  for (const att of all) {
    // Native types: image and PDF go directly as content blocks
    if (isNativeAttachmentMime(att.mimeType)) {
      blocks.push(buildNativeBlock(att));
      continue;
    }
    // Convertible types: text, docx, xlsx, pptx
    const result = await convertAttachment(att);
    if (result.kind === "converted") {
      blocks.push(...result.blocks);
    } else {
      skippedReasons.push(result.reason);
    }
  }

  if (skippedReasons.length > 0) {
    log.warn("agent", "skipping unsupported attachment(s)", {
      count: skippedReasons.length,
      reasons: skippedReasons,
    });
  }

  blocks.push({ type: "text", text: message });
  return `${JSON.stringify({
    type: "user",
    message: { role: "user", content: blocks },
  })}\n`;
}

function buildNativeBlock(att: Attachment): Record<string, unknown> {
  const blockType = isImageMime(att.mimeType) ? "image" : "document";
  return {
    type: blockType,
    source: {
      type: "base64",
      media_type: att.mimeType,
      data: att.data,
    },
  };
}

export interface McpConfigPaths {
  // Where the file is actually written on the host filesystem.
  hostPath: string;
  // What gets passed to claude --mcp-config (container path under
  // docker, identical to hostPath when running natively).
  argPath: string;
}

export function resolveMcpConfigPaths(opts: { workspacePath: string; sessionId: string; useDocker: boolean }): McpConfigPaths {
  if (opts.useDocker) {
    const hostPath = join(opts.workspacePath, ".mulmoclaude", `mcp-${opts.sessionId}.json`);
    const argPath = `${CONTAINER_WORKSPACE_PATH}/.mulmoclaude/mcp-${opts.sessionId}.json`;
    return { hostPath, argPath };
  }
  const hostPath = join(tmpdir(), `mulmoclaude-mcp-${opts.sessionId}.json`);
  return { hostPath, argPath: hostPath };
}

// Mirror NodeJS.Platform — re-declared so the file doesn't need a
// `NodeJS` global reference, which the no-undef rule doesn't see in
// type-only positions.
export type Platform = "aix" | "android" | "darwin" | "freebsd" | "haiku" | "linux" | "openbsd" | "sunos" | "win32" | "cygwin" | "netbsd";

export interface DockerSpawnArgsParams {
  workspacePath: string;
  cliArgs: string[];
  uid: number;
  gid: number;
  platform: Platform;
  /** Our app's chat session id. Forwarded into the container as
   *  `MULMOCLAUDE_CHAT_SESSION_ID` so the wiki-history PostToolUse
   *  hook can publish a `page-edit` toolResult to the right chat
   *  session — Claude CLI's own `session_id` (in the hook payload)
   *  is the *CLI* session, not our chat session, so the session
   *  store would never find a match (#963). */
  chatSessionId: string;
  projectRoot?: string;
  homeDir?: string;
  /** Extra `-v` / `-e` tokens for opt-in host credentials (#259).
   *  Built by `resolveSandboxAuth` in `sandboxMounts.ts`. Default []. */
  sandboxAuthArgs?: readonly string[];
  /** Whether SSH agent forwarding is active. When true, the container
   *  uses the entrypoint (root → setup → setpriv drop) instead of
   *  `--user`, and adds the minimum capabilities the entrypoint needs.
   *  When false (default), `--user uid:gid --cap-drop ALL` with zero
   *  capabilities — identical to the pre-#259 security posture. */
  sshAgentForward?: boolean;
}

// Pure helper that returns the full `docker run ... claude <args>`
// argv array. Extracted from runAgent so the long flag list can be
// inspected and tested without spawning a real subprocess.
export function buildDockerSpawnArgs(params: DockerSpawnArgsParams): string[] {
  const {
    workspacePath,
    cliArgs,
    uid,
    gid,
    platform,
    projectRoot = process.cwd(),
    homeDir = homedir(),
    sandboxAuthArgs = [],
    sshAgentForward = false,
  } = params;
  const toDockerPath = (hostPath: string): string => hostPath.replace(/\\/g, "/");
  const extraHosts: string[] = platform === "linux" ? ["--add-host", "host.docker.internal:host-gateway"] : [];

  return [
    "run",
    "--rm",
    // -i keeps the container's stdin open so the stream-json user
    // message (see buildUserMessageLine) can flow through. Without
    // this Docker detaches stdin and the CLI reads EOF on startup.
    "-i",
    "--cap-drop",
    "ALL",
    // When SSH agent forwarding is active, the entrypoint needs root
    // to fix /etc/passwd, chown /home/node, and chmod the socket.
    // These 5 caps are the minimum set; setpriv --inh-caps=-all
    // drops them on exec so Claude runs with zero capabilities.
    //
    // When SSH is OFF, use the simpler `--user uid:gid` which runs
    // the entire container as the host user — zero caps from the
    // start, identical to the pre-#259 security posture.
    ...(sshAgentForward
      ? [
          "--cap-add",
          "CHOWN",
          "--cap-add",
          "FOWNER",
          "--cap-add",
          "DAC_OVERRIDE",
          "--cap-add",
          "SETUID",
          "--cap-add",
          "SETGID",
          "-e",
          `HOST_UID=${uid}`,
          "-e",
          `HOST_GID=${gid}`,
        ]
      : ["--user", `${uid}:${gid}`]),
    "-e",
    "HOME=/home/node",
    // Wiki-history hook (#763 PR 2) runs inside this container after
    // every Write/Edit and POSTs back to the parent server. Plain
    // loopback fails — `127.0.0.1` is the container itself. Same
    // resolution as MCP_HOST above; on Linux the corresponding
    // `--add-host host.docker.internal:host-gateway` is appended via
    // `extraHosts`.
    "-e",
    "MULMOCLAUDE_HOST=host.docker.internal",
    // Chat session id for the wiki-history hook (#963). The hook
    // POSTs `{slug, sessionId}` to the parent server; the server
    // looks up the chat session by this id to publish a `page-edit`
    // toolResult into its timeline.
    "-e",
    `MULMOCLAUDE_CHAT_SESSION_ID=${params.chatSessionId}`,
    "-v",
    `${toDockerPath(projectRoot)}/node_modules:/app/node_modules:ro`,
    "-v",
    `${toDockerPath(projectRoot)}/server:/app/server:ro`,
    "-v",
    `${toDockerPath(projectRoot)}/src:/app/src:ro`,
    "-v",
    `${toDockerPath(projectRoot)}/packages:/app/packages:ro`,
    "-v",
    `${toDockerPath(workspacePath)}:${CONTAINER_WORKSPACE_PATH}`,
    "-v",
    `${toDockerPath(homeDir)}/.claude:/home/node/.claude`,
    "-v",
    `${toDockerPath(homeDir)}/.claude.json:/home/node/.claude.json`,
    ...sandboxAuthArgs,
    ...extraHosts,
    "mulmoclaude-sandbox",
    "claude",
    ...cliArgs,
  ];
}
