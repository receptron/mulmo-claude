// Regression tests for the LINE webhook event parser. Same shape as
// test_google_chat_webhook.ts / test_teams_webhook.ts: only the pure
// helper is exercised here — HMAC signature verification is out of
// scope.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseLineMessageEvent, type LineEvent } from "../src/webhooks/line.ts";

function textEvent(overrides: Partial<LineEvent> = {}): LineEvent {
  return {
    type: "message",
    message: { type: "text", text: "hello" },
    source: { userId: "U123" },
    replyToken: "tok-1",
    ...overrides,
  };
}

describe("parseLineMessageEvent", () => {
  it("parses a 1:1 text message — chatId falls back to userId", () => {
    assert.deepEqual(parseLineMessageEvent(textEvent()), {
      chatId: "U123",
      senderId: "U123",
      text: "hello",
      replyToken: "tok-1",
    });
  });

  it("uses groupId for the chatId when available (group win over user)", () => {
    const out = parseLineMessageEvent(textEvent({ source: { groupId: "G1", userId: "U123" } }));
    assert.deepEqual(out, { chatId: "G1", senderId: "U123", text: "hello", replyToken: "tok-1" });
  });

  it("uses roomId when no groupId is present", () => {
    const out = parseLineMessageEvent(textEvent({ source: { roomId: "R1", userId: "U123" } }));
    assert.deepEqual(out, { chatId: "R1", senderId: "U123", text: "hello", replyToken: "tok-1" });
  });

  it("groupId wins over roomId", () => {
    const out = parseLineMessageEvent(textEvent({ source: { groupId: "G1", roomId: "R1", userId: "U123" } }));
    assert.equal(out?.chatId, "G1");
  });

  it("uses 'unknown' when no source identifier is present", () => {
    const out = parseLineMessageEvent(textEvent({ source: {} }));
    assert.deepEqual(out, { chatId: "unknown", senderId: "unknown", text: "hello", replyToken: "tok-1" });
  });

  it("uses 'unknown' for both fields when source is missing entirely", () => {
    const out = parseLineMessageEvent(textEvent({ source: undefined }));
    assert.deepEqual(out, { chatId: "unknown", senderId: "unknown", text: "hello", replyToken: "tok-1" });
  });

  it("returns null for non-message event types", () => {
    assert.equal(parseLineMessageEvent(textEvent({ type: "follow" })), null);
    assert.equal(parseLineMessageEvent(textEvent({ type: "unfollow" })), null);
    assert.equal(parseLineMessageEvent(textEvent({ type: "postback" })), null);
  });

  it("returns null when message type is not 'text'", () => {
    assert.equal(parseLineMessageEvent(textEvent({ message: { type: "image" } })), null);
    assert.equal(parseLineMessageEvent(textEvent({ message: { type: "sticker" } })), null);
  });

  it("returns null when message is missing entirely", () => {
    assert.equal(parseLineMessageEvent({ type: "message", source: { userId: "U1" } }), null);
  });

  it("returns null when text field is missing or empty", () => {
    assert.equal(parseLineMessageEvent(textEvent({ message: { type: "text" } })), null);
    assert.equal(parseLineMessageEvent(textEvent({ message: { type: "text", text: "" } })), null);
  });

  it("preserves whitespace text (does not trim — caller decides)", () => {
    const out = parseLineMessageEvent(textEvent({ message: { type: "text", text: "  hi  " } }));
    assert.equal(out?.text, "  hi  ");
  });

  it("preserves replyToken", () => {
    assert.equal(parseLineMessageEvent(textEvent({ replyToken: "abc" }))?.replyToken, "abc");
  });

  it("returns undefined replyToken when not present", () => {
    assert.equal(parseLineMessageEvent(textEvent({ replyToken: undefined }))?.replyToken, undefined);
  });
});
