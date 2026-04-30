// LINE platform plugin.

import { chunkText } from "@mulmobridge/client/text";
import { PLATFORMS, type RelayMessage, type Env } from "../types.js";
import { registerPlatform, CONNECTION_MODES, type PlatformPlugin } from "../platform.js";
import { makeUuid } from "../utils/id.js";

export interface LineEvent {
  type: string;
  message?: { type: string; text?: string; id?: string };
  source?: { userId?: string; groupId?: string; roomId?: string };
  replyToken?: string;
}

interface LineWebhookBody {
  events: LineEvent[];
}

const MAX_LINE_MESSAGES_PER_REQUEST = 5;
const MAX_LINE_TEXT = 5000;

export interface ParsedLineEvent {
  chatId: string;
  senderId: string;
  text: string;
  replyToken?: string;
}

/**
 * Pure: reduce a LINE webhook event to the actionable
 * chatId / senderId / text triple, or null when the event isn't a
 * deliverable text message. Group / room source IDs win over the
 * sender's userId so a single LINE chat session maps to one
 * MulmoClaude chatId.
 */
export function parseLineMessageEvent(event: LineEvent): ParsedLineEvent | null {
  if (event.type !== "message" || event.message?.type !== "text") return null;
  if (!event.message.text) return null;
  const chatId = event.source?.groupId ?? event.source?.roomId ?? event.source?.userId ?? "unknown";
  const senderId = event.source?.userId ?? "unknown";
  return { chatId, senderId, text: event.message.text, replyToken: event.replyToken };
}

// ── Signature verification ──────────────────────────────────────

async function verifyLineSignature(secret: string, body: string, signature: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));

  if (expected.length !== signature.length) return false;
  let result = 0;
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return result === 0;
}

// ── Plugin implementation ───────────────────────────────────────

const linePlugin: PlatformPlugin = {
  name: PLATFORMS.line,
  mode: CONNECTION_MODES.webhook,
  webhookPath: "/webhook/line",

  isConfigured(env: Env): boolean {
    return Boolean(env.LINE_CHANNEL_SECRET);
  },

  async handleWebhook(request: Request, body: string, env: Env): Promise<RelayMessage[]> {
    const signature = request.headers.get("x-line-signature") ?? "";
    const isValid = await verifyLineSignature(String(env.LINE_CHANNEL_SECRET), body, signature);
    if (!isValid) {
      throw new Error("LINE signature verification failed");
    }

    const parsed: LineWebhookBody = JSON.parse(body);
    const messages: RelayMessage[] = [];

    for (const event of parsed.events) {
      const parsedEvent = parseLineMessageEvent(event);
      if (!parsedEvent) continue;
      messages.push({
        id: makeUuid(),
        platform: PLATFORMS.line,
        senderId: parsedEvent.senderId,
        chatId: parsedEvent.chatId,
        text: parsedEvent.text,
        receivedAt: new Date().toISOString(),
        replyToken: parsedEvent.replyToken,
      });
    }

    return messages;
  },

  async sendResponse(chatId: string, text: string, env: Env, replyToken?: string): Promise<void> {
    const accessToken = env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error("LINE_CHANNEL_ACCESS_TOKEN not configured");
    }

    const messages = chunkText(text, MAX_LINE_TEXT)
      .slice(0, MAX_LINE_MESSAGES_PER_REQUEST)
      .map((messageText) => ({ type: "text", text: messageText }));
    const url = replyToken ? "https://api.line.me/v2/bot/message/reply" : "https://api.line.me/v2/bot/message/push";
    const body = replyToken ? { replyToken, messages } : { to: chatId, messages };

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${String(accessToken)}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(`LINE API network error: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!response.ok) {
      throw new Error(`LINE API failed: ${response.status}`);
    }
  },
};

registerPlatform(linePlugin);
