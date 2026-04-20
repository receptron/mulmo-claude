// Telegram webhook handler — verify secret + extract messages.

import { PLATFORMS, type RelayMessage } from "../types.js";

interface TelegramUpdate {
  message?: {
    message_id: number;
    from?: { id: number; first_name?: string };
    chat: { id: number; type: string };
    text?: string;
  };
}

const MAX_TG_TEXT = 4096;

export function handleTelegramWebhook(
  body: string,
  secretToken: string | undefined,
  headerSecret: string | null,
): RelayMessage[] {
  // Fail closed: if secret is configured, header must match.
  // If secret is NOT configured, reject all requests (require explicit setup).
  if (!secretToken) {
    throw new Error("Telegram webhook secret not configured");
  }
  if (headerSecret !== secretToken) {
    throw new Error("Telegram secret token verification failed");
  }

  const update: TelegramUpdate = JSON.parse(body);
  const msg = update.message;
  const text = msg?.text;
  if (!msg || !text) return [];

  return [
    {
      id: crypto.randomUUID(),
      platform: PLATFORMS.telegram,
      senderId: String(msg.from?.id ?? "unknown"),
      chatId: String(msg.chat.id),
      text,
      receivedAt: new Date().toISOString(),
    },
  ];
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  botToken: string,
): Promise<void> {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += MAX_TG_TEXT) {
    chunks.push(text.slice(i, i + MAX_TG_TEXT));
  }

  for (const chunk of chunks) {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: chunk,
        }),
      },
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Telegram sendMessage failed: ${response.status} ${detail}`,
      );
    }
  }
}
