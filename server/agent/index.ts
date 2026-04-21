import { spawn, type ChildProcessByStdio } from "child_process";
import { mkdir, writeFile, unlink } from "fs/promises";
import { dirname } from "path";
import type { Readable, Writable } from "stream";
import { isDockerAvailable } from "../system/docker.js";
import { refreshCredentials } from "../system/credentials.js";
import { loadMcpConfig, loadSettings } from "../system/config.js";
import type { Role } from "../../src/config/roles.js";
import { loadAllRoles } from "../workspace/roles.js";
import { buildSystemPrompt } from "./prompt.js";
import {
  CONTAINER_WORKSPACE_PATH,
  buildCliArgs,
  buildDockerSpawnArgs,
  buildMcpConfig,
  buildUserMessageLine,
  getActivePlugins,
  prepareUserServers,
  resolveMcpConfigPaths,
  userServerAllowedToolNames,
} from "./config.js";
import type { Attachment } from "@mulmobridge/protocol";
import { createStreamParser, type AgentEvent, type RawStreamEvent } from "./stream.js";
import { log } from "../system/logger/index.js";
import { EVENT_TYPES } from "../../src/types/events.js";
import { env } from "../system/env.js";
import { resolveSandboxAuth } from "./sandboxMounts.js";
import { getCachedReferenceDirs, referenceDirMountArgs } from "../workspace/reference-dirs.js";

type ClaudeProc = ChildProcessByStdio<Writable, Readable, Readable>;

function spawnClaude(useDocker: boolean, workspacePath: string, cliArgs: string[]): ClaudeProc {
  if (!useDocker) {
    return spawn("claude", cliArgs, {
      cwd: workspacePath,
      stdio: ["pipe", "pipe", "pipe"],
    });
  }
  const sandboxAuth = resolveSandboxAuth({
    sshAgentForward: env.sandboxSshAgentForward,
    sshAllowedHosts: env.sandboxSshAllowedHosts,
    configMountNames: env.sandboxMountConfigs,
    sshAuthSock: process.env.SSH_AUTH_SOCK,
  });
  const refDirArgs = referenceDirMountArgs(getCachedReferenceDirs());
  const dockerArgs = buildDockerSpawnArgs({
    workspacePath,
    cliArgs,
    uid: process.getuid?.() ?? 1000,
    gid: process.getgid?.() ?? 1000,
    platform: process.platform,
    sandboxAuthArgs: [...sandboxAuth.args, ...refDirArgs],
    sshAgentForward: env.sandboxSshAgentForward,
  });
  return spawn("docker", dockerArgs, { stdio: ["pipe", "pipe", "pipe"] });
}

async function* readAgentEvents(proc: ClaudeProc): AsyncGenerator<AgentEvent> {
  let stderrOutput = "";
  let stderrBuffer = "";
  proc.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stderrOutput += text;
    stderrBuffer += text;
    const lines = stderrBuffer.split("\n");
    stderrBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) log.error("agent-stderr", line);
    }
  });

  // Stateful parser tracks whether text was already streamed via
  // assistant content blocks so the final `result` event's duplicate
  // text is suppressed. See createStreamParser() in stream.ts.
  const parser = createStreamParser();

  let buffer = "";
  for await (const chunk of proc.stdout) {
    buffer += (chunk as Buffer).toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      let event: RawStreamEvent;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      for (const agentEvent of parser.parse(event)) {
        yield agentEvent;
      }
    }
  }

  const exitCode = await new Promise<number>((resolve) => proc.on("close", resolve));

  if (stderrBuffer.trim()) log.error("agent-stderr", stderrBuffer);
  log.info("agent", "claude exited", { exitCode });

  if (exitCode !== 0) {
    yield {
      type: EVENT_TYPES.error,
      message: stderrOutput || `claude exited with code ${exitCode}`,
    };
  }
}

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

  // On macOS sandbox, always refresh credentials from Keychain before each
  // agent run so that expired OAuth tokens are replaced transparently.
  if (useDocker && process.platform === "darwin") {
    await refreshCredentials();
  }

  const fullSystemPrompt = buildSystemPrompt({
    role,
    workspacePath: useDocker ? CONTAINER_WORKSPACE_PATH : workspacePath,
    useDocker,
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

  if (hasMcp) {
    const mcpConfig = buildMcpConfig({
      chatSessionId: sessionId,
      port,
      activePlugins,
      roleIds: loadAllRoles().map((loadedRole) => loadedRole.id),
      useDocker,
      userServers,
    });
    await writeFile(mcpPaths.hostPath, JSON.stringify(mcpConfig, null, 2));
  }

  // Fresh read on every invocation so the Settings UI can change
  // allowedTools / MCP servers without a server restart.
  const settings = loadSettings();
  const userServerAllowedTools = userServerAllowedToolNames(userServers, useDocker);

  const cliArgs = buildCliArgs({
    systemPrompt: fullSystemPrompt,
    activePlugins,
    claudeSessionId,
    mcpConfigPath: hasMcp ? mcpPaths.argPath : undefined,
    extraAllowedTools: [...settings.extraAllowedTools, ...userServerAllowedTools],
  });

  // Don't persist raw sessionId into log sinks (esp. the retained
  // file sink). A boolean presence flag is enough for operational
  // debugging and avoids writing identifiers that route back to a
  // specific session into long-lived log files.
  log.info("agent", "spawning claude", {
    roleId: role.id,
    useDocker,
    hasMcp,
    resumed: Boolean(claudeSessionId),
    hasSessionId: Boolean(sessionId),
  });
  const proc = spawnClaude(useDocker, workspacePath, cliArgs);

  // stream-json input mode: stream the user turn as a single JSON
  // line to stdin, then close the pipe so the CLI knows no further
  // turns are coming. Writing before attaching the abort handler
  // is fine — if the write fails because the process already died
  // for other reasons, the `readAgentEvents` loop below surfaces it.
  const messageLine = await buildUserMessageLine(message, attachments);
  proc.stdin.write(messageLine);
  proc.stdin.end();

  // If an abort signal is provided, kill the process when it fires.
  const onAbort = () => {
    if (!proc.killed) proc.kill();
  };
  abortSignal?.addEventListener("abort", onAbort, { once: true });

  try {
    yield* readAgentEvents(proc);
  } finally {
    abortSignal?.removeEventListener("abort", onAbort);
    if (!proc.killed) proc.kill();
    if (hasMcp) unlink(mcpPaths.hostPath).catch(() => {});
  }
}
