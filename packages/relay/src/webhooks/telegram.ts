// Telegram platform plugin.

import { PLATFORMS, type RelayMessage, type Env } from "../types.js";
import { registerPlatform, CONNECTION_MODES, type PlatformPlugin } from "../platform.js";
import { makeUuid } from "../utils/id.js";

interface TelegramUpdate {
  message?: {
    message_id: number;
    from?: { id: number; first_name?: string };
    chat: { id: number; type: string };
    text?: string;
  };
}

const MAX_TG_TEXT = 4096;

const telegramPlugin: PlatformPlugin = {
  name: PLATFORMS.telegram,
  mode: CONNECTION_MODES.webhook,
  webhookPath: "/webhook/telegram",

  isConfigured(env: Env): boolean {
    return Boolean(env.TELEGRAM_BOT_TOKEN) && Boolean(env.TELEGRAM_WEBHOOK_SECRET);
  },

  async handleWebhook(request: Request, body: string, env: Env): Promise<RelayMessage[]> {
    // Fail closed: secret must be configured
    if (!env.TELEGRAM_WEBHOOK_SECRET) {
      throw new Error("Telegram webhook secret not configured");
    }
    const headerSecret = request.headers.get("x-telegram-bot-api-secret-token");
    if (headerSecret !== env.TELEGRAM_WEBHOOK_SECRET) {
      throw new Error("Telegram secret token verification failed");
    }

    const update: TelegramUpdate = JSON.parse(body);
    const msg = update.message;
    const text = msg?.text;
    if (!msg || !text) return [];

    return [
      {
        id: makeUuid(),
        platform: PLATFORMS.telegram,
        senderId: String(msg.from?.id ?? "unknown"),
        chatId: String(msg.chat.id),
        text,
        receivedAt: new Date().toISOString(),
      },
    ];
  },

  async sendResponse(chatId: string, text: string, env: Env): Promise<void> {
    const botToken = env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      throw new Error("TELEGRAM_BOT_TOKEN not configured");
    }

    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += MAX_TG_TEXT) {
      chunks.push(text.slice(i, i + MAX_TG_TEXT));
    }

    for (const chunk of chunks) {
      let response: Response;
      try {
        response = await fetch(`https://api.telegram.org/bot${String(botToken)}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: chunk }),
        });
      } catch (err) {
        throw new Error(`Telegram API network error: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`Telegram sendMessage failed: ${response.status} ${detail}`);
      }
    }
  },
};

registerPlatform(telegramPlugin);
