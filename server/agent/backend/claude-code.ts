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
import { tmpdir } from "node:os";
import type { Readable, Writable } from "stream";
import { buildCliArgs, buildDockerSpawnArgs, buildUserMessageLine } from "../config.js";
import { resolveSandboxAuth } from "../sandboxMounts.js";
import { getCachedReferenceDirs, referenceDirMountArgs } from "../../workspace/reference-dirs.js";
import { createStreamParser, type AgentEvent, type RawStreamEvent } from "../stream.js";
import { log } from "../../system/logger/index.js";
import { EVENT_TYPES } from "../../../src/types/events.js";
import { env } from "../../system/env.js";
import { formatSpawnFailure } from "../../utils/spawn.js";
import { errorMessage } from "../../utils/errors.js";
import { isRecord } from "../../utils/types.js";
import { LLMBackendUnavailableError, type AgentInput, type GenerateInput, type LLMBackend } from "./types.js";
import { claudeCodeTuning, type ClaudeCodeProfile } from "./claude-code.tuning.js";

type ClaudeProc = ChildProcessByStdio<Writable, Readable, Readable>;

const SPAWN_PREFIX = "[claude-code]";

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

// ── One-shot generation ─────────────────────────────────────────────

interface SpawnOpts {
  args: string[];
  cwd?: string;
  /** When set, the payload is written to stdin and the pipe is
   *  closed after the write drains. Otherwise stdin is "ignore". */
  stdinPayload?: string;
  timeoutMs: number;
}

function runClaudeOneShot(opts: SpawnOpts): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const stdinPayload = opts.stdinPayload;
    const stdio: ["pipe" | "ignore", "pipe", "pipe"] = [stdinPayload !== undefined ? "pipe" : "ignore", "pipe", "pipe"];
    const proc = spawn("claude", opts.args, { cwd: opts.cwd, stdio });

    // stdio[1] and stdio[2] are always "pipe" so stdout/stderr are
    // guaranteed non-null. Narrow once via aliases instead of the
    // `?.` everywhere below.
    const procStdout = proc.stdout;
    const procStderr = proc.stderr;
    if (!procStdout || !procStderr) {
      reject(new Error(`${SPAWN_PREFIX} failed to attach to claude stdout/stderr pipes`));
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    const settleOnce = (action: () => void) => {
      if (settled) return;
      settled = true;
      action();
    };

    const timer = setTimeout(() => {
      settleOnce(() => {
        proc.kill("SIGKILL");
        reject(new Error(`${SPAWN_PREFIX} claude timed out after ${opts.timeoutMs}ms`));
      });
    }, opts.timeoutMs);

    procStdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    procStderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err: Error & { code?: string }) => {
      settleOnce(() => {
        clearTimeout(timer);
        if (err.code === "ENOENT") {
          reject(new LLMBackendUnavailableError("`claude` CLI is not available on PATH"));
        } else {
          reject(err);
        }
      });
    });

    proc.on("close", (code) => {
      settleOnce(() => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(formatSpawnFailure(SPAWN_PREFIX, code, stdout, stderr)));
          return;
        }
        resolve(stdout);
      });
    });

    if (stdinPayload !== undefined && proc.stdin) {
      const procStdin = proc.stdin;
      procStdin.on("error", (err: Error) => {
        settleOnce(() => {
          clearTimeout(timer);
          reject(err);
        });
      });
      // Send the full prompt in one write. If Node's stream layer
      // signals backpressure (write returns false), wait for "drain"
      // before calling end() so we don't close stdin while the
      // buffer still has data to flush. Typical archivist prompts
      // never hit this path; very large day excerpts can.
      const flushed = procStdin.write(stdinPayload);
      if (flushed) {
        procStdin.end();
      } else {
        procStdin.once("drain", () => procStdin.end());
      }
    }
  });
}

interface ClaudeJsonEnvelope {
  is_error?: boolean;
  structured_output?: unknown;
  result?: string;
  errors?: unknown;
  subtype?: string;
}

