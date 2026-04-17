// Chat-service route patterns. Only the subset needed by the
// chat-service package — the full API_ROUTES lives in the root app.

export const CHAT_SERVICE_ROUTES = {
  message: "/api/transports/:transportId/chats/:externalChatId",
  connect: "/api/transports/:transportId/chats/:externalChatId/connect",
} as const;
