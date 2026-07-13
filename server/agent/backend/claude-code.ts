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
import { buildCliArgs, buildDockerSpawnArgs, buildUserMessageLine, resolveSystemPromptPaths, type CliArgsParams } from "../config.js";
import { writeFileAtomic } from "../../utils/files/atomic.js";
import { resolveSandboxAuth } from "../sandboxMounts.js";
import { getCachedReferenceDirs, referenceDirMountArgs } from "../../workspace/reference-dirs.js";
import { createStreamParser, type AgentEvent, type RawStreamEvent } from "../stream.js";
import { createMcpFailureMonitor } from "../mcpFailureMonitor.js";
import { isMcpBrokerNotReadyError } from "../mcpBrokerFailover.js";
import { log } from "../../system/logger/index.js";
import { errorMessage } from "../../utils/errors.js";
import { EVENT_TYPES } from "../../../src/types/events.js";
import { env } from "../../system/env.js";
import { claudeBinPath } from "../../utils/claudeBin.js";
import type { AgentInput, LLMBackend } from "./types.js";

type ClaudeProc = ChildProcessByStdio<Writable, Readable, Readable>;

function spawnClaude(useDocker: boolean, workspacePath: string, cliArgs: string[], chatSessionId: string): ClaudeProc {
  if (!useDocker) {
    // MULMOCLAUDE_CHAT_SESSION_ID is the chat-session id our wiki-history
    // PostToolUse hook needs to publish a `page-edit` toolResult back to
    // the right session (#963). Claude CLI's own hook payload carries
    // its internal session_id, which doesn't match our session store.
    return spawn(claudeBinPath(), cliArgs, {
      cwd: workspacePath,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, MULMOCLAUDE_CHAT_SESSION_ID: chatSessionId },
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
    chatSessionId,
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

// Exit codes the claude CLI reports when it is terminated by one of the
// signals our abort handler sends: 128 + signal number (SIGTERM=15 → 143,
// SIGKILL=9 → 137). Node also reports a null code with `signal` set when a
// signal kills the process directly without the CLI's own handler running.
const ABORT_EXIT_CODES = new Set([143, 137]);
const ABORT_SIGNALS = new Set<string>(["SIGTERM", "SIGKILL"]);

// A non-zero exit caused by our own abort (stop button → proc.kill()) is
// expected, not a failure — surfacing it as an error event makes a deliberate
// stop look like a crash. Suppress it ONLY when we actually aborted AND the
// exit is signal-shaped, so a genuine crash that happens to coincide with a
// stop click still surfaces its real error.
export function isAbortCausedExit(exitCode: number | null, signal: string | null, abortSignal?: AbortSignal): boolean {
  if (!abortSignal?.aborted) return false;
  if (signal !== null && ABORT_SIGNALS.has(signal)) return true;
  return exitCode !== null && ABORT_EXIT_CODES.has(exitCode);
}

// Build the error event for a finished claude process, or null when nothing
// should surface (clean exit, or a deliberate abort). exitCode is null when a
// signal — not a code — ended the process, so name the signal in that case
// rather than emitting "claude exited with code null".
export function buildExitErrorEvent(
  exitCode: number | null,
  signal: string | null,
  abortSignal: AbortSignal | undefined,
  stderrOutput: string,
): { type: typeof EVENT_TYPES.error; message: string } | null {
  if (exitCode === 0 || isAbortCausedExit(exitCode, signal, abortSignal)) return null;
  const exitSummary = exitCode !== null ? `claude exited with code ${exitCode}` : `claude terminated by signal ${signal ?? "unknown"}`;
  return { type: EVENT_TYPES.error, message: stderrOutput || exitSummary };
}

// The broker startup race (#2057) can leave the CLI exiting 0 — the model gives
// up after the first tool call fails, so `buildExitErrorEvent` sees a clean exit
// and returns null. Scan stderr for the permission-prompt-tool phrase and
// surface it as an error the fail-over loop can retry on. A non-zero exit
// carrying the same phrase already flows through `buildExitErrorEvent`, so this
// only covers the clean-exit case.
export function brokerNotReadyErrorEvent(stderrOutput: string): { type: typeof EVENT_TYPES.error; message: string } | null {
  return isMcpBrokerNotReadyError(stderrOutput) ? { type: EVENT_TYPES.error, message: stderrOutput } : null;
}

async function* readAgentEvents(proc: ClaudeProc, abortSignal?: AbortSignal): AsyncGenerator<AgentEvent> {
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
  // Runtime failure monitor (#1353). Lives next to mcpTracker
  // because they share the same event stream — the tracker spots
  // the "MCP never invoked" pattern, the monitor spots the
  // "MCP invoked but consistently failing" pattern.
  const mcpFailureMonitor = createMcpFailureMonitor();

  // Attach the close listener BEFORE draining stdout. The `close` event
  // can fire on the same tick stdout ends; registering it only after the
  // read loop risks missing it and hanging on the await below.
  const closed = new Promise<{ code: number | null; signal: string | null }>((resolve) => proc.on("close", (code, sig) => resolve({ code, signal: sig })));

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
        mcpFailureMonitor.track(agentEvent);
        yield agentEvent;
      }
    }
  }

  const { code: exitCode, signal } = await closed;

  if (stderrBuffer.trim()) log.error("agent-stderr", stderrBuffer);
  log.info("agent", "claude exited", { exitCode, signal });
  mcpTracker.logIfSuspicious();

  const errorEvent = buildExitErrorEvent(exitCode, signal, abortSignal, stderrOutput) ?? brokerNotReadyErrorEvent(stderrOutput);
  if (errorEvent) yield errorEvent;
}

