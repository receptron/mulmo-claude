// Google Chat platform plugin.
//
// Required secrets (wrangler secret put):
//   GOOGLE_CHAT_PROJECT_NUMBER      — Cloud project number (for JWT aud claim)
//
// Optional (enables async replies):
//   GOOGLE_CHAT_SERVICE_ACCOUNT_KEY — Service account JSON (stringified)
//
// Google Chat sends events via HTTP POST with an Authorization: Bearer JWT.
// Replies are delivered asynchronously via the Chat REST API when a
// service account key is configured; otherwise the relay acknowledges
// the message but cannot send replies back.

import { chunkText } from "@mulmobridge/client/text";
import { PLATFORMS, type RelayMessage, type Env } from "../types.js";
import { registerPlatform, CONNECTION_MODES, type PlatformPlugin } from "../platform.js";
import { ONE_HOUR_MS, ONE_HOUR_S, TEN_SECONDS_MS, FIFTEEN_SECONDS_MS } from "../time.js";

const GOOGLE_CHAT_ISSUER = "chat@system.gserviceaccount.com";
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/chat@system.gserviceaccount.com";
const JWKS_CACHE_TTL_MS = ONE_HOUR_MS;
const CHAT_API_BASE = "https://chat.googleapis.com/v1";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CHAT_SCOPE = "https://www.googleapis.com/auth/chat.bot";
const MAX_CHAT_TEXT = 4000;

// ── JWKS cache ──────────────────────────────────────────────────

interface JwkKey {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}
let cachedKeys: JwkKey[] = [];
let cacheExpiresAt = 0;

async function getJwks(): Promise<JwkKey[]> {
  if (Date.now() < cacheExpiresAt && cachedKeys.length > 0) return cachedKeys;
  const res = await fetch(JWKS_URL, { signal: AbortSignal.timeout(TEN_SECONDS_MS) });
  if (!res.ok) return cachedKeys;
  const data: { keys?: unknown[] } = await res.json();
  if (!Array.isArray(data.keys)) return cachedKeys;
  const isJwk = (key: unknown): key is JwkKey =>
    typeof key === "object" && key !== null && typeof (key as JwkKey).kid === "string" && typeof (key as JwkKey).n === "string";
  cachedKeys = data.keys.filter(isJwk);
  cacheExpiresAt = Date.now() + JWKS_CACHE_TTL_MS;
  return cachedKeys;
}

// ── JWT verification ────────────────────────────────────────────

function b64UrlDecode(str: string): Uint8Array {
  const padded = str
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(str.length + ((4 - (str.length % 4)) % 4), "=");
  return Uint8Array.from(atob(padded), (chr) => chr.charCodeAt(0));
}

function parseJwt(token: string): { header: Record<string, unknown>; payload: Record<string, unknown>; signInput: string; sig: Uint8Array } | null {
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

async function verifyGoogleJwt(authHeader: string | undefined, projectNumber: string): Promise<boolean> {
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7).trim();
  const jwt = parseJwt(token);
  if (!jwt) return false;
  const { payload, header } = jwt;
  if (payload.iss !== GOOGLE_CHAT_ISSUER) return false;
  if (String(payload.aud) !== projectNumber) return false;
  if (typeof payload.exp === "number" && payload.exp < Date.now() / 1000) return false;
  const keyId = typeof header.kid === "string" ? header.kid : "";
  const alg = typeof header.alg === "string" ? header.alg : "RS256";
  const hashAlg = alg === "RS256" ? "SHA-256" : alg === "RS384" ? "SHA-384" : "SHA-512";
  const keys = await getJwks();
  const jwk = keys.find((key) => key.kid === keyId);
  if (!jwk) return false;
  const pubKey = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: hashAlg }, false, ["verify"]);
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", pubKey, jwt.sig, new TextEncoder().encode(jwt.signInput));
}

// ── Payload parsing ─────────────────────────────────────────────

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

interface ChatMessage {
  spaceName: string;
  text: string;
}

