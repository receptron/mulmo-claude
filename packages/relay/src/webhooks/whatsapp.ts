// WhatsApp Cloud API platform plugin.
//
// Required secrets (wrangler secret put):
//   WHATSAPP_APP_SECRET        — App secret for x-hub-signature-256 HMAC
//   WHATSAPP_ACCESS_TOKEN      — Permanent access token
//   WHATSAPP_PHONE_NUMBER_ID   — Phone number ID from Meta dashboard
//   WHATSAPP_VERIFY_TOKEN      — Arbitrary string for webhook verification

import { chunkText } from "@mulmobridge/client/text";
import { PLATFORMS, type RelayMessage, type Env } from "../types.js";
import { registerPlatform, CONNECTION_MODES, type PlatformPlugin } from "../platform.js";
import { verifyMetaSignature, handleMetaVerification } from "./meta.js";
import { FIFTEEN_SECONDS_MS } from "../time.js";
import { makeUuid } from "../utils/id.js";

const WHATSAPP_API_VERSION = "v21.0";
const MAX_WA_TEXT = 4096;

interface WaTextMessage {
  from: string;
  text: { body: string };
}

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseOneWaMessage(msg: unknown): WaTextMessage | null {
  if (!isObj(msg) || msg.type !== "text" || typeof msg.from !== "string") return null;
  if (!isObj(msg.text) || typeof msg.text.body !== "string" || !msg.text.body.trim()) return null;
  return { from: msg.from, text: { body: msg.text.body } };
}

function extractWaMessages(body: unknown): WaTextMessage[] {
  if (!isObj(body) || !Array.isArray(body.entry)) return [];
  const raw: unknown[] = [];
  for (const entry of body.entry) {
    if (!isObj(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!isObj(change) || !isObj(change.value) || !Array.isArray(change.value.messages)) continue;
      raw.push(...change.value.messages);
    }
  }
  return raw.map(parseOneWaMessage).filter((msg): msg is WaTextMessage => msg !== null);
}

const whatsappPlugin: PlatformPlugin = {
  name: PLATFORMS.whatsapp,
  mode: CONNECTION_MODES.webhook,
  webhookPath: "/webhook/whatsapp",

  isConfigured(env: Env): boolean {
    return Boolean(env.WHATSAPP_APP_SECRET) && Boolean(env.WHATSAPP_ACCESS_TOKEN);
  },

  handleVerification(request: Request, env: Env): Response {
    return handleMetaVerification(request, String(env.WHATSAPP_VERIFY_TOKEN ?? ""));
  },

  async handleWebhook(request: Request, body: string, env: Env): Promise<RelayMessage[]> {
    const signature = request.headers.get("x-hub-signature-256") ?? "";
    const valid = await verifyMetaSignature(String(env.WHATSAPP_APP_SECRET), body, signature);
    if (!valid) throw new Error("WhatsApp signature verification failed");

    return extractWaMessages(JSON.parse(body)).map((msg) => ({
      id: makeUuid(),
      platform: PLATFORMS.whatsapp,
      senderId: msg.from,
      chatId: msg.from,
      text: msg.text.body,
      receivedAt: new Date().toISOString(),
    }));
  },

  async sendResponse(chatId: string, text: string, env: Env): Promise<void> {
    const accessToken = String(env.WHATSAPP_ACCESS_TOKEN ?? "");
    const phoneNumberId = String(env.WHATSAPP_PHONE_NUMBER_ID ?? "");
    if (!accessToken || !phoneNumberId) throw new Error("WhatsApp access token / phone number ID not configured");

    const chunks = chunkText(text, MAX_WA_TEXT);
    for (const chunk of chunks) {
      let res: Response;
      try {
        res = await fetch(`https://graph.facebook.com/${WHATSAPP_API_VERSION}/${phoneNumberId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ messaging_product: "whatsapp", to: chatId, type: "text", text: { body: chunk } }),
          signal: AbortSignal.timeout(FIFTEEN_SECONDS_MS),
        });
      } catch (err) {
        throw new Error(`WhatsApp API network error: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`WhatsApp API failed: ${res.status} ${detail.slice(0, 200)}`);
      }
    }
  },
};

registerPlatform(whatsappPlugin);
