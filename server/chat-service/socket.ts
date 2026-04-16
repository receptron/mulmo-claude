// @package-contract — see ./types.ts
//
// Socket.io transport for the bridge chat flow (Phase A of #268).
// Sits next to the HTTP router at path `/ws/chat`. DI-pure — it
// takes a `RelayFn`, a logger, and an optional bearer-token
// validator through the factory so the package has no direct
// imports from the host app.
//
// Client contract:
//   handshake.auth: { transportId: string; token?: string }
//   emit("message", { externalChatId, text }, ack)
//     ack receives { ok: true, reply }
//                 | { ok: false, error, status? }
//
// Auth: when `tokenProvider` is supplied, the handshake is rejected
// unless `auth.token` equals `tokenProvider()`. When it's omitted
// (tests, unauth environments), the handshake is not checked for
// auth — only `transportId` validation runs.
//
// Future phases (see plans/feat-chat-socketio.md):
//   B — server→bridge push via rooms (#263)
//   C — streaming text chunks via `reply.chunk`
//   D — HTTP endpoint deprecation

import type http from "http";
import { Server as SocketServer } from "socket.io";
import type { Socket } from "socket.io";
import type { RelayFn } from "./relay.js";
import type { Logger } from "./types.js";

export const CHAT_SOCKET_PATH = "/ws/chat";

export interface ChatSocketDeps {
  relay: RelayFn;
  logger: Logger;
  /** Current bearer token the handshake must carry. Null means
   *  bootstrap in progress — reject everything. Omit to disable. */
  tokenProvider?: () => string | null;
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

type HandshakeResult =
  | { ok: true; transportId: string }
  | { ok: false; error: string };

export function attachChatSocket(
  server: http.Server,
  deps: ChatSocketDeps,
): SocketServer {
  const { relay, logger, tokenProvider } = deps;

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

function validateHandshake(
  auth: unknown,
  tokenProvider: (() => string | null) | undefined,
): HandshakeResult {
  if (!auth || typeof auth !== "object") {
    return { ok: false, error: "handshake auth is required" };
  }
  const transportIdRaw = (auth as HandshakeAuth).transportId;
  if (
    typeof transportIdRaw !== "string" ||
    transportIdRaw.trim().length === 0
  ) {
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
