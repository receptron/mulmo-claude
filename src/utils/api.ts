// Single source of truth for Vue → MulmoClaude server HTTP calls.
//
// Before this module existed there were 56 scattered `fetch("/api/...")`
// calls across 29 files, each doing its own JSON serialization, its own
// `!res.ok` check, and its own ad-hoc error extraction. This made any
// cross-cutting concern — auth headers, error formatting, retry policy,
// logging — impossible to add without touching every call site.
//
// All HTTP traffic from the Vue app should now go through one of:
//
//   apiGet<T>(path, query?)
//   apiPost<T>(path, body?)
//   apiPut<T>(path, body?)
//   apiDelete<T>(path, body?)
//   apiCall<T>(path, opts)        ← generic, for methods not above
//   apiFetchRaw(path, opts)       ← when you need the raw Response
//                                   (binary, streaming, etc.)
//
// Return type is a discriminated union `ApiResult<T>`:
//
//   { ok: true, data: T }
//   { ok: false, error: string, status: number }
//
// Callers pattern-match on `result.ok` — no more mixing try/catch with
// `!res.ok` branches. Network errors and HTTP errors surface through the
// same `{ ok: false }` shape.
//
// Future extension hooks (see #272 for auth token):
//   - setAuthToken() populates a module-level token used by every call
//   - interceptors could go here for logging, retry, metrics

import { ref, type Ref } from "vue";
import { errorMessage } from "./errors";
import { hasStringProp } from "./types";

// ── Backend reachability signal (#1479) ─────────────────────────────
//
// `apiCall` returns `{ ok:false, status:0 }` when `fetch` itself
// throws — the classic "network error" / `ERR_CONNECTION_REFUSED`
// shape. That used to be silently swallowed feature-by-feature; now
// we flip a module-level ref so any consumer (App.vue's banner) can
// react. Eager: surfaces backend-down at the FIRST failing user-
// triggered fetch, no need to wait for the 15s health poll.

/** True while the backend appears reachable. Flipped to false on a
 *  `fetch` throw (network error, server stopped, DNS, etc.) and back
 *  to true on any successful HTTP response. */
export const backendReachable: Ref<boolean> = ref(true);

/** Last network-error message observed when `backendReachable` was
 *  flipped to false. Useful for the offline banner's small print. */
export const lastBackendError: Ref<string | null> = ref(null);

/** A `fetch` rejection that came from caller-driven `AbortController`
 *  cancellation (the spec says it's a `DOMException` with `name ===
 *  "AbortError"`). Normal flow — must NOT flip `backendReachable`. */
function isAbortError(err: unknown): boolean {
  if (typeof DOMException !== "undefined" && err instanceof DOMException && err.name === "AbortError") return true;
  return typeof err === "object" && err !== null && "name" in err && (err as { name: unknown }).name === "AbortError";
}

// ── Auth token (populated by bootstrap; consumed by every call) ─────

let authToken: string | null = null;

/**
 * Set the bearer token used on every API call. Call once during app
 * bootstrap, typically after reading a `<meta>` tag or window global
 * populated by the server.
 */
export function setAuthToken(token: string | null): void {
  authToken = token;
}

// ── Stale-token recovery ─────────────────────────────────────────────
//
// The server mints a fresh session token at every boot and embeds it
// into index.html's `<meta name="mulmoclaude-auth">`. A tab that was
// loaded BEFORE a server restart keeps sending the old bearer, so every
// call 401s until the user figures out a manual reload — the raw
// `Server error 401 {"error":"unauthorized"}` bubble gives no hint.
//
// Instead: on the first 401 we re-fetch "/" (no-store), pull the
// CURRENT token out of the served HTML, swap it in, and retry the
// request once. The refresh is single-flight so a burst of concurrent
// 401s (boot fires many fetches) triggers exactly one "/" round trip.
//
// The meta tag is parsed with a regex rather than DOMParser on purpose:
// this module deliberately avoids DOM lib globals (see the fetch-types
// comment above). The attribute order is stable — it comes from our own
// index.html template.

const AUTH_META_RE = /<meta\s+name="mulmoclaude-auth"\s+content="([^"]*)"/;

