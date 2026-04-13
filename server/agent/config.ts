import { join } from "path";
import { homedir, tmpdir } from "os";
import type { Role } from "../../src/config/roles.js";
import { mcpTools, isMcpToolEnabled } from "../mcp-tools/index.js";
import { MCP_PLUGIN_NAMES } from "../plugin-names.js";

export const CONTAINER_WORKSPACE_PATH = "/home/node/mulmoclaude";

const BASE_ALLOWED_TOOLS = [
  "Bash",
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
];

const MCP_PLUGINS = new Set([
  ...MCP_PLUGIN_NAMES,
  ...mcpTools.filter(isMcpToolEnabled).map((t) => t.definition.name),
]);

export function getActivePlugins(role: Role): string[] {
  return role.availablePlugins.filter((p) => MCP_PLUGINS.has(p));
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
}

export function buildMcpConfig(params: McpConfigParams): object {
  const {
    chatSessionId,
    port,
    activePlugins,
    roleIds,
    useDocker = false,
  } = params;
  const projectRoot = process.cwd();
  const command = useDocker
    ? "tsx"
    : join(projectRoot, "node_modules/.bin/tsx");
  const mcpServerPath = useDocker
    ? "/app/server/mcp-server.ts"
    : join(projectRoot, "server/mcp-server.ts");

  // When running in Docker the MCP server subprocess won't inherit the host
  // environment. Pass sentinel values for required env vars of enabled tools
  // so isMcpToolEnabled() returns the same result inside the container.
  // The actual API calls happen on the host server, so real values aren't needed.
  const mcpToolEnv: Record<string, string> = {};
  if (useDocker) {
    for (const tool of mcpTools.filter(isMcpToolEnabled)) {
      for (const key of tool.requiredEnv ?? []) {
        if (process.env[key]) mcpToolEnv[key] = "1";
      }
    }
  }

  return {
    mcpServers: {
      mulmoclaude: {
        command,
        args: [mcpServerPath],
        env: {
          SESSION_ID: chatSessionId,
          PORT: String(port),
          PLUGIN_NAMES: activePlugins.join(","),
          ROLE_IDS: roleIds.join(","),
          ...(useDocker
            ? {
                MCP_HOST: "host.docker.internal",
                NODE_PATH: "/app/node_modules",
                ...mcpToolEnv,
              }
            : {}),
        },
      },
    },
  };
}

export interface CliArgsParams {
  systemPrompt: string;
  activePlugins: string[];
  claudeSessionId?: string;
  message: string;
  mcpConfigPath?: string;
}

export function buildCliArgs(params: CliArgsParams): string[] {
  const {
    systemPrompt,
    activePlugins,
    claudeSessionId,
    message,
    mcpConfigPath,
  } = params;

  const mcpToolNames = activePlugins.map((p) => `mcp__mulmoclaude__${p}`);
  const allowedTools = [...BASE_ALLOWED_TOOLS, ...mcpToolNames];

  const args = [
    "--output-format",
    "stream-json",
    "--verbose",
    "--system-prompt",
    systemPrompt,
    "--allowedTools",
    allowedTools.join(","),
  ];

  if (claudeSessionId) {
    args.push("--resume", claudeSessionId);
  }

  args.push("-p", message);

  if (mcpConfigPath) {
    args.push("--mcp-config", mcpConfigPath);
  }

  return args;
}

export interface McpConfigPaths {
  // Where the file is actually written on the host filesystem.
  hostPath: string;
  // What gets passed to claude --mcp-config (container path under
  // docker, identical to hostPath when running natively).
  argPath: string;
}

export function resolveMcpConfigPaths(opts: {
  workspacePath: string;
  sessionId: string;
  useDocker: boolean;
}): McpConfigPaths {
  if (opts.useDocker) {
    const hostPath = join(
      opts.workspacePath,
      ".mulmoclaude",
      `mcp-${opts.sessionId}.json`,
    );
    const argPath = `${CONTAINER_WORKSPACE_PATH}/.mulmoclaude/mcp-${opts.sessionId}.json`;
    return { hostPath, argPath };
  }
  const hostPath = join(tmpdir(), `mulmoclaude-mcp-${opts.sessionId}.json`);
  return { hostPath, argPath: hostPath };
}

// Mirror NodeJS.Platform — re-declared so the file doesn't need a
// `NodeJS` global reference, which the no-undef rule doesn't see in
// type-only positions.
export type Platform =
  | "aix"
  | "android"
  | "darwin"
  | "freebsd"
  | "haiku"
  | "linux"
  | "openbsd"
  | "sunos"
  | "win32"
  | "cygwin"
  | "netbsd";

export interface DockerSpawnArgsParams {
  workspacePath: string;
  cliArgs: string[];
  uid: number;
  gid: number;
  platform: Platform;
  projectRoot?: string;
  homeDir?: string;
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
  } = params;
  const toDockerPath = (p: string): string => p.replace(/\\/g, "/");
  const extraHosts: string[] =
    platform === "linux"
      ? ["--add-host", "host.docker.internal:host-gateway"]
      : [];

  return [
    "run",
    "--rm",
    "--cap-drop",
    "ALL",
    "--user",
    `${uid}:${gid}`,
    "-e",
    "HOME=/home/node",
    "-v",
    `${toDockerPath(projectRoot)}/node_modules:/app/node_modules:ro`,
    "-v",
    `${toDockerPath(projectRoot)}/server:/app/server:ro`,
    "-v",
    `${toDockerPath(projectRoot)}/src:/app/src:ro`,
    "-v",
    `${toDockerPath(workspacePath)}:${CONTAINER_WORKSPACE_PATH}`,
    "-v",
    `${toDockerPath(homeDir)}/.claude:/home/node/.claude`,
    "-v",
    `${toDockerPath(homeDir)}/.claude.json:/home/node/.claude.json`,
    ...extraHosts,
    "mulmoclaude-sandbox",
    "claude",
    ...cliArgs,
  ];
}
