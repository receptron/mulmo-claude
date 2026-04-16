import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createMessageRouter,
  type SendToMulmoFn,
} from "../../../bridges/telegram/router.ts";
import type {
  TelegramApi,
  TelegramMessage,
} from "../../../bridges/telegram/api.ts";
import { createAllowlist } from "../../../bridges/telegram/allowlist.ts";
import type { PushEvent } from "../../../bridges/_lib/client.ts";

interface SentMessage {
  chatId: number;
  text: string;
}

function stubApi(): TelegramApi & { sent: SentMessage[] } {
  const sent: SentMessage[] = [];
  return {
    sent,
    async getUpdates() {
      return [];
    },
    async sendMessage(chatId, text) {
      sent.push({ chatId, text });
    },
  };
}

function msg(
  chatId: number,
  text: string,
  username = "alice",
): TelegramMessage {
  return {
    message_id: 1,
    chat: { id: chatId, type: "private" },
    from: { id: 1, is_bot: false, first_name: "A", username },
    date: 0,
    text,
  };
}

const silentLog = { info: () => {}, warn: () => {}, error: () => {} };

describe("router.handleMessage — allowed chat", () => {
  let api: ReturnType<typeof stubApi>;
  let mulmoCalls: { chatId: string; text: string }[];
  const sendOK: SendToMulmoFn = async (chatId, text) => {
    mulmoCalls.push({ chatId, text });
    return { ok: true, reply: "hi back" };
  };

  beforeEach(() => {
    api = stubApi();
    mulmoCalls = [];
  });

  it("forwards an allowed message and sends the reply", async () => {
    const router = createMessageRouter({
      api,
      allowlist: createAllowlist([42]),
      sendToMulmo: sendOK,
      log: silentLog,
    });
    await router.handleMessage(msg(42, "hello"));
    assert.deepEqual(mulmoCalls, [{ chatId: "42", text: "hello" }]);
    assert.deepEqual(api.sent, [{ chatId: 42, text: "hi back" }]);
  });

  it("ignores whitespace-only messages (doesn't call MulmoClaude)", async () => {
    const router = createMessageRouter({
      api,
      allowlist: createAllowlist([42]),
      sendToMulmo: sendOK,
      log: silentLog,
    });
    await router.handleMessage(msg(42, "   "));
    assert.equal(mulmoCalls.length, 0);
    assert.equal(api.sent.length, 0);
  });

  it("relays error acks as an error message", async () => {
    const sendErr: SendToMulmoFn = async () => ({
      ok: false,
      error: "boom",
      status: 500,
    });
    const router = createMessageRouter({
      api,
      allowlist: createAllowlist([42]),
      sendToMulmo: sendErr,
      log: silentLog,
    });
    await router.handleMessage(msg(42, "hi"));
    assert.equal(api.sent.length, 1);
    assert.match(api.sent[0].text, /Error \(500\): boom/);
  });

  it("splits replies longer than 4096 chars into multiple sendMessage calls", async () => {
    const longReply = "x".repeat(4096 * 2 + 100);
    const sendLong: SendToMulmoFn = async () => ({
      ok: true,
      reply: longReply,
    });
    const router = createMessageRouter({
      api,
      allowlist: createAllowlist([42]),
      sendToMulmo: sendLong,
      log: silentLog,
    });
    await router.handleMessage(msg(42, "tell me"));
    assert.equal(api.sent.length, 3);
    assert.equal(api.sent[0].text.length, 4096);
    assert.equal(api.sent[1].text.length, 4096);
    assert.equal(api.sent[2].text.length, 100);
  });

  it("empty reply becomes '(empty reply)' so the user sees something", async () => {
    const sendEmpty: SendToMulmoFn = async () => ({ ok: true, reply: "" });
    const router = createMessageRouter({
      api,
      allowlist: createAllowlist([42]),
      sendToMulmo: sendEmpty,
      log: silentLog,
    });
    await router.handleMessage(msg(42, "ping"));
    assert.deepEqual(api.sent, [{ chatId: 42, text: "(empty reply)" }]);
  });
});

describe("router.handleMessage — denied chat", () => {
  const mulmoNever: SendToMulmoFn = async () => {
    throw new Error("should not be called for denied chats");
  };

  it("replies with access-denied once and skips the forward", async () => {
    const api = stubApi();
    const router = createMessageRouter({
      api,
      allowlist: createAllowlist([]),
      sendToMulmo: mulmoNever,
      log: silentLog,
    });
    await router.handleMessage(msg(999, "hi"));
    assert.equal(api.sent.length, 1);
    assert.match(api.sent[0].text, /Access denied/);
    assert.equal(router.deniedAlreadyNotified().has(999), true);
  });

  it("does not re-notify the same denied chat on subsequent messages", async () => {
    const api = stubApi();
    const router = createMessageRouter({
      api,
      allowlist: createAllowlist([]),
      sendToMulmo: mulmoNever,
      log: silentLog,
    });
    await router.handleMessage(msg(999, "first"));
    await router.handleMessage(msg(999, "second"));
    await router.handleMessage(msg(999, "third"));
    assert.equal(api.sent.length, 1);
  });

  it("notifies different denied chats separately", async () => {
    const api = stubApi();
    const router = createMessageRouter({
      api,
      allowlist: createAllowlist([]),
      sendToMulmo: mulmoNever,
      log: silentLog,
    });
    await router.handleMessage(msg(111, "x"));
    await router.handleMessage(msg(222, "y"));
    assert.equal(api.sent.length, 2);
    assert.deepEqual(
      api.sent.map((s) => s.chatId).sort((a, b) => a - b),
      [111, 222],
    );
  });
});

describe("router.handlePush", () => {
  function push(chatId: string, message: string): PushEvent {
    return { chatId, message };
  }

  it("delivers to an allowed chat", async () => {
    const api = stubApi();
    const router = createMessageRouter({
      api,
      allowlist: createAllowlist([42]),
      sendToMulmo: (async () => ({ ok: true })) as SendToMulmoFn,
      log: silentLog,
    });
    await router.handlePush(push("42", "your daily brief"));
    assert.deepEqual(api.sent, [{ chatId: 42, text: "your daily brief" }]);
  });

  it("silently drops a push to a non-allowed chat (defense in depth)", async () => {
    const api = stubApi();
    const router = createMessageRouter({
      api,
      allowlist: createAllowlist([42]),
      sendToMulmo: (async () => ({ ok: true })) as SendToMulmoFn,
      log: silentLog,
    });
    await router.handlePush(push("999", "leaked"));
    assert.equal(api.sent.length, 0);
  });

  it("drops a push with a non-integer chatId", async () => {
    const api = stubApi();
    const router = createMessageRouter({
      api,
      allowlist: createAllowlist([42]),
      sendToMulmo: (async () => ({ ok: true })) as SendToMulmoFn,
      log: silentLog,
    });
    await router.handlePush(push("not-a-number", "x"));
    assert.equal(api.sent.length, 0);
  });

  it("chunks long push messages over 4096 chars", async () => {
    const api = stubApi();
    const router = createMessageRouter({
      api,
      allowlist: createAllowlist([42]),
      sendToMulmo: (async () => ({ ok: true })) as SendToMulmoFn,
      log: silentLog,
    });
    const long = "y".repeat(5000);
    await router.handlePush(push("42", long));
    assert.equal(api.sent.length, 2);
    assert.equal(api.sent[0].text.length, 4096);
    assert.equal(api.sent[1].text.length, 904);
  });
});
