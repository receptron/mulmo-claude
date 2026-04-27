import { mkdir, unlink } from "fs/promises";
import { writeJsonAtomic } from "../utils/files/json.js";
import { dirname } from "path";
import { isDockerAvailable } from "../system/docker.js";
import { refreshCredentials } from "../system/credentials.js";
import { loadMcpConfig, loadSettings } from "../system/config.js";
import type { Role } from "../../src/config/roles.js";
import { loadAllRoles } from "../workspace/roles.js";
import { buildSystemPrompt } from "./prompt.js";
import { CONTAINER_WORKSPACE_PATH, buildMcpConfig, getActivePlugins, prepareUserServers, resolveMcpConfigPaths, userServerAllowedToolNames } from "./config.js";
import { validateStdioPackages } from "./mcpHealth.js";
import type { Attachment } from "@mulmobridge/protocol";
import type { AgentEvent } from "./stream.js";
import { log } from "../system/logger/index.js";
import { getActiveBackend } from "./backend/index.js";

export interface RunAgentOptions {
  message: string;
  role: Role;
  workspacePath: string;
  sessionId: string;
  port: number;
  claudeSessionId?: string;
  /** When aborted, the spawned Claude CLI process is killed. */
  abortSignal?: AbortSignal;
}

export async function* runAgent(
  message: string,
  role: Role,
  workspacePath: string,
  sessionId: string,
  port: number,
  claudeSessionId?: string,
  abortSignal?: AbortSignal,
  attachments?: Attachment[],
  userTimezone?: string,
): AsyncGenerator<AgentEvent> {
  const activePlugins = getActivePlugins(role);
  const useDocker = await isDockerAvailable();

  // User-defined MCP servers are read per invocation so Settings UI
  // changes apply immediately. Disabled / malformed entries get
  // filtered by prepareUserServers; remaining servers are merged into
  // the --mcp-config payload below.
  const userMcpRaw = loadMcpConfig().mcpServers;
  const userServers = prepareUserServers(userMcpRaw, useDocker, workspacePath);
  const hasUserServers = Object.keys(userServers).length > 0;
  const hasMcp = activePlugins.length > 0 || hasUserServers;

  // Fire-and-forget pre-flight check: warn (don't block) when an
  // npx-style stdio server points at a package npm doesn't resolve.
  // Catches the "catalog entry pinned to a non-existent name" failure
  // mode where Claude silently falls back to WebSearch because the
  // MCP subprocess never starts. Cached per-package within the
  // process lifetime — first invocation pays the network round-trip.
  validateStdioPackages(userServers).catch(() => {});

  // On macOS sandbox, always refresh credentials from Keychain before each
  // agent run so that expired OAuth tokens are replaced transparently.
  if (useDocker && process.platform === "darwin") {
    await refreshCredentials();
  }

  const fullSystemPrompt = buildSystemPrompt({
    role,
    workspacePath: useDocker ? CONTAINER_WORKSPACE_PATH : workspacePath,
    useDocker,
    userTimezone,
  });

  // In debug mode (--debug), dump the full system prompt on the first
  // message of each session so developers can inspect what the LLM sees.
  if (!claudeSessionId && process.argv.includes("--debug")) {
    log.info("agent", "system prompt for new session:\n" + fullSystemPrompt);
  }

  const mcpPaths = resolveMcpConfigPaths({
    workspacePath,
    sessionId,
    useDocker,
  });
  if (useDocker) {
    await mkdir(dirname(mcpPaths.hostPath), { recursive: true });
  }

  // Names of every MCP server (built-in + user-configured) merged
  // into the --mcp-config payload. Only populated when `hasMcp` is
  // true; surfaced in the spawn log under --debug so developers can
  // verify Settings UI changes actually reach Claude Code.
  let mcpServerNames: string[] = [];
  if (hasMcp) {
    const mcpConfig = buildMcpConfig({
      chatSessionId: sessionId,
      port,
      activePlugins,
      roleIds: loadAllRoles().map((loadedRole) => loadedRole.id),
      useDocker,
      userServers,
    });
    mcpServerNames = Object.keys(mcpConfig.mcpServers).sort();
    // Write atomically so a partially-written file can't be picked
    // up by a concurrent claude spawn (they share the --mcp-config
    // path under the session dir).
    await writeJsonAtomic(mcpPaths.hostPath, mcpConfig);
  }

  // Fresh read on every invocation so the Settings UI can change
  // allowedTools / MCP servers without a server restart.
  const settings = loadSettings();
  const userServerAllowedTools = userServerAllowedToolNames(userServers, useDocker);

  // Don't persist raw sessionId into log sinks (esp. the retained
  // file sink). A boolean presence flag is enough for operational
  // debugging and avoids writing identifiers that route back to a
  // specific session into long-lived log files.
  const backend = getActiveBackend();
  const spawnLog: Record<string, unknown> = {
    backend: backend.id,
    roleId: role.id,
    useDocker,
    hasMcp,
    resumed: Boolean(claudeSessionId),
    hasSessionId: Boolean(sessionId),
  };
  // Under --debug only: dump the merged MCP server list so the
  // developer can confirm Settings UI changes (catalog installs /
  // removes, env updates) actually reach Claude Code on the next
  // spawn. Kept out of the default log to avoid leaking server
  // names into long-lived sinks.
  if (process.argv.includes("--debug") && hasMcp) {
    spawnLog.mcpServers = mcpServerNames;
  }
  log.info("agent", "spawning agent", spawnLog);

  try {
    yield* backend.runAgent({
      systemPrompt: fullSystemPrompt,
      message,
      role,
      workspacePath,
      sessionId,
      port,
      sessionToken: claudeSessionId,
      attachments,
      activePlugins,
      mcpConfigPath: hasMcp ? mcpPaths.argPath : undefined,
      extraAllowedTools: [...settings.extraAllowedTools, ...userServerAllowedTools],
      abortSignal,
      userTimezone,
      useDocker,
    });
  } finally {
    if (hasMcp) unlink(mcpPaths.hostPath).catch(() => {});
  }
}
