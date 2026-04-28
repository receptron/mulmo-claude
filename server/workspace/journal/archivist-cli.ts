// Spawning the Claude Code CLI runs summarization against the user's subscription quota rather than the API-key budget.

import { spawn } from "node:child_process";
import { CLI_SUBPROCESS_TIMEOUT_MS } from "../../utils/time.js";

export type Summarize = (systemPrompt: string, userPrompt: string) => Promise<string>;

const CLI_TIMEOUT_MS = CLI_SUBPROCESS_TIMEOUT_MS;

// Subsystem-neutral message: chat-index / sources also catch this and would otherwise log a misleading "journal disabled".
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

// Pipe the combined prompt via stdin to dodge shell-argv limits for large day excerpts.
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

    // Surface EPIPE etc. — child may exit before we finish writing.
    child.stdin.on("error", (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    });

    // Wait for "drain" on backpressure before end() so the buffer fully flushes — large excerpts can hit this path.
    const payload = `${systemPrompt}\n\n---\n\n${userPrompt}`;
    const flushed = child.stdin.write(payload);
    if (flushed) {
      child.stdin.end();
    } else {
      child.stdin.once("drain", () => child.stdin.end());
    }
  });
};
