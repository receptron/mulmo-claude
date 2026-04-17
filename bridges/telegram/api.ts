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

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  /** Array of photo sizes, largest last. Present when user sends a photo. */
  photo?: TelegramPhotoSize[];
  caption?: string;
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
  /** Download a photo by file_id, return as base64 data URL. */
  downloadPhoto(fileId: string): Promise<string>;
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

    async downloadPhoto(fileId) {
      // Step 1: getFile to get the file_path
      const getFileRes = await fetchImpl(
        `${base}/getFile?file_id=${encodeURIComponent(fileId)}`,
      );
      if (!getFileRes.ok) {
        throw new Error(
          `getFile failed: ${getFileRes.status} ${await safeText(getFileRes)}`,
        );
      }
      const getFileBody = (await getFileRes.json()) as {
        ok: boolean;
        description?: string;
        result?: { file_path?: string };
      };
      if (!getFileBody.ok || !getFileBody.result?.file_path) {
        throw new Error(
          `getFile API error: ${getFileBody.description ?? "no file_path"}`,
        );
      }

      // Step 2: download the file bytes
      const fileUrl = `${baseUrl}/file/bot${opts.botToken}/${getFileBody.result.file_path}`;
      const fileRes = await fetchImpl(fileUrl);
      if (!fileRes.ok) {
        throw new Error(`file download failed: ${fileRes.status}`);
      }
      const buffer = await fileRes.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");

      // Infer media type from file path extension
      const ext = getFileBody.result.file_path.split(".").pop()?.toLowerCase();
      const mediaType =
        ext === "jpg" || ext === "jpeg"
          ? "image/jpeg"
          : ext === "png"
            ? "image/png"
            : ext === "webp"
              ? "image/webp"
              : "image/jpeg"; // Telegram defaults to JPEG for photos
      return `data:${mediaType};base64,${base64}`;
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
