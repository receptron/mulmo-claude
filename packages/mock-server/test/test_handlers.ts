import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleMessage, type MessagePayload } from "../src/handlers.ts";
import type { MockServerOptions } from "../src/server.ts";

const defaultOpts: MockServerOptions = {
  port: 3001,
  token: "test-token",
  slowMs: 0,
  alwaysError: false,
  rejectAuth: false,
  verbose: false,
};

function payload(text: string, chatId = "test-chat"): MessagePayload {
  return { externalChatId: chatId, text };
}

describe("handleMessage — echo mode", () => {
  it("echoes the user text", () => {
    const ack = handleMessage(payload("hello world"), defaultOpts);
    assert.equal(ack.ok, true);
    assert.equal(ack.reply, "[echo] hello world");
  });

  it("includes attachment summary in echo", () => {
    const msg: MessagePayload = {
      externalChatId: "c1",
      text: "look at this",
      attachments: [{ mimeType: "image/png", data: "AAAA" }],
    };
    const ack = handleMessage(msg, defaultOpts);
    assert.equal(ack.ok, true);
    assert.ok(ack.reply?.includes("[echo] look at this"));
    assert.ok(ack.reply?.includes("[attachment: image/png"));
  });

  it("includes filename when present", () => {
    const msg: MessagePayload = {
      externalChatId: "c1",
      text: "file",
      attachments: [
        { mimeType: "application/pdf", data: "AAAA", filename: "doc.pdf" },
      ],
    };
    const ack = handleMessage(msg, defaultOpts);
    assert.ok(ack.reply?.includes("doc.pdf"));
  });

  it("handles empty text", () => {
    const ack = handleMessage(payload(""), defaultOpts);
    assert.equal(ack.ok, true);
    assert.equal(ack.reply, "[echo] ");
  });
});

describe("handleMessage — slash commands", () => {
  it("/help returns help text", () => {
    const ack = handleMessage(payload("/help"), defaultOpts);
    assert.equal(ack.ok, true);
    assert.ok(ack.reply?.includes("Available commands"));
    assert.ok(ack.reply?.includes("/reset"));
  });

  it("/reset returns confirmation", () => {
    const ack = handleMessage(payload("/reset"), defaultOpts);
    assert.equal(ack.ok, true);
    assert.ok(ack.reply?.includes("Session reset"));
  });

  it("/roles lists available roles", () => {
    const ack = handleMessage(payload("/roles"), defaultOpts);
    assert.equal(ack.ok, true);
    assert.ok(ack.reply?.includes("general"));
    assert.ok(ack.reply?.includes("artist"));
  });

  it("/role <id> switches role", () => {
    const ack = handleMessage(payload("/role artist"), defaultOpts);
    assert.equal(ack.ok, true);
    assert.ok(ack.reply?.includes("artist"));
    assert.ok(ack.reply?.includes("Switched"));
  });

  it("/role without arg defaults to general", () => {
    const ack = handleMessage(payload("/role"), defaultOpts);
    assert.equal(ack.ok, true);
    assert.ok(ack.reply?.includes("general"));
  });

  it("/status returns session info", () => {
    const ack = handleMessage(payload("/status", "my-chat"), defaultOpts);
    assert.equal(ack.ok, true);
    assert.ok(ack.reply?.includes("Role: general"));
    assert.ok(ack.reply?.includes("my-chat"));
  });

  it("unknown command returns help with error", () => {
    const ack = handleMessage(payload("/foo"), defaultOpts);
    assert.equal(ack.ok, true);
    assert.ok(ack.reply?.includes("Unknown command: /foo"));
    assert.ok(ack.reply?.includes("Available commands"));
  });

  it("non-slash text is not treated as command", () => {
    const ack = handleMessage(payload("just text"), defaultOpts);
    assert.equal(ack.ok, true);
    assert.equal(ack.reply, "[echo] just text");
  });
});

describe("handleMessage — alwaysError mode", () => {
  const errorOpts: MockServerOptions = { ...defaultOpts, alwaysError: true };

  it("returns error ack for any message", () => {
    const ack = handleMessage(payload("hello"), errorOpts);
    assert.equal(ack.ok, false);
    assert.equal(ack.status, 500);
    assert.ok(ack.error?.includes("simulated"));
  });

  it("returns error even for slash commands", () => {
    const ack = handleMessage(payload("/help"), errorOpts);
    assert.equal(ack.ok, false);
  });
});
