// Socket.io event names and path for the chat bridge WebSocket.

export const CHAT_SOCKET_PATH = "/ws/chat";

export const CHAT_SOCKET_EVENTS = {
  message: "message",
  push: "push",
  /** Server → bridge streaming text chunk (Phase C of #268).
   *  Emitted during a relay while the agent is generating text.
   *  Bridge accumulates chunks for display; the final ack still
   *  carries the full response for backward compatibility. */
  textChunk: "textChunk",
} as const;

export type ChatSocketEvent = (typeof CHAT_SOCKET_EVENTS)[keyof typeof CHAT_SOCKET_EVENTS];

/**
 * Bridge → host-app option bag carried on the handshake.
 *
 * Values are restricted to flat primitives (string / number /
 * boolean). The restriction serves two purposes:
 *
 *   1. The wire contract is explicit — no surprise nested objects
 *      slip through to the host app's callback where a downstream
 *      merge might reintroduce prototype-pollution risk.
 *   2. The scrape-from-env path produces strings anyway, so the
 *      ceiling is already flat primitives in practice.
 *
 * Protocol does not interpret any keys — bridges and host apps agree
 * on names (`defaultRole`, …) out of band.
 */
export type BridgeOptions = Readonly<Record<string, string | number | boolean>>;

/**
 * Shape of `socket.handshake.auth` on the bridge chat socket. The
 * server validates `transportId` + `token`; `options` is the opaque-
 * but-primitive bag forwarded to the host application's startChat
 * callback. See `plans/done/feat-bridge-options-passthrough.md`.
 */
export interface BridgeHandshakeAuth {
  transportId: string;
  token?: string;
  options?: BridgeOptions;
}
