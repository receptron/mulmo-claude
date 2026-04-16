// @package-contract — see ./types.ts
//
// Socket.io transport for the bridge chat flow (Phase A of #268).
// Sits next to the HTTP router at `/ws/chat`. DI-pure — it takes a
// `RelayFn` and a `Logger` through the factory so the package has
// no direct imports from the host app.
//
// Client contract:
//   handshake.auth: { transportId: string }
//   emit("message", { externalChatId, text }, ack)
//     ack receives either { ok: true, reply } or
//     { ok: false, error, status? }
//
// Future phases:
//   B — server→bridge push via rooms (#263)
//   C — streaming text chunks via reply.chunk
//   D — HTTP endpoint deprecation
//
// See plans/feat-chat-socketio.md and plans/messaging_layers_guide.md.

import type http from "http";
import { Server as SocketServer } from "socket.io";
import type { Socket } from "socket.io";
import type { RelayFn } from "./relay.js";
import type { Logger } from "./types.js";

export const CHAT_SOCKET_PATH = "/ws/chat";

export interface ChatSocketDeps {
  relay: RelayFn;
  logger: Logger;
}

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

type ParsedMessage =
  | { ok: true; externalChatId: string; text: string }
  | { ok: false; error: string };

export function attachChatSocket(
  server: http.Server,
  deps: ChatSocketDeps,
): SocketServer {
  const { relay, logger } = deps;

  const io = new SocketServer(server, {
    path: CHAT_SOCKET_PATH,
    // Same CORS stance as the rest of the host: browser SOP +
    // localhost-only bind. Socket.io defaults to same-origin.
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

    socket.on(
      "message",
      async (payload: MessagePayload, ack?: (reply: MessageAck) => void) => {
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
