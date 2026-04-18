// Socket.io event names and path for the chat bridge WebSocket.

export const CHAT_SOCKET_PATH = "/ws/chat";

export const CHAT_SOCKET_EVENTS = {
  message: "message",
  push: "push",
} as const;

export type ChatSocketEvent =
  (typeof CHAT_SOCKET_EVENTS)[keyof typeof CHAT_SOCKET_EVENTS];
