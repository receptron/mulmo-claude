// Microsoft Teams platform plugin.
//
// Required secrets (wrangler secret put):
//   MICROSOFT_APP_ID       — App ID from Azure Bot registration
//   MICROSOFT_APP_PASSWORD — Client secret (App password)
//
// Optional:
//   MICROSOFT_APP_TYPE      — "MultiTenant" (default) | "SingleTenant"
//   MICROSOFT_APP_TENANT_ID — AAD tenant ID (required when SingleTenant)
//   TEAMS_ALLOWED_USERS     — CSV of AAD user object IDs (empty = all)
//
// Verification: Teams posts activities with Authorization: Bearer <JWT>.
// We check all of: issuer, audience (= MICROSOFT_APP_ID), exp, signature
// against JWKS (per-tenant URL for SingleTenant, Bot Framework URL for
// MultiTenant), `serviceurl` claim == activity.serviceUrl,
// activity.channelId == "msteams", and — for MultiTenant — that the
// signing key is endorsed for the `msteams` channel. See
// teams-verify.ts for the pure validator functions.
//
// Replies: Teams needs an OAuth2 access token obtained from
// login.microsoftonline.com with MICROSOFT_APP_ID + MICROSOFT_APP_PASSWORD
// against scope https://api.botframework.com/.default. The reply itself
// POSTs to <activity.serviceUrl>/v3/conversations/<conversation.id>/activities
// — the serviceUrl varies per region and we carry it through via the
// existing RelayMessage.replyToken channel (opaque to the relay core).

import { chunkText } from "@mulmobridge/client/text";
import { PLATFORMS, type RelayMessage, type Env } from "../types.js";
import { registerPlatform, CONNECTION_MODES, type PlatformPlugin } from "../platform.js";
import { ONE_HOUR_MS, ONE_HOUR_S, TEN_SECONDS_MS, FIFTEEN_SECONDS_MS } from "../time.js";
import { validateTokenClaims, validateJwkEndorsement, isAllowedSender, type AppType } from "./teams-verify.js";
import { makeUuid } from "../utils/id.js";

const MULTITENANT_ISSUER = "https://api.botframework.com";
const MULTITENANT_JWKS_URL = "https://login.botframework.com/v1/.well-known/keys";
const TOKEN_URL = "https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token";
const TOKEN_SCOPE = "https://api.botframework.com/.default";
const MAX_TEAMS_TEXT = 28_000; // Teams soft limit is 40k; leave headroom
const JWKS_CACHE_TTL_MS = ONE_HOUR_MS;
const TOKEN_REFRESH_SKEW_SEC = 300; // refresh 5 min before expiry

// ── Type guards ─────────────────────────────────────────────────

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// ── Config helpers ──────────────────────────────────────────────

function getAppType(env: Env): AppType {
  const raw = typeof env.MICROSOFT_APP_TYPE === "string" ? env.MICROSOFT_APP_TYPE.trim() : "";
  return raw === "SingleTenant" ? "SingleTenant" : "MultiTenant";
}

function getTenantId(env: Env): string {
  return typeof env.MICROSOFT_APP_TENANT_ID === "string" ? env.MICROSOFT_APP_TENANT_ID.trim() : "";
}

function getJwksUrl(env: Env): string {
  if (getAppType(env) === "SingleTenant") {
    const tenantId = getTenantId(env);
    return `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;
  }
  return MULTITENANT_JWKS_URL;
}

function getExpectedIssuer(env: Env): string {
  if (getAppType(env) === "SingleTenant") {
    const tenantId = getTenantId(env);
    return `https://sts.windows.net/${tenantId}/`;
  }
  return MULTITENANT_ISSUER;
}

