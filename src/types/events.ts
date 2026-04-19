// Single source of truth: @mulmobridge/protocol.
//
// This file re-exports so that ~30 server/frontend files that import
// from "../../src/types/events.js" keep working without a mass rename.
// New code should import directly from "@mulmobridge/protocol" when
// it's in a package-eligible module (chat-service, bridges).

export { EVENT_TYPES, type EventType } from "@mulmobridge/protocol";
