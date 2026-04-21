import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EVENT_TYPES, CHAT_SOCKET_EVENTS, CHAT_SOCKET_PATH, CHAT_SERVICE_ROUTES } from "../src/index.js";
import type { EventType, ChatSocketEvent, Attachment } from "../src/index.js";

describe("@mulmobridge/protocol exports", () => {
  it("EVENT_TYPES contains all expected keys", () => {
    const expected = [
      "status",
      "text",
      "toolCall",
      "toolCallResult",
      "toolResult",
      "switchRole",
      "error",
      "claudeSessionId",
      "sessionFinished",
      "sessionMeta",
      "rolesUpdated",
      "generationStarted",
      "generationFinished",
    ];
    assert.deepEqual(Object.keys(EVENT_TYPES).sort(), expected.sort());
  });

  it("EVENT_TYPES values are unique strings", () => {
    const values = Object.values(EVENT_TYPES);
    assert.equal(new Set(values).size, values.length, "duplicate values");
    values.forEach((v) => assert.equal(typeof v, "string"));
  });

  it("EventType is assignable from EVENT_TYPES values", () => {
    const t: EventType = EVENT_TYPES.text;
    assert.equal(t, "text");
  });

  it("CHAT_SOCKET_EVENTS has message and push", () => {
    assert.equal(CHAT_SOCKET_EVENTS.message, "message");
    assert.equal(CHAT_SOCKET_EVENTS.push, "push");
  });

  it("ChatSocketEvent is assignable from CHAT_SOCKET_EVENTS", () => {
    const e: ChatSocketEvent = CHAT_SOCKET_EVENTS.push;
    assert.equal(e, "push");
  });

  it("CHAT_SOCKET_PATH is a string starting with /", () => {
    assert.equal(typeof CHAT_SOCKET_PATH, "string");
    assert.ok(CHAT_SOCKET_PATH.startsWith("/"));
  });

  it("CHAT_SERVICE_ROUTES has message and connect patterns", () => {
    assert.ok(CHAT_SERVICE_ROUTES.message.includes(":transportId"));
    assert.ok(CHAT_SERVICE_ROUTES.connect.includes(":externalChatId"));
  });

  it("Attachment type is structurally valid", () => {
    const a: Attachment = { mimeType: "image/png", data: "abc123" };
    assert.equal(a.mimeType, "image/png");
    assert.equal(a.filename, undefined);
  });
});
