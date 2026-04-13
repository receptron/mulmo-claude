import { spawn, type ChildProcessByStdio } from "child_process";
import { mkdir, writeFile, unlink } from "fs/promises";
import { dirname } from "path";
import type { Readable } from "stream";
import { isDockerAvailable } from "./docker.js";
import { refreshCredentials } from "./credentials.js";
import type { Role } from "../src/config/roles.js";
import { loadAllRoles } from "./roles.js";
import { buildSystemPrompt } from "./agent/prompt.js";
import {
  CONTAINER_WORKSPACE_PATH,
  buildCliArgs,
  buildDockerSpawnArgs,
  buildMcpConfig,
  getActivePlugins,
  resolveMcpConfigPaths,
} from "./agent/config.js";
import {
  parseStreamEvent,
  type AgentEvent,
  type RawStreamEvent,
} from "./agent/stream.js";
import { log } from "./logger/index.js";

type ClaudeProc = ChildProcessByStdio<null, Readable, Readable>;

function spawnClaude(
  useDocker: boolean,
  workspacePath: string,
  cliArgs: string[],
): ClaudeProc {
  if (!useDocker) {
    return spawn("claude", cliArgs, {
      cwd: workspacePath,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  const dockerArgs = buildDockerSpawnArgs({
    workspacePath,
    cliArgs,
    uid: process.getuid?.() ?? 1000,
    gid: process.getgid?.() ?? 1000,
    platform: process.platform,
  });
  return spawn("docker", dockerArgs, { stdio: ["ignore", "pipe", "pipe"] });
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
      for (const agentEvent of parseStreamEvent(event)) {
        yield agentEvent;
      }
    }
  }

  const exitCode = await new Promise<number>((resolve) =>
    proc.on("close", resolve),
  );

  if (stderrBuffer.trim()) log.error("agent-stderr", stderrBuffer);
  log.info("agent", "claude exited", { exitCode });

  if (exitCode !== 0) {
    yield {
      type: "error",
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
  pluginPrompts?: Record<string, string>;
  systemPrompt?: string;
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
  pluginPrompts?: Record<string, string>,
  systemPrompt?: string,
  abortSignal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const activePlugins = getActivePlugins(role);
  const hasMcp = activePlugins.length > 0;
  const useDocker = await isDockerAvailable();

  // On macOS sandbox, always refresh credentials from Keychain before each
  // agent run so that expired OAuth tokens are replaced transparently.
  if (useDocker && process.platform === "darwin") {
    await refreshCredentials();
  }

  const fullSystemPrompt = buildSystemPrompt({
    role,
    workspacePath: useDocker ? CONTAINER_WORKSPACE_PATH : workspacePath,
    pluginPrompts,
    systemPrompt,
  });

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
      roleIds: loadAllRoles().map((r) => r.id),
      useDocker,
    });
    await writeFile(mcpPaths.hostPath, JSON.stringify(mcpConfig, null, 2));
  }

  const cliArgs = buildCliArgs({
    systemPrompt: fullSystemPrompt,
    activePlugins,
    claudeSessionId,
    message,
    mcpConfigPath: hasMcp ? mcpPaths.argPath : undefined,
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