function getAllowedUsers(env: Env): Set<string> {
  const raw = typeof env.TEAMS_ALLOWED_USERS === "string" ? env.TEAMS_ALLOWED_USERS : "";
  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

// ── JWKS cache ──────────────────────────────────────────────────

interface JwkKey {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
  // Bot Framework JWKS publishes per-key channel endorsements; we
  // require `msteams` to be present for MultiTenant auth.
  endorsements?: string[];
}

interface JwksCacheEntry {
  keys: JwkKey[];
  expiresAt: number;
}

// Cache is keyed by JWKS URL so MultiTenant and SingleTenant modes can
// coexist (unusual, but cheap to support).
const jwksCache = new Map<string, JwksCacheEntry>();

async function fetchJwks(url: string): Promise<JwkKey[]> {
  const cached = jwksCache.get(url);
  if (cached && Date.now() < cached.expiresAt) return cached.keys;
  const res = await fetch(url, { signal: AbortSignal.timeout(TEN_SECONDS_MS) });
  if (!res.ok) return cached?.keys ?? [];
  const data: { keys?: unknown[] } = await res.json();
  if (!Array.isArray(data.keys)) return cached?.keys ?? [];
  const keys = data.keys
    .filter((key): key is Record<string, unknown> => isObj(key) && typeof key.kid === "string" && typeof key.n === "string")
    .map((key): JwkKey => {
      const endorsements = Array.isArray(key.endorsements) ? key.endorsements.filter((entry): entry is string => typeof entry === "string") : undefined;
      return {
        kid: String(key.kid),
        kty: typeof key.kty === "string" ? key.kty : "RSA",
        n: String(key.n),
        e: typeof key.e === "string" ? key.e : "AQAB",
        alg: typeof key.alg === "string" ? key.alg : undefined,
        endorsements,
      };
    });
  jwksCache.set(url, { keys, expiresAt: Date.now() + JWKS_CACHE_TTL_MS });
  return keys;
}

// ── JWT parsing + verification ──────────────────────────────────

function b64UrlDecode(str: string): Uint8Array {
  const padded = str
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(str.length + ((4 - (str.length % 4)) % 4), "=");
  return Uint8Array.from(atob(padded), (chr) => chr.charCodeAt(0));
}

interface ParsedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signInput: string;
  sig: Uint8Array;
}

function parseJwt(token: string): ParsedJwt | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64UrlDecode(parts[0]))) as Record<string, unknown>;
    const payload = JSON.parse(new TextDecoder().decode(b64UrlDecode(parts[1]))) as Record<string, unknown>;
    return { header, payload, signInput: `${parts[0]}.${parts[1]}`, sig: b64UrlDecode(parts[2]) };
  } catch {
    return null;
  }
}

// Verifies the JWT against all of: expected issuer/audience/exp, the
// activity body (serviceUrl + channelId cross-checks), the JWKS key's
// channel endorsements, and the RSA signature. All four must pass —
// signing key alone is not enough; see teams-verify.ts for rationale.
async function verifyTeamsJwt(authHeader: string | undefined, env: Env, activity: TeamsMessage): Promise<boolean> {
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7).trim();
  const jwt = parseJwt(token);
  if (!jwt) return false;

  const { header, payload } = jwt;
  const claimsOk = validateTokenClaims({
    payload,
    appId: String(env.MICROSOFT_APP_ID),
    expectedIssuer: getExpectedIssuer(env),
    nowSeconds: Math.floor(Date.now() / 1000),
    activity: { serviceUrl: activity.serviceUrl, channelId: activity.channelId },
  });
  if (!claimsOk) return false;

  const keyId = typeof header.kid === "string" ? header.kid : "";
  const alg = typeof header.alg === "string" ? header.alg : "RS256";
  const hashAlg = alg === "RS256" ? "SHA-256" : alg === "RS384" ? "SHA-384" : "SHA-512";
  const keys = await fetchJwks(getJwksUrl(env));
  const jwk = keys.find((key) => key.kid === keyId);
  if (!jwk) return false;
  if (!validateJwkEndorsement(jwk, getAppType(env))) return false;

  const pubKey = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: hashAlg }, false, ["verify"]);
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", pubKey, jwt.sig, new TextEncoder().encode(jwt.signInput));
}

// ── Activity parsing ────────────────────────────────────────────

interface TeamsMessage {
  conversationId: string;
  senderId: string;
  senderAadObjectId: string;
  text: string;
  serviceUrl: string;
  channelId: string;
}

// Wrapper around parseActivity that also tolerates non-JSON bodies.
// Returns null for any reason the webhook should still ack 200 OK
// (malformed JSON, non-message activity, missing required fields).
// Exported for regression tests — the handler inlines the same two
// steps (JSON.parse → parseActivity).
export function parseWebhookBody(body: string): TeamsMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  return parseActivity(parsed);
}