// The non-pass-through mappings are `sessionToken` -> `claudeSessionId`
// (the CLI's `--resume` id) and the system prompt, which travels as a
// file path (`systemPromptPath`) rather than inline text — see the
// CliArgsParams field comment for the Windows ENAMETOOLONG rationale.
export function cliArgsForInput(input: AgentInput, systemPromptPath: string): CliArgsParams {
  return {
    systemPromptPath,
    activePlugins: input.activePlugins,
    claudeSessionId: input.sessionToken,
    mcpConfigPath: input.mcpConfigPath,
    extraAllowedTools: input.extraAllowedTools,
    effortLevel: input.effortLevel,
  };
}

// Write the per-session system-prompt file the CLI reads via
// `--system-prompt-file`. Returns the path to pass on the command line
// (container path under Docker). Atomic write so a concurrent spawn on
// the same session never sees a half-written prompt.
async function writeSystemPromptFile(input: AgentInput): Promise<string> {
  const paths = resolveSystemPromptPaths({
    workspacePath: input.workspacePath,
    sessionId: input.sessionId,
    useDocker: input.useDocker,
  });
  await writeFileAtomic(paths.hostPath, input.systemPrompt);
  return paths.argPath;
}

async function* runClaudeAgent(input: AgentInput): AsyncGenerator<AgentEvent> {
  const systemPromptPath = await writeSystemPromptFile(input);
  const cliArgs = buildCliArgs(cliArgsForInput(input, systemPromptPath));

  // spawnClaude can throw synchronously when `claudeBinPath()` fails
  // to locate `claude.exe` on Windows — surface that through the same
  // AgentEvent error channel as the post-spawn "error" event so the
  // server stays alive (#1364) and the user sees the actionable
  // "install with npm install -g …" hint.
  let proc: ReturnType<typeof spawnClaude>;
  try {
    proc = spawnClaude(input.useDocker, input.workspacePath, cliArgs, input.sessionId);
  } catch (err) {
    const target = input.useDocker ? "docker" : "claude";
    const message = err instanceof Error ? err.message : String(err);
    log.error("agent", `failed to resolve ${target} binary`, { error: message });
    yield {
      type: EVENT_TYPES.error,
      message: `Failed to spawn ${target}: ${message}`,
    };
    return;
  }

  // Wait for the kernel to confirm the spawn before piping anything
  // into stdin. Without this guard, a missing `claude` (or `docker`)
  // binary emits a delayed `error` event with no listener attached —
  // Node treats it as uncaught and tears down the entire server
  // process. Surfacing it as a regular AgentEvent keeps the server
  // alive across CI runs and prod-misconfig recovery (#1364).
  try {
    await new Promise<void>((resolve, reject) => {
      proc.once("spawn", () => resolve());
      proc.once("error", (err) => reject(err));
    });
  } catch (err) {
    const target = input.useDocker ? "docker" : "claude";
    const message = errorMessage(err);
    log.error("agent", `failed to spawn ${target}`, { error: message });
    yield {
      type: EVENT_TYPES.error,
      message: `Failed to spawn ${target}: ${message}`,
    };
    return;
  }
  // Best-effort stdin EPIPE guard — the process can die between
  // `spawn` and the write below for unrelated reasons (OOM, kill
  // -9), and we don't want a write-after-death to become another
  // uncaught error.
  proc.stdin.on("error", () => {});

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
    yield* readAgentEvents(proc, input.abortSignal);
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
