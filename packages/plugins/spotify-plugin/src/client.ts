// Spotify Web API client — wraps `runtime.fetch` with proactive
// refresh near expiry + a single 401 → refresh → retry-once loop.
//
// Why retry only once: a second 401 after refresh means the
// refresh token is revoked / rotated, and looping would just
// hammer Spotify's token endpoint. Surface `auth_expired` and let
// the user reconnect.
//
// Refresh-path failures are split into two classes (CodeRabbit
// review on PR #1166): `auth_expired` only when Spotify actually
// rejected the refresh token (4xx, or protocol-malformed response),
// and `transient_error` for network / 5xx / parse failures so the
// user isn't told to reconnect during a Spotify outage.

import type { PluginRuntime } from "gui-chat-protocol";
import { errorMessage } from "@mulmoclaude/common";

import { mergeRefreshResponse, writeTokens } from "./tokens";
import { ONE_SECOND_MS } from "./time";
import type { RefreshResponseFields, SpotifyTokens } from "./types";

const SPOTIFY_API_BASE = "https://api.spotify.com";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API_HOST = "api.spotify.com";
const SPOTIFY_TOKEN_HOST = "accounts.spotify.com";

const FETCH_TIMEOUT_MS = 15 * ONE_SECOND_MS;

/** Treat tokens within this window of expiry as already expired so
 *  a request that races the boundary refreshes proactively instead
 *  of waiting for the 401. */
const EXPIRY_LEEWAY_MS = 30 * ONE_SECOND_MS;

const RETRY_AFTER_FALLBACK_SEC = 60;

/** Reasons the client returns instead of throwing. The dispatch
 *  layer (`index.ts`) maps these to the user-facing `instructions`
 *  field of the SpotifyError union.
 *
 *  `auth_expired` means the credential is unusable — refresh token
 *  was rejected by Spotify, or the protocol response was malformed
 *  in a way that's indistinguishable from rejection. The user has to
 *  reconnect.
 *
 *  `transient_error` means the refresh path failed in a way that
 *  doesn't imply the credential is bad — network timeout, 5xx from
 *  Spotify, JSON parse failure (likely proxy / middleware). Caller
 *  should retry later, NOT prompt the user to reconnect. */
export type SpotifyClientError =
  | { kind: "not_connected" }
  | { kind: "auth_expired"; detail: string }
  | { kind: "transient_error"; detail: string }
  | { kind: "rate_limited"; retryAfterSec: number }
  | { kind: "spotify_api_error"; status: number; body: string };

export type SpotifyClientResult<T> = { ok: true; data: T } | { ok: false; error: SpotifyClientError };

interface RawTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
}

/** Make an authenticated Spotify API call. Path is relative to
 *  `https://api.spotify.com` (e.g. `/v1/me/player/recently-played`). */
export async function spotifyApi<T = unknown>(
  runtime: PluginRuntime,
  clientId: string,
  initialTokens: SpotifyTokens,
  method: "GET" | "POST" | "PUT" | "DELETE",
  apiPath: string,
  init: { body?: unknown } = {},
  now: () => Date = () => new Date(),
): Promise<SpotifyClientResult<T>> {
  let tokens = initialTokens;
  if (needsProactiveRefresh(tokens, now())) {
    const refreshed = await refreshTokens(runtime, clientId, tokens, now);
    if (!refreshed.ok) return { ok: false, error: refreshed.error };
    tokens = refreshed.tokens;
  }
  const firstAttempt = await callOnce<T>(runtime, method, apiPath, init, tokens);
  if (firstAttempt.ok || firstAttempt.error.kind !== "auth_expired") return firstAttempt;

  // 401 reactive refresh. Only one retry — a second 401 after
  // refresh signals a revoked refresh token; reconnect is the only
  // recovery.
  const refreshed = await refreshTokens(runtime, clientId, tokens, now);
  if (!refreshed.ok) return { ok: false, error: refreshed.error };
  return callOnce<T>(runtime, method, apiPath, init, refreshed.tokens);
}

function needsProactiveRefresh(tokens: SpotifyTokens, now: Date): boolean {
  const expiresAtMs = Date.parse(tokens.expiresAt);
  if (Number.isNaN(expiresAtMs)) return true; // corrupt / unknown — refresh defensively
  return expiresAtMs - now.getTime() <= EXPIRY_LEEWAY_MS;
}

