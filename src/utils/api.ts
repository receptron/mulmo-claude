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

import { errorMessage } from "./errors";
import { hasStringProp } from "./types";

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
  const status = res.status;
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
    return {
      ok: false,
      error: errorMessage(err),
      status: 0,
    };
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
  return fetch(url, init);
}
