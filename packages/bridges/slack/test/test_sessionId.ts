import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildExternalChatId, effectiveThreadTs, parseExternalChatId, parseGranularity } from "../src/sessionId.ts";

describe("parseGranularity", () => {
  it("defaults to 'channel' when env var is unset", () => {
    assert.equal(parseGranularity(undefined), "channel");
  });
  it("accepts 'channel'", () => {
    assert.equal(parseGranularity("channel"), "channel");
  });
  it("accepts 'thread'", () => {
    assert.equal(parseGranularity("thread"), "thread");
  });
  it("accepts 'auto'", () => {
    assert.equal(parseGranularity("auto"), "auto");
  });
  it("is case-insensitive", () => {
    assert.equal(parseGranularity("THREAD"), "thread");
    assert.equal(parseGranularity("Auto"), "auto");
  });
  it("throws on unknown value", () => {
    assert.throws(() => parseGranularity("chatty"), /Invalid SLACK_SESSION_GRANULARITY/);
  });
  it("throws on empty string", () => {
    assert.throws(() => parseGranularity(""), /Invalid SLACK_SESSION_GRANULARITY/);
  });
  it("throws on surrounding whitespace instead of trimming it away", () => {
    assert.throws(() => parseGranularity(" thread"), /Invalid SLACK_SESSION_GRANULARITY/);
    assert.throws(() => parseGranularity("thread "), /Invalid SLACK_SESSION_GRANULARITY/);
  });
});

describe("buildExternalChatId", () => {
  const channelId = "C01234";
  const threadTs = "1713614532.001200";

  it("channel mode: always returns channelId, ignoring thread_ts", () => {
    assert.equal(buildExternalChatId(channelId, undefined, "channel"), channelId);
    assert.equal(buildExternalChatId(channelId, threadTs, "channel"), channelId);
  });

  it("thread mode: channelId_thread_ts when in a thread", () => {
    assert.equal(buildExternalChatId(channelId, threadTs, "thread"), `${channelId}_${threadTs}`);
  });

  it("thread mode: channelId only when NOT in a thread (root message)", () => {
    assert.equal(buildExternalChatId(channelId, undefined, "thread"), channelId);
  });

  it("auto mode behaves the same as thread mode (v1)", () => {
    assert.equal(buildExternalChatId(channelId, threadTs, "auto"), `${channelId}_${threadTs}`);
    assert.equal(buildExternalChatId(channelId, undefined, "auto"), channelId);
  });

  it("treats empty-string threadTs as 'no thread'", () => {
    assert.equal(buildExternalChatId(channelId, "", "thread"), channelId);
  });
});

describe("effectiveThreadTs", () => {
  const eventTs = "1800000000.000100";
  const existingThread = "1799999999.000000";

  it("channel mode: top-level post → undefined (reply stays top-level)", () => {
    assert.equal(effectiveThreadTs({ ts: eventTs, channel_type: "channel" }, "channel"), undefined);
  });

  it("channel mode: in-thread post → existing thread_ts passes through", () => {
    assert.equal(effectiveThreadTs({ thread_ts: existingThread, ts: eventTs, channel_type: "channel" }, "channel"), existingThread);
  });

  it("thread mode: top-level channel post → synthesises thread_ts from event.ts", () => {
    assert.equal(effectiveThreadTs({ ts: eventTs, channel_type: "channel" }, "thread"), eventTs);
  });

  it("thread mode: in-thread post → existing thread_ts passes through (not overwritten by event.ts)", () => {
    assert.equal(effectiveThreadTs({ thread_ts: existingThread, ts: eventTs, channel_type: "channel" }, "thread"), existingThread);
  });

  it("thread mode: DM (channel_type='im') → undefined (no threading in DMs)", () => {
    assert.equal(effectiveThreadTs({ ts: eventTs, channel_type: "im" }, "thread"), undefined);
  });

  it("auto mode: top-level post → undefined (no auto-threading, same as channel mode)", () => {
    assert.equal(effectiveThreadTs({ ts: eventTs, channel_type: "channel" }, "auto"), undefined);
  });

  it("auto mode: in-thread post → existing thread_ts passes through", () => {
    assert.equal(effectiveThreadTs({ thread_ts: existingThread, ts: eventTs, channel_type: "channel" }, "auto"), existingThread);
  });

  it("thread mode: missing ts on a top-level channel post → undefined (defensive — shouldn't happen in practice)", () => {
    assert.equal(effectiveThreadTs({ channel_type: "channel" }, "thread"), undefined);
  });

  it("thread mode: empty-string thread_ts is ignored and falls back to synthesis", () => {
    assert.equal(effectiveThreadTs({ thread_ts: "", ts: eventTs, channel_type: "channel" }, "thread"), eventTs);
  });
});

describe("parseExternalChatId", () => {
  it("returns channel only when no underscore is present", () => {
    assert.deepEqual(parseExternalChatId("C01234"), { channel: "C01234" });
  });
  it("splits on the first underscore", () => {
    assert.deepEqual(parseExternalChatId("C01234_1713614532.001200"), {
      channel: "C01234",
      threadTs: "1713614532.001200",
    });
  });
  it("is the inverse of buildExternalChatId in thread mode", () => {
    const externalId = buildExternalChatId("D05ABCD", "1700000000.001000", "thread");
    const parsed = parseExternalChatId(externalId);
    assert.equal(parsed.channel, "D05ABCD");
    assert.equal(parsed.threadTs, "1700000000.001000");
  });
});
