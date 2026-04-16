// Message-routing logic for the Telegram bridge. Kept separate from
// `index.ts` so it can be exercised with stubbed deps (no real
// Telegram API, no real MulmoClaude socket, no env reads). The
// entrypoint in index.ts is then just: read env → wire real deps →
// drive the polling loop.

import type { TelegramApi, TelegramMessage } from "./api.js";
import type { Allowlist } from "./allowlist.js";
import type { MessageAck, PushEvent } from "../_lib/client.js";

// Telegram caps a single message at 4096 chars. We split long
// replies naively; pretty formatting (preserve markdown, break on
// sentence boundaries) is a follow-up.
const TELEGRAM_MAX_MESSAGE_CHARS = 4096;

export type SendToMulmoFn = (
  externalChatId: string,
  text: string,
) => Promise<MessageAck>;

export interface RouterDeps {
  api: TelegramApi;
  allowlist: Allowlist;
  sendToMulmo: SendToMulmoFn;
  /** Structured logger. Console-compatible shape — `[telegram]`
   *  prefix is the router's responsibility. */
  log?: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}

export interface MessageRouter {
  handleMessage(msg: TelegramMessage): Promise<void>;
  handlePush(ev: PushEvent): Promise<void>;
  /** For tests / debugging: chat IDs we've already sent the
   *  access-denied notice to. */
  deniedAlreadyNotified(): ReadonlySet<number>;
}

const defaultLog = {
  info: (m: string) => console.log(m),
  warn: (m: string) => console.warn(m),
  error: (m: string) => console.error(m),
};

export function createMessageRouter(deps: RouterDeps): MessageRouter {
  const { api, allowlist, sendToMulmo } = deps;
  const log = deps.log ?? defaultLog;

  // One denial reply per chat per bridge lifetime — restart clears.
  // Prevents a sender from spamming the operator (and Telegram's
  // rate limits) by repeatedly messaging a denied bot.
  const deniedAlreadyNotified = new Set<number>();

  async function handleAllowed(msg: TelegramMessage): Promise<void> {
    const chatId = msg.chat.id;
    const text = msg.text ?? "";
    if (text.trim().length === 0) return;
    const user = userLabel(msg);
    log.info(
      `[telegram] accepted chat=${chatId} user=@${user} len=${text.length}`,
    );

    const ack = await sendToMulmo(String(chatId), text);
    if (ack.ok) {
      await sendChunked(api, chatId, ack.reply ?? "");
    } else {
      const status = ack.status ? ` (${ack.status})` : "";
      await sendChunked(
        api,
        chatId,
        `Error${status}: ${ack.error ?? "unknown"}`,
      );
    }
  }

  async function handleDenied(msg: TelegramMessage): Promise<void> {
    const chatId = msg.chat.id;
    const user = userLabel(msg);
    log.warn(
      `[telegram] denied chat=${chatId} user=@${user} — not on allowlist`,
    );
    if (deniedAlreadyNotified.has(chatId)) return;
    deniedAlreadyNotified.add(chatId);
    try {
      await api.sendMessage(
        chatId,
        "Access denied. Contact the operator to be added to the allowlist.",
      );
    } catch (err) {
      log.error(`[telegram] access-denied reply failed: ${String(err)}`);
    }
  }

  return {
    async handleMessage(msg) {
      if (allowlist.allows(msg.chat.id)) {
        await handleAllowed(msg);
      } else {
        await handleDenied(msg);
      }
    },

    async handlePush(ev) {
      const chatId = Number(ev.chatId);
      if (!Number.isInteger(chatId)) {
        log.warn(`[telegram] push chatId is not integer: ${ev.chatId}`);
        return;
      }
      // Defense in depth: never sendMessage to a non-allowlisted
      // chat, even when the push comes from our own server. A
      // buggy task-manager or a compromised server shouldn't be
      // able to reach arbitrary Telegram users.
      if (!allowlist.allows(chatId)) {
        log.warn(`[telegram] push denied: chat ${chatId} not on allowlist`);
        return;
      }
      try {
        await sendChunked(api, chatId, ev.message);
      } catch (err) {
        log.error(`[telegram] push sendMessage failed: ${String(err)}`);
      }
    },

    deniedAlreadyNotified() {
      return deniedAlreadyNotified;
    },
  };
}

async function sendChunked(
  api: TelegramApi,
  chatId: number,
  text: string,
): Promise<void> {
  if (text.length === 0) {
    await api.sendMessage(chatId, "(empty reply)");
    return;
  }
  for (let i = 0; i < text.length; i += TELEGRAM_MAX_MESSAGE_CHARS) {
    await api.sendMessage(
      chatId,
      text.slice(i, i + TELEGRAM_MAX_MESSAGE_CHARS),
    );
  }
}

function userLabel(msg: TelegramMessage): string {
  return msg.from?.username ?? msg.from?.first_name ?? "unknown";
}
