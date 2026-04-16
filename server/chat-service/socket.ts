import type http from "http";
import { Server as SocketServer } from "socket.io";
import type { Socket } from "socket.io";
import { log } from "../logger/index.js";
import { relayMessage as defaultRelayMessage } from "./relay.js";
import type { RelayParams, RelayResult } from "./relay.js";

export type RelayFn = (params: RelayParams) => Promise<RelayResult>;

export interface AttachChatSocketOptions {
  /** Injectable relay — tests stub this to avoid spinning up Claude. */
  relay?: RelayFn;
}

// ── Chat socket (Phase A of issue #268) ──────────────────────
//
// Bidirectional WebSocket transport for messaging bridges. Sits
// next to `/ws/pubsub` (frontend state sub) on the same HTTP
// server; path is `/ws/chat`. Client emits `message` with an
// ack callback, server dispatches through the shared
// `relayMessage` helper and invokes the ack with the reply.
//
// Future phases:
//   B — server→bridge push via `socket.to(room).emit("push", …)`
//   C — streaming text chunks via `reply.chunk`
//   D — HTTP endpoint deprecation
//
// See plans/feat-chat-socketio.md and plans/messaging_layers_guide.md.

export const CHAT_SOCKET_PATH = "/ws/chat";

interface HandshakeAuth {
  transportId?: unknown;
  token?: unknown;
}

interface MessagePayload {
  externalChatId?: unknown;
  text?: unknown;
}

type MessageAck =
  | { ok: true; reply: string }
  | { ok: false; error: string; status?: number };

export function attachChatSocket(
  server: http.Server,
  options: AttachChatSocketOptions = {},
): SocketServer {
  const relay = options.relay ?? defaultRelayMessage;
  const io = new SocketServer(server, {
    path: CHAT_SOCKET_PATH,
    // Same CORS stance as the rest of the app: browser SOP + CSRF
    // guard on HTTP paths, localhost-only bind. Socket.io defaults
    // to same-origin, which is what we want.
  });

  io.use((socket, next) => {
    const transportId = extractTransportId(socket.handshake.auth);
    if (!transportId) {
      next(new Error("transportId is required in handshake auth"));
      return;
    }
    socket.data.transportId = transportId;
    next();
  });

  io.on("connection", (socket: Socket) => {
    const transportId: string = socket.data.transportId;
    log.info("chat-service", "socket connected", {
      socketId: socket.id,
      transportId,
    });

    socket.on("disconnect", (reason: string) => {
      log.info("chat-service", "socket disconnected", {
        socketId: socket.id,
        transportId,
        reason,
      });
    });

    socket.on(
      "message",
      async (payload: MessagePayload, ack?: (reply: MessageAck) => void) => {
        if (typeof ack !== "function") {
          log.warn("chat-service", "socket message missing ack", {
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
        });

        if (result.kind === "ok") {
          ack({ ok: true, reply: result.reply });
        } else {
          ack({ ok: false, error: result.message, status: result.status });
        }
      },
    );
  });

  return io;
}

function extractTransportId(auth: unknown): string | null {
  if (!auth || typeof auth !== "object") return null;
  const value = (auth as HandshakeAuth).transportId;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

type ParsedMessage =
  | { ok: true; externalChatId: string; text: string }
  | { ok: false; error: string };

function parseMessagePayload(payload: MessagePayload): ParsedMessage {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "payload must be an object" };
  }
  const externalChatId =
    typeof payload.externalChatId === "string"
      ? payload.externalChatId.trim()
      : "";
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!externalChatId) {
    return { ok: false, error: "externalChatId is required" };
  }
  if (!text) {
    return { ok: false, error: "text is required" };
  }
  return { ok: true, externalChatId, text };
}
