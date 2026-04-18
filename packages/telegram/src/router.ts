// Message-routing logic for the Telegram bridge. Kept separate from
// `index.ts` so it can be exercised with stubbed deps (no real
// Telegram API, no real MulmoClaude socket, no env reads). The
// entrypoint in index.ts is then just: read env → wire real deps →
// drive the polling loop.

import type { TelegramApi, TelegramMessage } from "./api.js";
import type { Allowlist } from "./allowlist.js";
import type { Attachment } from "@mulmobridge/protocol";
import {
  parseDataUrl,
  type MessageAck,
  type PushEvent,
} from "@mulmobridge/client";

// Telegram caps a single message at 4096 chars. We split long
// replies naively; pretty formatting (preserve markdown, break on
// sentence boundaries) is a follow-up.
const TELEGRAM_MAX_MESSAGE_CHARS = 4096;

export type SendToMulmoFn = (
  externalChatId: string,
  text: string,
  attachments?: Attachment[],
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

interface PhotoResult {
  attachments: Attachment[];
  failed: boolean;
}

export function createMessageRouter(deps: RouterDeps): MessageRouter {
  const { api, allowlist, sendToMulmo } = deps;
  const log = deps.log ?? defaultLog;

  // One denial reply per chat per bridge lifetime — restart clears.
  const deniedAlreadyNotified = new Set<number>();

  async function tryDownloadPhoto(msg: TelegramMessage): Promise<PhotoResult> {
    const hasPhoto = Array.isArray(msg.photo) && msg.photo.length > 0;
    if (!hasPhoto) return { attachments: [], failed: false };
    const largest = msg.photo![msg.photo!.length - 1];
    try {
      const dataUrl = await api.downloadPhoto(largest.file_id);
      const parsed = parseDataUrl(dataUrl);
      if (parsed) {
        return {
          attachments: [{ mimeType: parsed.mimeType, data: parsed.data }],
          failed: false,
        };
      }
    } catch (err) {
      log.error(`[telegram] photo download failed: ${String(err)}`);
    }
    return { attachments: [], failed: true };
  }

  async function sendReply(chatId: number, ack: MessageAck): Promise<void> {
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

  async function handleAllowed(msg: TelegramMessage): Promise<void> {
    const chatId = msg.chat.id;
    const text = msg.text ?? msg.caption ?? "";
    const hasPhoto = Array.isArray(msg.photo) && msg.photo.length > 0;
    if (text.trim().length === 0 && !hasPhoto) return;

    log.info(
      `[telegram] accepted chat=${chatId} user=@${userLabel(msg)} len=${text.length}${hasPhoto ? " +photo" : ""}`,
    );

    const { attachments, failed } = await tryDownloadPhoto(msg);

    // Photo-only message where download failed: bail out instead
    // of sending "What is this image?" without the actual image.
    if (failed && text.trim().length === 0) {
      await api
        .sendMessage(
          chatId,
          "Sorry, I could not download the photo. Please try again.",
        )
        .catch(() => {});
      return;
    }

    // Surface the photo-drop so the user knows the image was lost.
    const messageText = resolveMessageText(text, failed);
    const ack = await sendToMulmo(
      String(chatId),
      messageText,
      attachments.length > 0 ? attachments : undefined,
    );
    await sendReply(chatId, ack);
  }

  async function handleDenied(msg: TelegramMessage): Promise<void> {
    const chatId = msg.chat.id;
    log.warn(
      `[telegram] denied chat=${chatId} user=@${userLabel(msg)} — not on allowlist`,
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

function resolveMessageText(text: string, photoFailed: boolean): string {
  const hasText = text.trim().length > 0;
  if (photoFailed && hasText) {
    return `${text}\n\n(note: attached photo could not be downloaded)`;
  }
  if (hasText) return text;
  return "What is this image?";
}

function userLabel(msg: TelegramMessage): string {
  return msg.from?.username ?? msg.from?.first_name ?? "unknown";
}
