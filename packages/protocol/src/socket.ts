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

export type ChatSocketEvent =
  (typeof CHAT_SOCKET_EVENTS)[keyof typeof CHAT_SOCKET_EVENTS];
