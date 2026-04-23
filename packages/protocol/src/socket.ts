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
 * Shape of `socket.handshake.auth` on the bridge chat socket. The
 * server validates `transportId` + `token`; `options` is an opaque
 * bag forwarded verbatim to the host application's startChat
 * callback. The protocol doesn't interpret any keys — bridges and
 * host apps agree on the key names (e.g. `defaultRole`) out of band.
 *
 * See `plans/feat-bridge-options-passthrough.md` for the convention.
 */
export interface BridgeHandshakeAuth {
  transportId: string;
  token?: string;
  options?: Readonly<Record<string, unknown>>;
}
