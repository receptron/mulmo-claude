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

  // Per-invocation read so Settings UI changes apply without a server restart.
  const userMcpRaw = loadMcpConfig().mcpServers;
  const userServers = prepareUserServers(userMcpRaw, useDocker, workspacePath);
  const hasUserServers = Object.keys(userServers).length > 0;
  const hasMcp = activePlugins.length > 0 || hasUserServers;

  // Catches the "catalog entry pinned to a non-existent npm package" failure where the MCP subprocess never starts and
  // Claude silently falls back to WebSearch. Fire-and-forget; per-package cache amortizes the network round-trip.
  validateStdioPackages(userServers).catch(() => {});

  // macOS sandbox: refresh from Keychain so expired OAuth tokens get replaced transparently.
  if (useDocker && process.platform === "darwin") {
    await refreshCredentials();
  }

  const fullSystemPrompt = buildSystemPrompt({
    role,
    workspacePath: useDocker ? CONTAINER_WORKSPACE_PATH : workspacePath,
    useDocker,
    userTimezone,
  });

  // --debug: dump the full system prompt on the first message of each session.
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

  // Surfaced in the --debug spawn log so developers can verify Settings UI changes reach Claude Code.
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
    // Atomic so a concurrent claude spawn can't pick up a half-written file (they share the path under the session dir).
    await writeJsonAtomic(mcpPaths.hostPath, mcpConfig);
  }

  // Per-invocation read so allowedTools / MCP-server changes apply without a server restart.
  const settings = loadSettings();
  const userServerAllowedTools = userServerAllowedToolNames(userServers, useDocker);

  // Boolean presence flags only — never write raw sessionId into long-lived log sinks.
  const backend = getActiveBackend();
  const spawnLog: Record<string, unknown> = {
    backend: backend.id,
    roleId: role.id,
    useDocker,
    hasMcp,
    resumed: Boolean(claudeSessionId),
    hasSessionId: Boolean(sessionId),
  };
  // --debug only: kept off the default log to avoid leaking user MCP server names into long-lived sinks.
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
