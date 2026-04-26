// Claude Code backend: spawns the `claude` CLI as a subprocess (or
// inside the mulmoclaude-sandbox Docker image) and translates its
// stream-json output into portable AgentEvents.
//
// This file is the single seam between the orchestrator in
// server/agent/index.ts (which is backend-agnostic) and the Claude
// CLI specifics. Pure helpers it depends on (CLI arg construction,
// Docker arg construction, stream parsing) stay in their existing
// home so the existing test suite under test/agent/ keeps working
// unchanged.

import { spawn, type ChildProcessByStdio } from "child_process";
import type { Readable, Writable } from "stream";
import { buildCliArgs, buildDockerSpawnArgs, buildUserMessageLine } from "../config.js";
import { resolveSandboxAuth } from "../sandboxMounts.js";
import { getCachedReferenceDirs, referenceDirMountArgs } from "../../workspace/reference-dirs.js";
import { createStreamParser, type AgentEvent, type RawStreamEvent } from "../stream.js";
import { log } from "../../system/logger/index.js";
import { EVENT_TYPES } from "../../../src/types/events.js";
import { env } from "../../system/env.js";
import type { AgentInput, LLMBackend } from "./types.js";

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

// Track MCP tool usage to detect silent MCP server failures.
// If ToolSearch was called but no mcp__* tool was ever invoked,
// the MCP server likely crashed on startup (e.g. module resolution
// failure inside Docker). See #430.
function createMcpTracker() {
  let toolSearchCalled = false;
  let mcpToolCalled = false;
  return {
    track(event: AgentEvent) {
      if (event.type !== EVENT_TYPES.toolCall) return;
      if (event.toolName === "ToolSearch") toolSearchCalled = true;
      if (event.toolName.startsWith("mcp__")) mcpToolCalled = true;
    },
    logIfSuspicious() {
      if (toolSearchCalled && !mcpToolCalled) {
        log.warn(
          "agent",
          "ToolSearch was used but no MCP tool was called — the MCP server may have crashed. " +
            "Check Docker volume mounts and package.json exports. " +
            "Run: npx tsx --test test/agent/test_mcp_docker_smoke.ts",
        );
      }
    },
  };
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

  const mcpTracker = createMcpTracker();

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
        mcpTracker.track(agentEvent);
        yield agentEvent;
      }
    }
  }

  const exitCode = await new Promise<number>((resolve) => proc.on("close", resolve));

  if (stderrBuffer.trim()) log.error("agent-stderr", stderrBuffer);
  log.info("agent", "claude exited", { exitCode });
  mcpTracker.logIfSuspicious();

  if (exitCode !== 0) {
    yield {
      type: EVENT_TYPES.error,
      message: stderrOutput || `claude exited with code ${exitCode}`,
    };
  }
}

async function* runClaudeAgent(input: AgentInput): AsyncGenerator<AgentEvent> {
  const cliArgs = buildCliArgs({
    systemPrompt: input.systemPrompt,
    activePlugins: input.activePlugins,
    claudeSessionId: input.sessionToken,
    mcpConfigPath: input.mcpConfigPath,
    extraAllowedTools: input.extraAllowedTools,
  });

  const proc = spawnClaude(input.useDocker, input.workspacePath, cliArgs);

  // stream-json input mode: stream the user turn as a single JSON
  // line to stdin, then close the pipe so the CLI knows no further
  // turns are coming. Writing before attaching the abort handler is
  // fine — if the write fails because the process already died for
  // other reasons, the readAgentEvents loop below surfaces it.
  const messageLine = await buildUserMessageLine(input.message, input.attachments);
  proc.stdin.write(messageLine);
  proc.stdin.end();

  const onAbort = () => {
    if (!proc.killed) proc.kill();
  };
  input.abortSignal?.addEventListener("abort", onAbort, { once: true });

  try {
    yield* readAgentEvents(proc);
  } finally {
    input.abortSignal?.removeEventListener("abort", onAbort);
    if (!proc.killed) proc.kill();
  }
}

export const claudeCodeBackend: LLMBackend = {
  id: "claude-code",
  capabilities: { sessionResume: true, mcp: true },
  runAgent: runClaudeAgent,
};
