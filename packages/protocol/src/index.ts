// @mulmobridge/protocol — shared constants and interfaces for the
// MulmoBridge chat protocol.
//
// This package defines the wire-level contract between:
//   - The chat-service (server-side socket.io + REST)
//   - External bridges (CLI, Telegram, future platforms)
//
// No runtime dependencies. Types + const-only.

export {
  EVENT_TYPES,
  type EventType,
  GENERATION_KINDS,
  type GenerationKind,
  type GenerationEvent,
  type PendingGeneration,
  generationKey,
} from "./events.js";
export {
  CHAT_SOCKET_PATH,
  CHAT_SOCKET_EVENTS,
  type ChatSocketEvent,
} from "./socket.js";
export { type Attachment } from "./attachment.js";
export { CHAT_SERVICE_ROUTES } from "./routes.js";
