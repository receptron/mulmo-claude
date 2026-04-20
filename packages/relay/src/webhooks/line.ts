// LINE webhook handler — verify signature + extract messages.

import { PLATFORMS, type RelayMessage } from "../types.js";

interface LineEvent {
  type: string;
  message?: { type: string; text?: string; id?: string };
  source?: { userId?: string; groupId?: string; roomId?: string };
  replyToken?: string;
}

interface LineWebhookBody {
  events: LineEvent[];
}

// LINE reply API: max 5 message objects per request
const MAX_LINE_MESSAGES_PER_REQUEST = 5;
const MAX_LINE_TEXT = 5000;

export async function handleLineWebhook(
  request: Request,
  channelSecret: string,
): Promise<RelayMessage[]> {
  const body = await request.text();
  const signature = request.headers.get("x-line-signature") ?? "";

  const isValid = await verifyLineSignature(channelSecret, body, signature);
  if (!isValid) {
    throw new Error("LINE signature verification failed");
  }

  const parsed: LineWebhookBody = JSON.parse(body);
  const messages: RelayMessage[] = [];

  for (const event of parsed.events) {
    if (event.type !== "message" || event.message?.type !== "text") continue;
    if (!event.message.text) continue;

    const chatId =
      event.source?.groupId ??
      event.source?.roomId ??
      event.source?.userId ??
      "unknown";

    messages.push({
      id: crypto.randomUUID(),
      platform: PLATFORMS.line,
      senderId: event.source?.userId ?? "unknown",
      chatId,
      text: event.message.text,
      receivedAt: new Date().toISOString(),
      replyToken: event.replyToken,
    });
  }

  return messages;
}

// Timing-safe LINE signature verification (base64 HMAC-SHA256)
async function verifyLineSignature(
  secret: string,
  body: string,
  signature: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));

  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  let result = 0;
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return result === 0;
}

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += MAX_LINE_TEXT) {
    chunks.push(text.slice(i, i + MAX_LINE_TEXT));
  }
  // LINE allows max 5 messages per request
  return chunks.slice(0, MAX_LINE_MESSAGES_PER_REQUEST);
}

export async function sendLineReply(
  replyToken: string,
  text: string,
  accessToken: string,
): Promise<void> {
  const response = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: chunkText(text).map((t) => ({ type: "text", text: t })),
    }),
  });
  if (!response.ok) {
    throw new Error(`LINE reply failed: ${response.status}`);
  }
}

export async function sendLinePush(
  chatId: string,
  text: string,
  accessToken: string,
): Promise<void> {
  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      to: chatId,
      messages: chunkText(text).map((t) => ({ type: "text", text: t })),
    }),
  });
  if (!response.ok) {
    throw new Error(`LINE push failed: ${response.status}`);
  }
}
