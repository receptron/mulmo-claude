// Helpers for formatting errors from `spawn`-ed Claude CLI subprocesses.
// Previously duplicated in chat-index/summarizer, sources/summarize,
// and sources/classifier — each with its own log prefix but identical
// logic. Consolidated as part of the server/utils grouping.

import { isRecord } from "./types.js";

const PREVIEW_LEN = 500;

/**
 * Extract a structured error message from Claude CLI JSON stdout.
 *
 * The Claude CLI writes a JSON envelope on stdout when it exits
 * with an error (budget exhaustion, auth failure, etc.). This
 * function extracts the human-readable reason from that envelope.
 * Returns `null` if stdout is not parseable JSON or the envelope
 * does not indicate an error.
 */
export function extractClaudeErrorMessage(stdout: string): string | null {
  const text = stdout.trim();
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed.is_error !== true) return null;
  if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
    const joined = parsed.errors.filter((err): err is string => typeof err === "string").join("; ");
    if (joined.length > 0) return joined;
  }
  const subtype = typeof parsed.subtype === "string" ? parsed.subtype : "";
  const result = typeof parsed.result === "string" ? parsed.result : "";
  if (subtype && result) return `${subtype}: ${result}`;
  return subtype || result || null;
}

/**
 * Build a human-readable error message from a Claude CLI spawn failure.
 *
 * Tries structured JSON extraction first (stdout), then falls back to
 * stderr (plain text), then stdout as a last resort. The `prefix` is
 * prepended for log-grep-ability (e.g. `"[chat-index]"`,
 * `"[sources/classifier]"`).
 */
export function formatSpawnFailure(prefix: string, code: number | null, stdout: string, stderr: string): string {
  const structured = extractClaudeErrorMessage(stdout);
  if (structured) {
    return `${prefix} claude exited ${code}: ${structured}`;
  }
  const trimmedStderr = stderr.trim();
  if (trimmedStderr.length > 0) {
    return `${prefix} claude exited ${code}: ${trimmedStderr.slice(0, PREVIEW_LEN)}`;
  }
  const trimmedStdout = stdout.trim();
  if (trimmedStdout.length > 0) {
    return `${prefix} claude exited ${code}: ${trimmedStdout.slice(0, PREVIEW_LEN)}`;
  }
  return `${prefix} claude exited ${code}: no error output`;
}
