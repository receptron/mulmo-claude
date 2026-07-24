// @mulmobridge/web-push — send a Web Push via the mulmoserver `sendPush`
// Cloud Function (see mulmoserver docs/web-push-sending.md).
//
// Auth-agnostic: the caller injects an ID-token provider, so this has no
// firebase / app dependency and both mulmoclaude and mulmoterminal share it.
// We only POST { title, body }; the target devices resolve server-side from the
// signed-in user's uid, and registration / delivery / dead-token pruning are
// the server's job.

// asia-northeast1 onCall endpoint for the `mulmoserver` project.
export const DEFAULT_SEND_PUSH_URL = "https://asia-northeast1-mulmoserver.cloudfunctions.net/sendPush";

const DEFAULT_TIMEOUT_MS = 8000;

export interface SendPushResult {
  sent: number;
  failed: number;
  targets: number;
}

export interface SendWebPushOptions {
  // Resolve the caller's Firebase Auth ID token, or null when not signed in
  // (→ the push is skipped without a network call). May reject; a rejection is
  // treated as "not signed in".
  getIdToken: () => Promise<string | null>;
  // sendPush endpoint. Defaults to the mulmoserver production URL.
  url?: string;
  // Abort the request after this many ms. Defaults to 8000.
  timeoutMs?: number;
  // fetch implementation (test seam). Defaults to globalThis.fetch.
  fetchImpl?: typeof fetch;
  // Arbitrary key/value pairs forwarded to the FCM `data` block, so a receiver
  // can route the tap (e.g. `{ sessionId }` to open that session instead of the
  // home screen). FCM requires string values. Deliberately untyped beyond that:
  // each host decides its own routing keys.
  //
  // This is ADDED alongside `notification`, never instead of it — both
  // mulmoserver receivers bail out when `payload.notification` is missing, so a
  // data-only message is silently dropped.
  data?: Record<string, string>;
}

// The onCall wire shape wraps the call's arguments in `data` — that outer key
// is the Cloud Functions envelope, NOT the FCM data block. The caller's routing
// payload rides inside it as `data.data`, which the server forwards to FCM.
//
// Omitted entirely when empty, so the envelope of an ordinary push is byte-for-
// byte what it was before this option existed.
export function buildSendPushBody(title: string, body: string, data?: Record<string, string>): string {
  const routing = data && Object.keys(data).length > 0 ? { data } : {};
  return JSON.stringify({ data: { title, body, ...routing } });
}

// The onCall response wraps the payload in `result`. Missing / non-number counts read as 0.
export function parseSendPushResult(json: unknown): SendPushResult | null {
  if (typeof json !== "object" || json === null) return null;
  const result = (json as { result?: unknown }).result;
  if (typeof result !== "object" || result === null) return null;
  const record = result as Record<string, unknown>;
  const num = (value: unknown): number => (typeof value === "number" ? value : 0);
  return { sent: num(record.sent), failed: num(record.failed), targets: num(record.targets) };
}

// getIdToken can itself throw (auth SDK). Treat any failure as "not signed in".
async function resolveIdToken(getIdToken: () => Promise<string | null>): Promise<string | null> {
  try {
    return await getIdToken();
  } catch {
    return null;
  }
}

// POST { title, body, data? } to sendPush as the signed-in user. Returns the
// delivery result, or null when nothing was sent (not signed in / network /
// timeout / non-2xx / bad JSON). Never throws — a failed push must not disturb
// its trigger.
export async function sendWebPush(title: string, body: string, options: SendWebPushOptions): Promise<SendPushResult | null> {
  const idToken = await resolveIdToken(options.getIdToken);
  if (!idToken) return null; // not signed in → nothing to send with
  const url = options.url ?? DEFAULT_SEND_PUSH_URL;
  const timeout_ms = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout_ms);
  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${idToken}` },
      body: buildSendPushBody(title, body, options.data),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return parseSendPushResult(await res.json());
  } catch {
    return null; // offline / aborted / bad JSON — silently skip
  } finally {
    clearTimeout(timer);
  }
}
