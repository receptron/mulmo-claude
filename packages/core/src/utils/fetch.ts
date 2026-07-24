// Canonical `fetch` with a finite timeout for the whole monorepo. The host
// (`server/utils/fetch.ts`), the collection registry engine and the Google
// engine all re-export / import this one copy — before #2398 the same helper
// existed three times, so #2221's caller-signal-composition fix could only land
// in one of them. Server-only surface (`@mulmoclaude/core/fetch`).

const ONE_SECOND_MS = 1_000;

// 10 s is long enough for a healthy round-trip (localhost or a healthy upstream)
// but short enough that a stuck peer returns an error well before any client-side
// tool-call timeout fires. Callers talking to slow external APIs override via
// `timeoutMs`.
export const DEFAULT_FETCH_TIMEOUT_MS = 10 * ONE_SECOND_MS;

// `Parameters<typeof fetch>[1]` avoids referencing the ambient `RequestInit`
// type, which ESLint's `no-undef` rule trips over in the server config. The
// resulting type is identical to `RequestInit & { timeoutMs?: number }`.
export type FetchWithTimeoutInit = Parameters<typeof fetch>[1] & { timeoutMs?: number };

/**
 * `fetch` with a finite timeout. Rejects with a `TimeoutError` once `timeoutMs`
 * elapses. Composes with a caller-supplied `signal` so external cancellation
 * still works (#2221 — do not overwrite the caller's signal).
 */
export async function fetchWithTimeout(url: string | URL, init: FetchWithTimeoutInit = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, signal: callerSignal, ...rest } = init;

  // Surface an already-aborted caller signal before we touch the network at all,
  // so callers get a deterministic rejection and no fetch side-effects.
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

// Propagate aborts from a caller-supplied signal into our internal controller.
// Returns a disposer so the listener is removed on normal completion — otherwise
// a long-lived caller signal would leak listeners across many fetches.
function bridgeExternalSignal(external: AbortSignal | null | undefined, controller: AbortController): (() => void) | null {
  if (!external) return null;
  const onAbort = () => controller.abort(external.reason);
  external.addEventListener("abort", onAbort, { once: true });
  return () => external.removeEventListener("abort", onAbort);
}