let tokenRefreshInflight: Promise<boolean> | null = null;

/** Re-read the auth token from the served index.html. Resolves true
 *  iff a non-empty token DIFFERENT from the current one was installed
 *  (i.e. a retry is worth attempting). */
function refreshStaleAuthToken(): Promise<boolean> {
  tokenRefreshInflight ??= (async () => {
    try {
      const res = await fetch("/", { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) return false;
      const fresh = AUTH_META_RE.exec(await res.text())?.[1] ?? "";
      if (fresh === "" || fresh === authToken) return false;
      authToken = fresh;
      return true;
    } catch {
      return false;
    } finally {
      // Re-arm for the future — the token can rotate again on the
      // next server restart. Deferred so every awaiter of THIS
      // refresh shares the same result first.
      queueMicrotask(() => {
        tokenRefreshInflight = null;
      });
    }
  })();
  return tokenRefreshInflight;
}

/** A body we can safely send twice. Streams are consumed by the first
 *  attempt and must not be replayed; everything MulmoClaude actually
 *  sends (JSON strings, FormData, Blob, undefined) is replayable. */
function isReplayableBody(body: unknown): boolean {
  if (body === undefined || body === null || typeof body === "string") return true;
  return typeof (body as { getReader?: unknown }).getReader !== "function";
}

// ── Types ────────────────────────────────────────────────────────────

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

export type ApiQuery = Record<string, string | number | boolean | undefined>;

export interface ApiOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** JSON-serialized into the request body. Omit for GET/DELETE. */
  body?: unknown;
  /** Appended as a query string. `undefined` values are dropped. */
  query?: ApiQuery;
  /** AbortSignal — pass through to fetch. */
  signal?: AbortSignal;
  /**
   * Extra headers. Content-Type is set automatically for JSON bodies;
   * Authorization is injected from `authToken`.
   */
  headers?: Record<string, string>;
}

// Use Parameters<typeof fetch> rather than global DOM lib types so
// this module doesn't depend on DOM lib being in the ESLint globals.
type FetchInit = Parameters<typeof fetch>[1];
type FetchBody = NonNullable<FetchInit>["body"];

// ── Internals ────────────────────────────────────────────────────────

function buildQueryString(query: ApiQuery | undefined): string {
  if (!query) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length === 0 ? "" : `?${parts.join("&")}`;
}

function buildHeaders(opts: { headers?: Record<string, string> }, hasBody: boolean): Record<string, string> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (hasBody && headers["Content-Type"] === undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (authToken && headers["Authorization"] === undefined) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }
  return headers;
}

async function extractError(res: Response): Promise<{ error: string; status: number }> {
  const { status } = res;
  // Try to parse a `{ error: string }` body first — that's the server's
  // standard error shape. `in` narrowing lets us read `body.error`
  // without any type assertion.
  try {
    const body: unknown = await res.clone().json();
    if (hasStringProp(body, "error")) {
      return { error: body.error, status };
    }
  } catch {
    // Body wasn't JSON — fall through.
  }
  return {
    error: res.statusText || `Request failed (${status})`,
    status,
  };
}

// ── Core call ───────────────────────────────────────────────────────

/**
 * Generic HTTP call. Returns a discriminated union on success vs
 * failure. Network errors are caught and surfaced as
 * `{ ok: false, status: 0 }`. Assumes JSON response bodies (all
 * MulmoClaude `/api/*` endpoints return JSON on success); use
 * `apiFetchRaw` for binary / streaming / non-JSON responses.
 */
