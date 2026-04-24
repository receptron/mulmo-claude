// Helpers for server-side fetch() calls. The MCP stdio bridge
// (`server/agent/mcp-server.ts`) makes multiple fetch calls to
// the host Express server and repeated the same error-extraction
// pattern at every call site.

import { ONE_SECOND_MS } from "./time.js";
import { isRecord } from "./types.js";

// 10 s is long enough for a healthy localhost round-trip (the common
// case) but short enough that a stuck Express handler returns a tool
// error well before the MCP client's own 30–60 s tool-call timeout
// fires. Callers that talk to slow external APIs (e.g. X / Twitter
// under rate limit) should override via `timeoutMs`.
export const DEFAULT_FETCH_TIMEOUT_MS = 10 * ONE_SECOND_MS;

// `Parameters<typeof fetch>[1]` avoids referencing the ambient `RequestInit`
// type, which ESLint's `no-undef` rule trips over in the server config. The
// resulting type is identical to `RequestInit & { timeoutMs?: number }`.
export type FetchWithTimeoutInit = Parameters<typeof fetch>[1] & { timeoutMs?: number };

/**
 * `fetch` with a finite timeout. Rejects with a `TimeoutError` once
 * `timeoutMs` elapses. Composes with a caller-supplied `signal` so
 * external cancellation still works.
 */
export async function fetchWithTimeout(url: string | URL, init: FetchWithTimeoutInit = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, signal: callerSignal, ...rest } = init;

  // Surface an already-aborted caller signal before we touch the
  // network at all, so callers get a deterministic rejection and no
  // fetch side-effects (DNS lookup, connection, etc.).
  if (callerSignal?.aborted) {
    throw callerSignal.reason ?? new DOMException("Aborted", "AbortError");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException(`fetch timed out after ${timeoutMs}ms`, "TimeoutError"));
  }, timeoutMs);

  const unsubscribeCaller = bridgeExternalSignal(callerSignal, controller);

  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    unsubscribeCaller?.();
  }
}

// Propagate aborts from a caller-supplied signal into our internal
// controller. Returns a disposer so the listener is removed on normal
// completion — otherwise a long-lived caller signal would leak
// listeners across many fetches.
function bridgeExternalSignal(external: AbortSignal | null | undefined, controller: AbortController): (() => void) | null {
  if (!external) return null;
  const onAbort = () => controller.abort(external.reason);
  external.addEventListener("abort", onAbort, { once: true });
  return () => external.removeEventListener("abort", onAbort);
}

/**
 * Extract a human-readable error string from a non-ok fetch Response.
 *
 * Tries to parse the body as `{ error: string }` (the shape every
 * MulmoClaude `/api/*` endpoint returns on failure). Falls back to
 * `"HTTP <status>"` when the body isn't JSON, isn't a plain object,
 * or doesn't contain an `error` string field.
 */
export async function extractFetchError(res: Response): Promise<string> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return `HTTP ${res.status}`;
  }
  if (isRecord(body) && typeof body.error === "string") {
    return body.error;
  }
  return `HTTP ${res.status}`;
}
