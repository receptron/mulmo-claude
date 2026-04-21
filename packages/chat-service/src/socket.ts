// @package-contract — see ./types.ts
//
// Socket.io transport for the bridge chat flow.
//
// Phase A (#268) — bridge → server req/res:
//   handshake.auth: { transportId: string; token?: string }
//   emit("message", { externalChatId, text }, ack)
//     ack receives { ok: true, reply }
//                 | { ok: false, error, status? }
//
// Phase B (#268) — server → bridge async push:
//   Each connected bridge joins room `bridge:${transportId}`.
//   Server emits `push` { chatId, message } to that room via the
//   `pushToBridge(transportId, chatId, message)` helper this module
//   returns. If no sockets are in the room at push time, the
//   message goes to an in-memory queue; the next socket that joins
//   the room drains its transport's queue on connect.
//
// Auth: when `tokenProvider` is supplied, the handshake is rejected
// unless `auth.token` equals `tokenProvider()`. When omitted (tests,
// unauth environments) only `transportId` is validated.
//
// Future phases:
//   C — streaming text chunks via `reply.chunk`
//   D — HTTP endpoint deprecation
//
// See plans/feat-chat-socketio.md and plans/feat-chat-socketio-phase-b.md.

import type http from "http";
import { Server as SocketServer } from "socket.io";
import type { Socket } from "socket.io";
import type { RelayFn } from "./relay.js";
import type { PushQueue } from "./push-queue.js";
import type { Attachment, Logger } from "./types.js";

export const CHAT_SOCKET_PATH = "/ws/chat";

/**
 * Custom socket.io events the chat transport defines. Keys mirror
 * values so grep-and-rename is safe; the union type is what every
 * on/emit site should reference instead of raw string literals.
 * Socket.io built-ins (`connect`, `disconnect`, `connect_error`) are
 * intentionally omitted — those are part of socket.io's own contract,
 * not ours to rename.
 */
export const CHAT_SOCKET_EVENTS = {
  /** bridge → server request (body: `{ externalChatId, text }`); ack
   *  carries `{ ok, reply, error?, status? }`. */
  message: "message",
  /** server → bridge async push (Phase B of #268); body:
   *  `{ chatId, message }`. */
  push: "push",
  /** server → bridge streaming text chunk (Phase C of #268). */
  textChunk: "textChunk",
} as const;
export type ChatSocketEvent = (typeof CHAT_SOCKET_EVENTS)[keyof typeof CHAT_SOCKET_EVENTS];

export type PushFn = (transportId: string, chatId: string, message: string) => void;

export interface ChatSocketDeps {
  relay: RelayFn;
  queue: PushQueue;
  logger: Logger;
  /** Current bearer token the handshake must carry. Null means
   *  bootstrap in progress — reject everything. Omit to disable. */
  tokenProvider?: () => string | null;
}

export interface ChatSocketHandle {
  io: SocketServer;
  /** Fire-and-forget push to every bridge in `bridge:${transportId}`.
   *  If none are connected, the message is queued for the next
   *  joiner. */
  pushToBridge: PushFn;
}

interface HandshakeAuth {
  transportId?: unknown;
  token?: unknown;
}

interface MessagePayload {
  externalChatId?: unknown;
  text?: unknown;
  /** Array of `{ mimeType, data, filename? }` attachments (#382). */
  attachments?: unknown;
}

type MessageAck = { ok: true; reply: string } | { ok: false; error: string; status?: number };

type ParsedMessage =
  | {
      ok: true;
      externalChatId: string;
      text: string;
      attachments?: Attachment[];
    }
  | { ok: false; error: string };

type HandshakeResult = { ok: true; transportId: string } | { ok: false; error: string };

export function bridgeRoom(transportId: string): string {
  return `bridge:${transportId}`;
}

