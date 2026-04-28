// Facebook Messenger platform plugin.
//
// Required secrets (wrangler secret put):
//   MESSENGER_APP_SECRET        — App secret for x-hub-signature-256 HMAC
//   MESSENGER_PAGE_ACCESS_TOKEN — Page access token
//   MESSENGER_VERIFY_TOKEN      — Arbitrary string for webhook verification

import { chunkText } from "@mulmobridge/client/text";
import { PLATFORMS, type RelayMessage, type Env } from "../types.js";
import { registerPlatform, CONNECTION_MODES, type PlatformPlugin } from "../platform.js";
import { verifyMetaSignature, handleMetaVerification } from "./meta.js";
import { FIFTEEN_SECONDS_MS } from "../time.js";
import { makeUuid } from "../utils/id.js";

const MAX_MESSENGER_TEXT = 2000;

interface ExtractedMessage {
  senderId: string;
  text: string;
}

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseOneEvent(event: unknown): ExtractedMessage | null {
  if (!isObj(event) || !isObj(event.sender) || typeof event.sender.id !== "string") return null;
  if (!isObj(event.message) || typeof event.message.text !== "string") return null;
  const text = event.message.text.trim();
  if (!text) return null;
  return { senderId: event.sender.id, text };
}

function extractMessages(body: unknown): ExtractedMessage[] {
  if (!isObj(body) || !Array.isArray(body.entry)) return [];
  const out: ExtractedMessage[] = [];
  for (const entry of body.entry) {
    if (!isObj(entry) || !Array.isArray(entry.messaging)) continue;
    for (const event of entry.messaging) {
      const msg = parseOneEvent(event);
      if (msg) out.push(msg);
    }
  }
  return out;
}

const messengerPlugin: PlatformPlugin = {
  name: PLATFORMS.messenger,
  mode: CONNECTION_MODES.webhook,
  webhookPath: "/webhook/messenger",

  isConfigured(env: Env): boolean {
    return Boolean(env.MESSENGER_APP_SECRET) && Boolean(env.MESSENGER_PAGE_ACCESS_TOKEN);
  },

  handleVerification(request: Request, env: Env): Response {
    return handleMetaVerification(request, String(env.MESSENGER_VERIFY_TOKEN ?? ""));
  },

  async handleWebhook(request: Request, body: string, env: Env): Promise<RelayMessage[]> {
    const signature = request.headers.get("x-hub-signature-256") ?? "";
    const valid = await verifyMetaSignature(String(env.MESSENGER_APP_SECRET), body, signature);
    if (!valid) throw new Error("Messenger signature verification failed");

    return extractMessages(JSON.parse(body)).map((msg) => ({
      id: makeUuid(),
      platform: PLATFORMS.messenger,
      senderId: msg.senderId,
      chatId: msg.senderId,
      text: msg.text,
      receivedAt: new Date().toISOString(),
    }));
  },

  async sendResponse(chatId: string, text: string, env: Env): Promise<void> {
    const accessToken = String(env.MESSENGER_PAGE_ACCESS_TOKEN ?? "");
    if (!accessToken) throw new Error("MESSENGER_PAGE_ACCESS_TOKEN not configured");

    // Authorization header (not query string) — Graph API supports it, and
    // avoids leaking the token into CDN / proxy access logs and error reports.
    const chunks = chunkText(text, MAX_MESSENGER_TEXT);
    for (const chunk of chunks) {
      let res: Response;
      try {
        res = await fetch("https://graph.facebook.com/v21.0/me/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ recipient: { id: chatId }, message: { text: chunk } }),
          signal: AbortSignal.timeout(FIFTEEN_SECONDS_MS),
        });
      } catch (err) {
        throw new Error(`Messenger API network error: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`Messenger API failed: ${res.status} ${detail.slice(0, 200)}`);
      }
    }
  },
};

registerPlatform(messengerPlugin);
