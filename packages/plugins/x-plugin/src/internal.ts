// Self-contained ports of the few host utilities the X tools relied on,
// inlined so the package carries no dependency on MulmoClaude's server tree
// (server/utils/{fetch,http,time}). Kept faithful to the originals; see
// the matching files in the host repo for rationale. `errorMessage` (#2461)
// and `toUtcIsoDate` (#2480) are the exceptions: they come from the shared
// leaf `@mulmoclaude/common`.

export const ONE_SECOND_MS = 1_000;

/** Best-effort response body text, capped, never throwing.
 *  Mirrors server/utils/http.ts `safeResponseText`. */
export async function safeResponseText(res: Response, maxLength = 200): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, maxLength);
  } catch {
    return "";
  }
}

/** `signal` is deliberately excluded. This compact port owns the signal it
 *  passes to `fetch`, so a caller-supplied one would be silently overwritten
 *  and dropped — no type error, no runtime error, just an abort that never
 *  arrives (#2221). Omitting it from the type turns that misuse into a compile
 *  error instead. If external cancellation is ever needed here, port the
 *  bridging from `server/utils/fetch.ts` rather than re-widening this type. */
export type FetchWithTimeoutInit = Omit<NonNullable<Parameters<typeof fetch>[1]>, "signal"> & { timeoutMs?: number };

/** `fetch` with a finite timeout that aborts the request once `timeoutMs`
 *  elapses. Compact port of server/utils/fetch.ts `fetchWithTimeout` — the X
 *  tools never pass a caller signal, so the external-signal bridging is omitted. */
export async function fetchWithTimeout(url: string | URL, init: FetchWithTimeoutInit = {}): Promise<Response> {
  const { timeoutMs = 10 * ONE_SECOND_MS, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException(`fetch timed out after ${timeoutMs}ms`, "TimeoutError"));
  }, timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
