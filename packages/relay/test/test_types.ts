import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PLATFORMS } from "../src/types.js";

describe("PLATFORMS", () => {
  it("has all expected platform identifiers", () => {
    assert.equal(PLATFORMS.line, "line");
    assert.equal(PLATFORMS.telegram, "telegram");
    assert.equal(PLATFORMS.slack, "slack");
    assert.equal(PLATFORMS.discord, "discord");
    assert.equal(PLATFORMS.messenger, "messenger");
    assert.equal(PLATFORMS.mattermost, "mattermost");
    assert.equal(PLATFORMS.zulip, "zulip");
    assert.equal(PLATFORMS.whatsapp, "whatsapp");
    assert.equal(PLATFORMS.matrix, "matrix");
    assert.equal(PLATFORMS.irc, "irc");
    assert.equal(PLATFORMS.googleChat, "google-chat");
  });

  it("values are unique", () => {
    const values = Object.values(PLATFORMS);
    assert.equal(values.length, new Set(values).size);
  });
});

describe("RelayMessage shape", () => {
  it("can construct a valid message", () => {
    const msg = {
      id: "test-id",
      platform: PLATFORMS.line,
      senderId: "user-1",
      chatId: "chat-1",
      text: "hello",
      receivedAt: new Date().toISOString(),
    };
    assert.equal(msg.platform, "line");
    assert.equal(msg.text, "hello");
  });
});