export function attachChatSocket(server: http.Server, deps: ChatSocketDeps): ChatSocketHandle {
  const { relay, queue, logger, tokenProvider } = deps;

  const io = new SocketServer(server, {
    path: CHAT_SOCKET_PATH,
    // Loopback-only deployment; skip long-polling negotiation for
    // the same reason `/ws/pubsub` does (#311).
    transports: ["websocket"],
  });

  io.use((socket, next) => {
    const result = validateHandshake(socket.handshake.auth, tokenProvider);
    if (!result.ok) {
      next(new Error(result.error));
      return;
    }
    socket.data.transportId = result.transportId;
    next();
  });

  io.on("connection", (socket: Socket) => {
    const transportId: string = socket.data.transportId;
    const room = bridgeRoom(transportId);
    socket.join(room);

    // Flush any messages queued while this transport had no live
    // socket. Emit only to *this* socket, not the room, so a
    // second bridge joining seconds later doesn't re-receive the
    // already-drained messages.
    const queued = queue.drainFor(transportId);
    if (queued.length > 0) {
      logger.info("chat-service", "flushing push queue", {
        socketId: socket.id,
        transportId,
        count: queued.length,
      });
      for (const item of queued) {
        socket.emit(CHAT_SOCKET_EVENTS.push, {
          chatId: item.chatId,
          message: item.message,
        });
      }
    }

    logger.info("chat-service", "socket connected", {
      socketId: socket.id,
      transportId,
    });

    socket.on("disconnect", (reason: string) => {
      logger.info("chat-service", "socket disconnected", {
        socketId: socket.id,
        transportId,
        reason,
      });
    });

    socket.on(CHAT_SOCKET_EVENTS.message, async (payload: MessagePayload, ack?: (reply: MessageAck) => void) => {
      if (typeof ack !== "function") {
        logger.warn("chat-service", "socket message missing ack", {
          socketId: socket.id,
          transportId,
        });
        return;
      }

      const parsed = parseMessagePayload(payload);
      if (!parsed.ok) {
        ack({ ok: false, error: parsed.error, status: 400 });
        return;
      }

      const result = await relay({
        transportId,
        externalChatId: parsed.externalChatId,
        text: parsed.text,
        attachments: parsed.attachments,
        // Stream text chunks to this bridge socket in real time
        // (Phase C of #268). The ack still returns the full text
        // for backward compatibility.
        onChunk: (text) => {
          socket.emit(CHAT_SOCKET_EVENTS.textChunk, { text });
        },
      });

      if (result.kind === "ok") {
        ack({ ok: true, reply: result.reply });
      } else {
        ack({ ok: false, error: result.message, status: result.status });
      }
    });
  });

  const pushToBridge: PushFn = (transportId, chatId, message) => {
    const room = bridgeRoom(transportId);
    // `io.sockets.adapter.rooms` is the authoritative view of which
    // rooms have members right now. Using it here (vs. a separate
    // membership counter we'd have to maintain) keeps us honest
    // about what socket.io actually knows.
    const hasLive = (io.sockets.adapter.rooms.get(room)?.size ?? 0) > 0;
    if (hasLive) {
      io.to(room).emit(CHAT_SOCKET_EVENTS.push, { chatId, message });
      return;
    }
    queue.enqueue(transportId, { chatId, message, enqueuedAt: Date.now() });
    logger.info("chat-service", "push queued (no live bridge)", {
      transportId,
      chatId,
      queueSize: queue.sizeFor(transportId),
    });
  };

  return { io, pushToBridge };
}

function validateHandshake(auth: unknown, tokenProvider: (() => string | null) | undefined): HandshakeResult {
  if (!auth || typeof auth !== "object") {
    return { ok: false, error: "handshake auth is required" };
  }
  const transportIdRaw = (auth as HandshakeAuth).transportId;
  if (typeof transportIdRaw !== "string" || transportIdRaw.trim().length === 0) {
    return { ok: false, error: "transportId is required" };
  }
  const transportId = transportIdRaw.trim();

  if (!tokenProvider) {
    return { ok: true, transportId };
  }

  const expected = tokenProvider();
  if (expected === null || expected.length === 0) {
    // Server auth not bootstrapped yet, or token absent. Reject so
    // the bridge falls back to its connect-error path instead of
    // silently succeeding.
    return { ok: false, error: "server auth not ready" };
  }
  const provided = (auth as HandshakeAuth).token;
  if (typeof provided !== "string" || provided.length === 0) {
    return { ok: false, error: "token is required" };
  }
  if (provided !== expected) {
    return { ok: false, error: "invalid token" };
  }
  return { ok: true, transportId };
}

function parseMessagePayload(payload: MessagePayload): ParsedMessage {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "payload must be an object" };
  }
  const externalChatId = typeof payload.externalChatId === "string" ? payload.externalChatId.trim() : "";
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!externalChatId) {
    return { ok: false, error: "externalChatId is required" };
  }
  if (!text) {
    return { ok: false, error: "text is required" };
  }
  const attachments = parseAttachments(payload.attachments);
  return { ok: true, externalChatId, text, attachments };
}

function parseAttachments(raw: unknown): Attachment[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const valid: Attachment[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as Record<string, unknown>).mimeType === "string" &&
      typeof (item as Record<string, unknown>).data === "string"
    ) {
      const entry: Attachment = {
        mimeType: (item as Record<string, unknown>).mimeType as string,
        data: (item as Record<string, unknown>).data as string,
      };
      const fn = (item as Record<string, unknown>).filename;
      if (typeof fn === "string" && fn.length > 0) entry.filename = fn;
      valid.push(entry);
    }
  }
  return valid.length > 0 ? valid : undefined;
}