function parseActivity(body: unknown): TeamsMessage | null {
  if (!isObj(body)) return null;
  // Non-message activities (conversationUpdate, invoke, typing, …) are
  // legit but we don't forward them to MulmoClaude.
  if (body.type !== "message") return null;
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return null;
  const { conversation } = body;
  const { from } = body;
  const serviceUrl = typeof body.serviceUrl === "string" ? body.serviceUrl.trim() : "";
  const channelId = typeof body.channelId === "string" ? body.channelId.trim() : "";
  if (!isObj(conversation) || typeof conversation.id !== "string") return null;
  if (!isObj(from) || typeof from.id !== "string") return null;
  if (!serviceUrl) return null;
  return {
    conversationId: conversation.id,
    senderId: from.id,
    senderAadObjectId: typeof from.aadObjectId === "string" ? from.aadObjectId : "",
    text,
    serviceUrl,
    channelId,
  };
}

// ── OAuth2 token exchange ───────────────────────────────────────

interface TokenCache {
  token: string;
  expiresAt: number; // epoch seconds
}

let tokenCache: TokenCache | null = null;

async function getAccessToken(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.expiresAt - TOKEN_REFRESH_SKEW_SEC > now) {
    return tokenCache.token;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: String(env.MICROSOFT_APP_ID),
    client_secret: String(env.MICROSOFT_APP_PASSWORD),
    scope: TOKEN_SCOPE,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(TEN_SECONDS_MS),
  });
  if (!res.ok) {
    throw new Error(`Teams token exchange failed: ${res.status}`);
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (typeof data.access_token !== "string") {
    throw new Error("Teams token response missing access_token");
  }
  const ttlSec = typeof data.expires_in === "number" ? data.expires_in : ONE_HOUR_S;
  tokenCache = { token: data.access_token, expiresAt: now + ttlSec };
  return data.access_token;
}

// ── Plugin ──────────────────────────────────────────────────────

const teamsPlugin: PlatformPlugin = {
  name: PLATFORMS.teams,
  mode: CONNECTION_MODES.webhook,
  webhookPath: "/webhook/teams",

  isConfigured(env: Env): boolean {
    if (!env.MICROSOFT_APP_ID || !env.MICROSOFT_APP_PASSWORD) return false;
    if (getAppType(env) === "SingleTenant" && !getTenantId(env)) return false;
    return true;
  },

  async handleWebhook(request: Request, body: string, env: Env): Promise<RelayMessage[]> {
    // Parse the activity first so the JWT verifier can cross-check the
    // serviceUrl / channelId claims against the body. Non-JSON bodies
    // and non-message activities (typing, invoke, …) both return null
    // here — we ack 200 OK with no message, matching Bot Framework's
    // expectation and avoiding a spurious 500 on malformed payloads.
    const activity = parseWebhookBody(body);
    if (!activity) return [];

    const authHeader = request.headers.get("authorization") ?? undefined;
    const valid = await verifyTeamsJwt(authHeader, env, activity);
    if (!valid) throw new Error("Teams JWT verification failed");

    const allowed = getAllowedUsers(env);
    if (!isAllowedSender({ allowed, senderAadObjectId: activity.senderAadObjectId })) {
      // Drop messages from users not on the allowlist — still 200 OK
      // so the Bot Framework doesn't mark the endpoint as flaky.
      return [];
    }

    return [
      {
        id: makeUuid(),
        platform: PLATFORMS.teams,
        senderId: activity.senderAadObjectId || activity.senderId,
        chatId: activity.conversationId,
        text: activity.text,
        receivedAt: new Date().toISOString(),
        // Carry the activity's serviceUrl through the outbound path —
        // the relay's response routing treats replyToken as opaque.
        replyToken: activity.serviceUrl,
      },
    ];
  },

  async sendResponse(chatId: string, text: string, env: Env, replyToken?: string): Promise<void> {
    const serviceUrl = typeof replyToken === "string" ? replyToken.trim() : "";
    if (!serviceUrl) {
      throw new Error("Teams sendResponse missing serviceUrl (no prior inbound message to reply to)");
    }
    const accessToken = await getAccessToken(env);
    const base = serviceUrl.replace(/\/$/, "");
    const endpoint = `${base}/v3/conversations/${encodeURIComponent(chatId)}/activities`;

    for (const chunk of chunkText(text, MAX_TEAMS_TEXT)) {
      let res: Response;
      try {
        res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ type: "message", text: chunk }),
          signal: AbortSignal.timeout(FIFTEEN_SECONDS_MS),
        });
      } catch (err) {
        throw new Error(`Teams API network error: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`Teams API failed: ${res.status} ${detail.slice(0, 200)}`);
      }
    }
  },
};

registerPlatform(teamsPlugin);