function parseEnvelope(stdout: string): ClaudeJsonEnvelope {
  let parsed: ClaudeJsonEnvelope;
  try {
    parsed = JSON.parse(stdout.trim()) as ClaudeJsonEnvelope;
  } catch (err) {
    throw new Error(`${SPAWN_PREFIX} failed to parse claude json output: ${errorMessage(err)}`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`${SPAWN_PREFIX} claude json output is not an object`);
  }
  if (parsed.is_error) {
    const fromErrors = Array.isArray(parsed.errors) ? parsed.errors.filter((value): value is string => typeof value === "string").join("; ") : "";
    const fromSubtypeResult = parsed.subtype && parsed.result ? `${parsed.subtype}: ${parsed.result}` : "";
    const msg = fromErrors || fromSubtypeResult || parsed.result || parsed.subtype || "unknown";
    throw new Error(`${SPAWN_PREFIX} claude returned error: ${msg}`);
  }
  return parsed;
}

function buildJsonArgs(input: GenerateInput, profile: ClaudeCodeProfile, schema?: object): string[] {
  const args: string[] = ["--print"];
  if (profile.noSessionPersistence) args.push("--no-session-persistence");
  args.push("--output-format", "json");
  if (profile.model) args.push("--model", profile.model);
  if (profile.maxBudgetUsd !== undefined) args.push("--max-budget-usd", String(profile.maxBudgetUsd));
  if (schema) args.push("--json-schema", JSON.stringify(schema));
  args.push("--system-prompt", input.systemPrompt);
  args.push("-p", input.userPrompt);
  return args;
}

// "text-stdin" — journal-archivist pattern. Concatenate system + user
// with a `---` separator and pipe the whole thing as stdin so very
// large prompts (full day's transcripts) don't hit shell argv limits.
async function spawnTextStdin(input: GenerateInput, profile: ClaudeCodeProfile): Promise<string> {
  const payload = `${input.systemPrompt}\n\n---\n\n${input.userPrompt}`;
  return runClaudeOneShot({
    args: ["-p", "--output-format", "text"],
    stdinPayload: payload,
    timeoutMs: profile.timeoutMs,
  });
}

// "text-envelope" — sources/pipeline/summarize pattern. argv-based
// prompt, json envelope (no schema). Adapter extracts the model's
// free-form text from envelope.result.
async function spawnTextEnvelope(input: GenerateInput, profile: ClaudeCodeProfile): Promise<string> {
  const args = buildJsonArgs(input, profile);
  const cwd = profile.isolatedFromProject ? tmpdir() : undefined;
  const stdout = await runClaudeOneShot({ args, cwd, timeoutMs: profile.timeoutMs });
  const envelope = parseEnvelope(stdout);
  const result = typeof envelope.result === "string" ? envelope.result : "";
  if (!result) {
    throw new Error(`${SPAWN_PREFIX} claude returned empty / missing result`);
  }
  return result;
}

// "json-schema" — chat-index-summary / source-classify pattern.
// argv-based prompt, json envelope with --json-schema. Adapter
// extracts envelope.structured_output as T.
async function spawnJsonSchema<T>(input: GenerateInput, schema: object, profile: ClaudeCodeProfile): Promise<T> {
  const args = buildJsonArgs(input, profile, schema);
  const cwd = profile.isolatedFromProject ? tmpdir() : undefined;
  const stdout = await runClaudeOneShot({ args, cwd, timeoutMs: profile.timeoutMs });
  const envelope = parseEnvelope(stdout);
  return envelope.structured_output as T;
}

async function generate(input: GenerateInput): Promise<string> {
  const profile = claudeCodeTuning[input.profile];
  if (profile.outputFormat === "json-schema") {
    throw new Error(`${SPAWN_PREFIX} profile '${input.profile}' is structured — use generateStructured()`);
  }
  return profile.outputFormat === "text-stdin" ? spawnTextStdin(input, profile) : spawnTextEnvelope(input, profile);
}

async function generateStructured<T>(input: GenerateInput, schema: object): Promise<T> {
  const profile = claudeCodeTuning[input.profile];
  if (profile.outputFormat !== "json-schema") {
    throw new Error(`${SPAWN_PREFIX} profile '${input.profile}' is text — use generate()`);
  }
  return spawnJsonSchema<T>(input, schema, profile);
}

export const claudeCodeBackend: LLMBackend = {
  id: "claude-code",
  capabilities: { sessionResume: true, mcp: true },
  runAgent: runClaudeAgent,
  generate,
  generateStructured,
};