async function callOnce<T>(
  runtime: PluginRuntime,
  method: "GET" | "POST" | "PUT" | "DELETE",
  apiPath: string,
  init: { body?: unknown },
  tokens: SpotifyTokens,
): Promise<SpotifyClientResult<T>> {
  let response: Response;
  try {
    response = await runtime.fetch(`${SPOTIFY_API_BASE}${apiPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      timeoutMs: FETCH_TIMEOUT_MS,
      allowedHosts: [SPOTIFY_API_HOST],
    });
  } catch (err) {
    return { ok: false, error: { kind: "spotify_api_error", status: 0, body: errorMessage(err) } };
  }
  if (response.status === 401) {
    return { ok: false, error: { kind: "auth_expired", detail: "Spotify returned 401" } };
  }
  if (response.status === 429) {
    return { ok: false, error: { kind: "rate_limited", retryAfterSec: parseRetryAfterSec(response.headers.get("Retry-After")) } };
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { ok: false, error: { kind: "spotify_api_error", status: response.status, body: body.slice(0, 500) } };
  }
  if (response.status === 204) return { ok: true, data: null as T };
  try {
    const data = (await response.json()) as T;
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: { kind: "spotify_api_error", status: response.status, body: errorMessage(err) } };
  }
}

/** Refresh the access token using the persisted refreshToken and
 *  persist the merged result. */
async function refreshTokens(
  runtime: PluginRuntime,
  clientId: string,
  tokens: SpotifyTokens,
  now: () => Date,
): Promise<{ ok: true; tokens: SpotifyTokens } | { ok: false; error: SpotifyClientError }> {
  let response: Response;
  try {
    response = await runtime.fetch(SPOTIFY_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken,
        client_id: clientId,
      }).toString(),
      timeoutMs: FETCH_TIMEOUT_MS,
      allowedHosts: [SPOTIFY_TOKEN_HOST],
    });
  } catch (err) {
    return { ok: false, error: { kind: "transient_error", detail: `refresh fetch failed: ${errorMessage(err)}` } };
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    runtime.log.warn("refresh failed", { status: response.status, body: body.slice(0, 200) });
    // 4xx ⇒ Spotify rejected the refresh token (revoked, malformed,
    // client_id mismatch). 5xx ⇒ Spotify is having an outage; the
    // credential may still be valid. Don't conflate the two — but
    // 408 (Request Timeout) and 429 (Too Many Requests) are also
    // transient: the credential wasn't actually checked, so forcing
    // a re-auth would be wrong.
    const status = response.status;
    const isTransient = status >= 500 || status === 408 || status === 429;
    const kind = isTransient ? "transient_error" : "auth_expired";
    return { ok: false, error: { kind, detail: `refresh returned ${status}` } };
  }
  let parsed: RawTokenResponse;
  try {
    parsed = (await response.json()) as RawTokenResponse;
  } catch (err) {
    // Non-JSON response on a 2xx is almost certainly a proxy /
    // middleware error page — transient, not credential-related.
    return { ok: false, error: { kind: "transient_error", detail: `refresh response parse failed: ${errorMessage(err)}` } };
  }
  const refreshFields = parseRefreshResponse(parsed);
  if (!refreshFields) {
    // Spotify returned 2xx JSON without access_token / expires_in.
    // Indistinguishable from a refresh-token rejection at the protocol
    // level — surface as auth_expired so the user reconnects.
    return { ok: false, error: { kind: "auth_expired", detail: "refresh response missing access_token / expires_in" } };
  }
  const merged = mergeRefreshResponse(tokens, refreshFields, now());
  await writeTokens(runtime.files.config, merged);
  return { ok: true, tokens: merged };
}

function parseRefreshResponse(raw: RawTokenResponse): RefreshResponseFields | null {
  if (typeof raw.access_token !== "string" || raw.access_token.length === 0) return null;
  if (typeof raw.expires_in !== "number" || !Number.isFinite(raw.expires_in)) return null;
  return {
    accessToken: raw.access_token,
    refreshToken: typeof raw.refresh_token === "string" && raw.refresh_token.length > 0 ? raw.refresh_token : undefined,
    expiresInSec: raw.expires_in,
    scopes: typeof raw.scope === "string" ? raw.scope.split(" ").filter(Boolean) : undefined,
  };
}

/** Parse a `Retry-After` header. Spotify normally returns delta-
 *  seconds (an integer) but the RFC also allows HTTP-date format.
 *  Anything non-finite or non-positive collapses to a safe 60s
 *  fallback so callers never propagate `NaN` (Codex review on
 *  PR #1164 caught this). */
export function parseRetryAfterSec(headerValue: string | null): number {
  if (headerValue === null) return RETRY_AFTER_FALLBACK_SEC;
  const trimmed = headerValue.trim();
  if (trimmed === "") return RETRY_AFTER_FALLBACK_SEC;
  // delta-seconds path — pure integer.
  const asInt = Number.parseInt(trimmed, 10);
  if (Number.isFinite(asInt) && asInt > 0 && String(asInt) === trimmed) return asInt;
  // HTTP-date path — parse and diff against now.
  const asDateMs = Date.parse(trimmed);
  if (Number.isFinite(asDateMs)) {
    const deltaSec = Math.ceil((asDateMs - Date.now()) / ONE_SECOND_MS);
    if (deltaSec > 0) return deltaSec;
  }
  return RETRY_AFTER_FALLBACK_SEC;
}
