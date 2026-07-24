// Surfaces the underlying provider error that mulmocast swallows when a
// generation fails. mulmocast catches the real error (missing API key,
// quota, moderation, …), logs it via GraphAILogger.error, and rethrows a
// generic wrapper like "generateReferenceImage: generate error: key=x" —
// and `setGraphAILogger(false)` (called per request in buildContext to
// silence GraphAI's chatty info/debug output) turns off even the error
// level, so the true cause used to vanish entirely.
//
// Moved verbatim from MulmoClaude's server/utils/mulmoErrorCapture.ts in
// phase 3 (only mulmoScript code ever used it). Hosts must resolve ONE
// hoisted `graphai` copy shared with their `mulmocast` — GraphAILogger
// state is module-local, and a second copy would break this capture
// silently. That's why `graphai` is a peer dependency.

import { AsyncLocalStorage } from "node:async_hooks";
import { GraphAILogger } from "graphai";
import { errorMessage } from "@mulmoclaude/common";
import { isRecord } from "./support";
import type { MulmoScriptServerLog } from "./types";

const capturedErrors = new AsyncLocalStorage<string[]>();
let loggerInstalled = false;
let captureLog: MulmoScriptServerLog | null = null;

/** Route captured GraphAI errors into the host logger. Set once by
 *  `createMulmoScriptServerOps`; the GraphAILogger sink is global, so the
 *  last-configured host logger wins (one ops instance per process). */
export function setMulmoErrorCaptureLogger(log: MulmoScriptServerLog | null): void {
  captureLog = log;
}

function formatLogArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return arg.message;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

/**
 * Re-enable GraphAI's error level (everything else stays silenced) and
 * route it into the host logger + the per-operation capture store.
 * Call after every `setGraphAILogger(false)` — that helper disables all
 * levels including error. Idempotent.
 */
export function enableGraphAIErrorCapture(): void {
  GraphAILogger.setLevelEnabled("error", true);
  if (loggerInstalled) return;
  loggerInstalled = true;
  GraphAILogger.setLogger((level, ...args) => {
    if (level !== "error") return;
    const message = args.map(formatLogArg).join(" ");
    captureLog?.warn("mulmocast generation error", { message });
    capturedErrors.getStore()?.push(message);
  });
}

// Structured-`cause` fields mulmocast attaches for i18n notifications
// (mulmocast lib/utils/error_cause.js) — agent + error type identify
// which provider failed; envVarName names a missing API key outright.
const CAUSE_FIELDS = ["type", "agentName", "envVarName", "errorCode", "errorType"] as const;

/** Render mulmocast's structured error `cause` as "field=value" pairs. */
export function describeMulmoCause(err: unknown): string | null {
  if (!(err instanceof Error) || !isRecord(err.cause)) return null;
  const { cause } = err;
  const parts = CAUSE_FIELDS.flatMap((field) => {
    const value = cause[field];
    return typeof value === "string" && value !== "" ? [`${field}=${value}`] : [];
  });
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * Compose the enriched message for a failed mulmocast operation:
 * mulmocast's own message, then its structured cause, then the
 * captured underlying provider error(s). Deduped — GraphAI retries
 * log the same error more than once.
 */
export function composeMulmoErrorMessage(err: unknown, captured: readonly string[]): string {
  const base = errorMessage(err);
  const details = [...new Set(captured)].filter((message) => message !== "" && message !== base);
  return [base, describeMulmoCause(err), ...details].filter(Boolean).join(" — ");
}

/**
 * Run a mulmocast operation, capturing GraphAI error logs emitted while
 * it executes. On failure, rethrows with the captured provider error(s)
 * appended to the message (original error kept as `cause`). Uses
 * AsyncLocalStorage so concurrent operations don't cross-attribute.
 */
export async function withMulmoErrorCapture<T>(operation: () => Promise<T>): Promise<T> {
  return capturedErrors.run([], async () => {
    try {
      return await operation();
    } catch (err) {
      throw new Error(composeMulmoErrorMessage(err, capturedErrors.getStore() ?? []), { cause: err });
    }
  });
}