function parseMessage(body: unknown): ChatMessage | null {
  if (!isObj(body) || body.type !== "MESSAGE") return null;
  const msg = body.message;
  if (!isObj(msg) || typeof msg.text !== "string") return null;
  const space = msg.space;
  if (!isObj(space) || typeof space.name !== "string") return null;
  return { spaceName: space.name, text: msg.text.trim() };
}

// ── Service account → access token ─────────────────────────────

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

function parseServiceAccount(raw: string): ServiceAccount | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isObj(parsed) || typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") return null;
    return { client_email: parsed.client_email, private_key: parsed.private_key };
  } catch {
    return null;
  }
}

function b64UrlEncode(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function makeServiceAccountJwt(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = b64UrlEncode(
    new TextEncoder().encode(JSON.stringify({ iss: account.client_email, scope: CHAT_SCOPE, aud: GOOGLE_TOKEN_URL, exp: now + ONE_HOUR_S, iat: now })),
  );
  const pemContents = account.private_key.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  const keyBuffer = Uint8Array.from(atob(pemContents), (chr) => chr.charCodeAt(0));
  const privateKey = await crypto.subtle.importKey("pkcs8", keyBuffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = b64UrlEncode(new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(`${header}.${claims}`))));
  return `${header}.${claims}.${sig}`;
}

async function getGoogleAccessToken(account: ServiceAccount): Promise<string> {
  const jwt = await makeServiceAccountJwt(account);
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    signal: AbortSignal.timeout(TEN_SECONDS_MS),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

// ── Plugin ──────────────────────────────────────────────────────

const googleChatPlugin: PlatformPlugin = {
  name: PLATFORMS.googleChat,
  mode: CONNECTION_MODES.webhook,
  webhookPath: "/webhook/google-chat",

  isConfigured(env: Env): boolean {
    return !!env.GOOGLE_CHAT_PROJECT_NUMBER;
  },

  async handleWebhook(request: Request, body: string, env: Env): Promise<RelayMessage[]> {
    const authHeader = request.headers.get("authorization") ?? undefined;
    const valid = await verifyGoogleJwt(authHeader, String(env.GOOGLE_CHAT_PROJECT_NUMBER));
    if (!valid) throw new Error("Google Chat JWT verification failed");

    const parsed = parseMessage(JSON.parse(body));
    if (!parsed || !parsed.text) return [];

    return [
      {
        id: crypto.randomUUID(),
        platform: PLATFORMS.googleChat,
        senderId: parsed.spaceName,
        chatId: parsed.spaceName,
        text: parsed.text,
        receivedAt: new Date().toISOString(),
      },
    ];
  },

  async sendResponse(chatId: string, text: string, env: Env): Promise<void> {
    const saKeyRaw = typeof env.GOOGLE_CHAT_SERVICE_ACCOUNT_KEY === "string" ? env.GOOGLE_CHAT_SERVICE_ACCOUNT_KEY : "";
    if (!saKeyRaw) {
      console.warn(`[google-chat] reply not delivered (no service account): ${chatId}`);
      return;
    }
    const account = parseServiceAccount(saKeyRaw);
    if (!account) throw new Error("GOOGLE_CHAT_SERVICE_ACCOUNT_KEY is not valid JSON");

    const accessToken = await getGoogleAccessToken(account);
    // chunkText respects code-point boundaries (avoids splitting emoji
    // surrogate pairs) and keeps parity with WhatsApp / Messenger.
    const chunks = chunkText(text, MAX_CHAT_TEXT);
    for (const chunk of chunks) {
      let res: Response;
      try {
        res = await fetch(`${CHAT_API_BASE}/${chatId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ text: chunk }),
          signal: AbortSignal.timeout(FIFTEEN_SECONDS_MS),
        });
      } catch (err) {
        throw new Error(`Google Chat API network error: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (!res.ok) throw new Error(`Google Chat API failed: ${res.status}`);
    }
  },
};

registerPlatform(googleChatPlugin);
