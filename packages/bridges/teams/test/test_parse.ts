import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Activity } from "botbuilder";
import { extractIncomingMessage } from "../src/parse.js";

function makeActivity(overrides: Partial<Activity>): Activity {
  return {
    type: "message",
    from: { id: "user-123", aadObjectId: "aad-abc" },
    conversation: { id: "conv-1" },
    text: "hello",
    ...overrides,
  } as Activity;
}

describe("extractIncomingMessage", () => {
  it("returns the parsed message for a normal user activity", () => {
    const out = extractIncomingMessage(makeActivity({}));
    assert.deepEqual(out, { senderId: "aad-abc", chatId: "conv-1", text: "hello" });
  });

  it("falls back to from.id when aadObjectId is missing", () => {
    const out = extractIncomingMessage(makeActivity({ from: { id: "user-99" } }));
    assert.deepEqual(out, { senderId: "user-99", chatId: "conv-1", text: "hello" });
  });

  it("trims surrounding whitespace from text", () => {
    const out = extractIncomingMessage(makeActivity({ text: "   hi   " }));
    assert.equal(out?.text, "hi");
  });

  it("returns null when activity type is not 'message'", () => {
    assert.equal(extractIncomingMessage(makeActivity({ type: "conversationUpdate" })), null);
    assert.equal(extractIncomingMessage(makeActivity({ type: "typing" })), null);
  });

  it("returns null when both aadObjectId and id are missing", () => {
    assert.equal(extractIncomingMessage(makeActivity({ from: {} as Activity["from"] })), null);
  });

  it("returns null when from is undefined", () => {
    assert.equal(extractIncomingMessage(makeActivity({ from: undefined })), null);
  });

  it("returns null when conversation.id is missing", () => {
    assert.equal(extractIncomingMessage(makeActivity({ conversation: {} as Activity["conversation"] })), null);
  });

  it("returns null for empty / whitespace-only text", () => {
    assert.equal(extractIncomingMessage(makeActivity({ text: "" })), null);
    assert.equal(extractIncomingMessage(makeActivity({ text: "   " })), null);
    assert.equal(extractIncomingMessage(makeActivity({ text: undefined })), null);
  });

  it("preserves long text without truncation", () => {
    const long = "x".repeat(10_000);
    assert.equal(extractIncomingMessage(makeActivity({ text: long }))?.text, long);
  });
});
