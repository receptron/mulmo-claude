import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractIncomingLineMessage, parseLineWebhookBody, type LineEvent } from "../src/parse.js";

function textEvent(overrides: Partial<LineEvent> = {}): LineEvent {
  return {
    type: "message",
    message: { type: "text", text: "hello" },
    source: { userId: "U1234" },
    ...overrides,
  };
}

describe("extractIncomingLineMessage", () => {
  it("returns userId + text for a normal text message", () => {
    assert.deepEqual(extractIncomingLineMessage(textEvent()), { userId: "U1234", text: "hello" });
  });

  it("returns null for non-message event types", () => {
    assert.equal(extractIncomingLineMessage(textEvent({ type: "follow" })), null);
    assert.equal(extractIncomingLineMessage(textEvent({ type: "unfollow" })), null);
    assert.equal(extractIncomingLineMessage(textEvent({ type: "postback" })), null);
  });

  it("returns null when message type is not 'text'", () => {
    assert.equal(extractIncomingLineMessage(textEvent({ message: { type: "image" } })), null);
    assert.equal(extractIncomingLineMessage(textEvent({ message: { type: "sticker" } })), null);
  });

  it("returns null when message is missing entirely", () => {
    assert.equal(extractIncomingLineMessage({ type: "message", source: { userId: "U1" } }), null);
  });

  it("returns null when source.userId is missing", () => {
    assert.equal(extractIncomingLineMessage(textEvent({ source: { type: "user" } })), null);
    assert.equal(extractIncomingLineMessage(textEvent({ source: undefined })), null);
  });

  it("returns null for empty / whitespace text", () => {
    assert.equal(extractIncomingLineMessage(textEvent({ message: { type: "text", text: "" } })), null);
    assert.equal(extractIncomingLineMessage(textEvent({ message: { type: "text", text: "   " } })), null);
    assert.equal(extractIncomingLineMessage(textEvent({ message: { type: "text" } })), null);
  });

  it("preserves text without trimming (sender's whitespace inside is intentional)", () => {
    const result = extractIncomingLineMessage(textEvent({ message: { type: "text", text: "  hello  world  " } }));
    assert.equal(result?.text, "  hello  world  ");
  });
});

describe("parseLineWebhookBody", () => {
  it("returns the body for valid JSON with events array", () => {
    const json = JSON.stringify({ events: [{ type: "message" }] });
    assert.deepEqual(parseLineWebhookBody(json), { events: [{ type: "message" }] });
  });

  it("returns body with empty events array", () => {
    assert.deepEqual(parseLineWebhookBody('{"events": []}'), { events: [] });
  });

  it("returns null for malformed JSON", () => {
    assert.equal(parseLineWebhookBody("not json"), null);
    assert.equal(parseLineWebhookBody("{"), null);
    assert.equal(parseLineWebhookBody(""), null);
  });

  it("returns null when 'events' is missing", () => {
    assert.equal(parseLineWebhookBody("{}"), null);
    assert.equal(parseLineWebhookBody('{"foo": "bar"}'), null);
  });

  it("returns null when 'events' is not an array", () => {
    assert.equal(parseLineWebhookBody('{"events": "nope"}'), null);
    assert.equal(parseLineWebhookBody('{"events": null}'), null);
    assert.equal(parseLineWebhookBody('{"events": {}}'), null);
  });

  it("returns null for JSON null / number / string", () => {
    assert.equal(parseLineWebhookBody("null"), null);
    assert.equal(parseLineWebhookBody("42"), null);
    assert.equal(parseLineWebhookBody('"string"'), null);
  });
});
