// Raw `fetch` wrapper for the Telegram Bot API. Only the two methods
// the bridge actually uses (`getUpdates`, `sendMessage`) are exposed.
//
// Why raw fetch + no dep: the Telegram client-lib ecosystem is heavy
// (event buses, middleware pipelines, type trees). We're driving two
// endpoints; ~60 lines of fetch is cheaper than a dep's security-
// review / lockfile footprint, and it leaves no doubt about which
// methods touch the network.
//
// Message-length handling (4096 char cap, markdown mode, media
// uploads) is deliberately out of scope for this file — the caller
// in `bridges/telegram/index.ts` decides how to chunk long replies.

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  date: number;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  username?: string;
  title?: string;
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  username?: string;
  first_name: string;
}

export interface TelegramApiOptions {
  botToken: string;
  /** Base URL override for tests / self-hosted Telegram Bot API. */
  baseUrl?: string;
  /** Injectable fetch for tests — defaults to global. */
  fetchImpl?: typeof fetch;
}

export interface GetUpdatesOptions {
  offset?: number;
  timeoutSec?: number;
  signal?: AbortSignal;
}

export interface TelegramApi {
  getUpdates(opts?: GetUpdatesOptions): Promise<TelegramUpdate[]>;
  sendMessage(chatId: number, text: string): Promise<void>;
}

const DEFAULT_BASE = "https://api.telegram.org";

export function createTelegramApi(opts: TelegramApiOptions): TelegramApi {
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = `${baseUrl}/bot${opts.botToken}`;

  return {
    async getUpdates(gu: GetUpdatesOptions = {}) {
      const params = new URLSearchParams();
      if (gu.offset !== undefined) params.set("offset", String(gu.offset));
      if (gu.timeoutSec !== undefined) {
        params.set("timeout", String(gu.timeoutSec));
      }
      const url = `${base}/getUpdates?${params.toString()}`;

      const res = await fetchImpl(url, { signal: gu.signal });
      if (!res.ok) {
        throw new Error(
          `getUpdates failed: ${res.status} ${await safeText(res)}`,
        );
      }
      const body = (await res.json()) as {
        ok: boolean;
        description?: string;
        result?: TelegramUpdate[];
      };
      if (!body.ok || !Array.isArray(body.result)) {
        throw new Error(
          `getUpdates API error: ${body.description ?? "unknown"}`,
        );
      }
      return body.result;
    },

    async sendMessage(chatId, text) {
      const res = await fetchImpl(`${base}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      if (!res.ok) {
        throw new Error(
          `sendMessage failed: ${res.status} ${await safeText(res)}`,
        );
      }
      const body = (await res.json()) as {
        ok: boolean;
        description?: string;
      };
      if (!body.ok) {
        throw new Error(
          `sendMessage API error: ${body.description ?? "unknown"}`,
        );
      }
    },
  };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<unreadable body>";
  }
}
