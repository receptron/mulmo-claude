// Shared socket.io client wrapper for every MulmoClaude bridge.
//
// A bridge is a small process that glues one external messaging
// platform (CLI / Telegram / LINE / Slack / …) to MulmoClaude's
// chat-service. Every bridge needs the exact same socket setup:
// read the bearer token, connect to `/ws/chat` with
// `{ transportId, token }`, handle connect / disconnect / token-
// mismatch, and send / receive on the two wire events (`message`
// with ack, `push` from the server). That machinery lives here so
// each new bridge file is just the platform adapter.
//
// See `docs/bridge-protocol.md` for the wire-level contract and a
// minimal non-Node equivalent.

import { io, type Socket } from "socket.io-client";
import { readBridgeToken, TOKEN_FILE_PATH } from "./token.js";

// 6 min > the server's REPLY_TIMEOUT_MS (5 min) so the server's
// timeout surfaces as a reply, not a client-side cancellation.
const REPLY_TIMEOUT_MS = 6 * 60 * 1000;

const DEFAULT_API_URL = "http://localhost:3001";
const CHAT_SOCKET_PATH = "/ws/chat";

export interface MessageAck {
  ok: boolean;
  reply?: string;
  error?: string;
  status?: number;
}

export interface PushEvent {
  chatId: string;
  message: string;
}

export interface BridgeClientOptions {
  /** Required. Identifier for this bridge in the handshake.
   *  Matches `handshake.auth.transportId` server-side. */
  transportId: string;
  /** Defaults to `$MULMOCLAUDE_API_URL` or `http://localhost:3001`. */
  apiUrl?: string;
}

export interface BridgeClient {
  /** Send a user turn to MulmoClaude, wait for the assistant reply. */
  send(externalChatId: string, text: string): Promise<MessageAck>;
  /** Subscribe to server → bridge async pushes (Phase B of #268). */
  onPush(handler: (event: PushEvent) => void): void;
  /** Called each time the socket (re-)establishes a connection. */
  onConnect(handler: () => void): void;
  /** Called when the socket disconnects. */
  onDisconnect(handler: (reason: string) => void): void;
  /** Explicit shutdown. */
  close(): void;
  /** Escape hatch — raw socket for anything the helpers don't cover. */
  socket: Socket;
}

/**
 * Resolve the bearer token from the workspace / env var, exit with
 * a clear error if absent. Kept separate so bridges that want to
 * surface the error differently (e.g. print to a platform channel)
 * can call `readBridgeToken()` directly.
 */
export function requireBearerToken(): string {
  const token = readBridgeToken();
  if (token !== null) return token;
  process.stderr.write(
    `No bearer token found. The MulmoClaude server writes one to\n` +
      `  ${TOKEN_FILE_PATH}\n` +
      `at startup (mode 0600). Start the server with \`yarn dev\` (or\n` +
      `\`npm run dev\`) first, or set MULMOCLAUDE_AUTH_TOKEN to the\n` +
      `same value the server is using.\n`,
  );
  process.exit(1);
}

export function createBridgeClient(opts: BridgeClientOptions): BridgeClient {
  const apiUrl =
    opts.apiUrl ?? process.env.MULMOCLAUDE_API_URL ?? DEFAULT_API_URL;
  const token = requireBearerToken();

  const socket = io(apiUrl, {
    path: CHAT_SOCKET_PATH,
    auth: { transportId: opts.transportId, token },
    transports: ["websocket"],
  });

  installDefaultLogging(socket);

  return {
    send: (externalChatId, text) => sendMessage(socket, externalChatId, text),
    onPush: (handler) => {
      socket.on("push", handler);
    },
    onConnect: (handler) => {
      socket.on("connect", handler);
    },
    onDisconnect: (handler) => {
      socket.on("disconnect", handler);
    },
    close: () => {
      socket.disconnect();
    },
    socket,
  };
}

function sendMessage(
  socket: Socket,
  externalChatId: string,
  text: string,
): Promise<MessageAck> {
  return new Promise((resolve) => {
    socket
      .timeout(REPLY_TIMEOUT_MS)
      .emit(
        "message",
        { externalChatId, text },
        (err: Error | null, ack: MessageAck | undefined) => {
          if (err) {
            resolve({ ok: false, error: `timeout: ${err.message}` });
            return;
          }
          resolve(ack ?? { ok: false, error: "no ack from server" });
        },
      );
  });
}

function installDefaultLogging(socket: Socket): void {
  socket.on("connect", () => {
    console.log(`Connected (${socket.id}).`);
  });
  socket.on("disconnect", (reason) => {
    console.error(`\nDisconnected: ${reason}`);
  });
  socket.on("connect_error", (err) => {
    const msg = err.message;
    // Token-mismatch recovery: the server rewrites its token on
    // every restart, so an old bridge will see "invalid token"
    // right after the server bounces. Tell the user instead of
    // spinning silently.
    if (msg === "invalid token" || msg === "server auth not ready") {
      console.error(
        "\nConnect error: bearer token rejected. The server likely\n" +
          "restarted since this bridge started — re-run the bridge to\n" +
          "pick up the new token.\n",
      );
      return;
    }
    console.error(`\nConnect error: ${msg}`);
  });
}
