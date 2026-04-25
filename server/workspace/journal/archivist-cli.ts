// Transport layer for the journal archivist: wraps the Claude Code
// CLI as a subprocess so summarization runs against the user's
// subscription quota rather than the API key budget.
//
// The pure data shapes (interfaces, prompts, validators) live in
// `./archivist-schemas.ts`. This file is the only one that touches
// `node:child_process`, kept thin so dependency injection in tests
// never has to mock a subprocess.

import { spawn } from "node:child_process";
import { CLI_SUBPROCESS_TIMEOUT_MS } from "../../utils/time.js";

// (systemPrompt, userPrompt) → raw model output as a string.
// The daily/optimization passes parse JSON out of the string
// themselves; this layer stays transport-only.
export type Summarize = (systemPrompt: string, userPrompt: string) => Promise<string>;

// Wall-clock cap per CLI invocation. 5 minutes is comfortably above
// the worst-case summarization run we've seen and still short enough
// that a wedged subprocess doesn't tie up resources forever.
const CLI_TIMEOUT_MS = CLI_SUBPROCESS_TIMEOUT_MS;

// Sentinel thrown on ENOENT. Each subsystem catches this and decides
// what to do — journal disables itself for the rest of the server
// lifetime; chat-index / sources log and skip. The message is
// subsystem-neutral so callers logging `err.message` verbatim (e.g.
// chat-index) don't surface a misleading "journal disabled" warning.
export class ClaudeCliNotFoundError extends Error {
  constructor() {
    super("`claude` CLI is not available on PATH");
    this.name = "ClaudeCliNotFoundError";
  }
}

export class ClaudeCliFailedError extends Error {
  readonly exitCode: number | null;
  readonly stderr: string;
  constructor(exitCode: number | null, stderr: string) {
    super(`\`claude\` CLI exited ${exitCode ?? "(killed)"}: ${stderr.slice(0, 500)}`);
    this.name = "ClaudeCliFailedError";
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

// Default summarizer. Spawns `claude -p` and pipes the combined
// system + user prompt to stdin so we don't hit shell-argv limits
// for large day excerpts.
export const runClaudeCli: Summarize = async (systemPrompt, userPrompt) => {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", "--output-format", "text"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, CLI_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err: Error & { code?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (err.code === "ENOENT") {
        reject(new ClaudeCliNotFoundError());
      } else {
        reject(err);
      }
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (timedOut) {
        reject(new ClaudeCliFailedError(null, `timed out after ${CLI_TIMEOUT_MS}ms\n${stderr}`));
        return;
      }
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new ClaudeCliFailedError(code, stderr));
      }
    });

    // Surface stdin write errors (e.g. EPIPE if the child exited
    // before we finished writing) instead of silently dropping them.
    child.stdin.on("error", (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    });

    // Send the full prompt in one write. If Node's stream layer
    // signals backpressure (write returns false), wait for "drain"
    // before calling end() so we don't close stdin while the buffer
    // still has data to flush. For typical archivist prompts this
    // path rarely fires, but very large session excerpts can reach
    // it.
    const payload = `${systemPrompt}\n\n---\n\n${userPrompt}`;
    const flushed = child.stdin.write(payload);
    if (flushed) {
      child.stdin.end();
    } else {
      child.stdin.once("drain", () => child.stdin.end());
    }
  });
};