export async function apiCall<T = unknown>(path: string, opts: ApiOptions = {}): Promise<ApiResult<T>> {
  const method = opts.method ?? "GET";
  const hasBody = opts.body !== undefined;
  const url = `${path}${buildQueryString(opts.query)}`;

  const init: FetchInit = {
    method,
    headers: buildHeaders(opts, hasBody),
    signal: opts.signal,
  };
  if (hasBody) {
    init.body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    const message = errorMessage(err);
    // `fetch` throws on EITHER a true network failure (server
    // stopped, DNS, CORS preflight) OR a caller-driven
    // AbortController cancellation. The second case is a normal flow
    // (file/plugin refresh races, navigation cancel) — flipping the
    // global offline flag for those would surface a false banner.
    // Only the first case warrants the signal.
    if (!isAbortError(err)) {
      backendReachable.value = false;
      lastBackendError.value = message;
    }
    return {
      ok: false,
      error: message,
      status: 0,
    };
  }

  // Any reply at all means the server is talking — re-arm the
  // reachable flag. HTTP-level errors (4xx/5xx) leave it true; only
  // network-error throws above flip it false.
  if (!backendReachable.value) {
    backendReachable.value = true;
    lastBackendError.value = null;
  }

  if (res.status === 401 && (await refreshStaleAuthToken())) {
    // Token was stale (server restarted since this tab loaded). A
    // fresh one is installed — replay the request once. JSON bodies
    // are plain strings, so resending `init` verbatim is safe.
    init.headers = buildHeaders(opts, hasBody);
    try {
      res = await fetch(url, init);
    } catch (err) {
      return { ok: false, error: errorMessage(err), status: 0 };
    }
  }

  if (!res.ok) {
    const { error, status } = await extractError(res);
    return { ok: false, error, status };
  }

  // `res.json()` returns `Promise<any>`, which is assignable to T
  // without a cast.
  try {
    const data: T = await res.json();
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: `Invalid JSON response: ${errorMessage(err)}`,
      status: res.status,
    };
  }
}

// ── Convenience verbs ───────────────────────────────────────────────

export function apiGet<T = unknown>(path: string, query?: ApiQuery, extra: Omit<ApiOptions, "method" | "body" | "query"> = {}): Promise<ApiResult<T>> {
  return apiCall<T>(path, { ...extra, method: "GET", query });
}

export function apiPost<T = unknown>(path: string, body?: unknown, extra: Omit<ApiOptions, "method" | "body"> = {}): Promise<ApiResult<T>> {
  return apiCall<T>(path, { ...extra, method: "POST", body });
}

export function apiPut<T = unknown>(path: string, body?: unknown, extra: Omit<ApiOptions, "method" | "body"> = {}): Promise<ApiResult<T>> {
  return apiCall<T>(path, { ...extra, method: "PUT", body });
}

export function apiPatch<T = unknown>(path: string, body?: unknown, extra: Omit<ApiOptions, "method" | "body"> = {}): Promise<ApiResult<T>> {
  return apiCall<T>(path, { ...extra, method: "PATCH", body });
}

export function apiDelete<T = unknown>(path: string, body?: unknown, extra: Omit<ApiOptions, "method" | "body"> = {}): Promise<ApiResult<T>> {
  return apiCall<T>(path, { ...extra, method: "DELETE", body });
}

// ── Raw Response escape hatch ───────────────────────────────────────

export interface RawOptions {
  method?: string;
  /** Accepts any value fetch accepts (string / Blob / FormData / …). */
  body?: FetchBody;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  query?: ApiQuery;
}

/**
 * Escape hatch for endpoints returning binary / streaming / non-JSON
 * bodies (PDF download, audio blob, SSE, etc.). Auth header is still
 * applied; other handling is the caller's responsibility.
 *
 * Throws on network errors. Does NOT check `res.ok`.
 */
export async function apiFetchRaw(path: string, opts: RawOptions = {}): Promise<Response> {
  const url = `${path}${buildQueryString(opts.query)}`;
  const init: FetchInit = {
    method: opts.method ?? "GET",
    headers: buildHeaders(opts, false),
    body: opts.body,
    signal: opts.signal,
  };
  const res = await fetch(url, init);
  // Same stale-token recovery as apiCall — this path carries the chat
  // send (`POST /api/agent`, SSE), which is exactly where users see the
  // raw 401 bubble after a server restart. Streams can't be replayed;
  // everything else (JSON strings, FormData, Blob) can.
  if (res.status === 401 && isReplayableBody(opts.body) && (await refreshStaleAuthToken())) {
    init.headers = buildHeaders(opts, false);
    return fetch(url, init);
  }
  return res;
}
