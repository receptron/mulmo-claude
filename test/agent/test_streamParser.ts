import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createStreamParser, blockToEvent, type RawStreamEvent } from "../../server/agent/stream.ts";
import { EVENT_TYPES } from "../../src/types/events.ts";

describe("blockToEvent", () => {
  it("emits text event for text blocks", () => {
    const result = blockToEvent({ type: "text", text: "hello" });
    assert.deepEqual(result, { type: EVENT_TYPES.text, message: "hello" });
  });

  it("emits toolCall for tool_use blocks", () => {
    const result = blockToEvent({
      type: "tool_use",
      id: "t1",
      name: "Bash",
      input: { command: "ls" },
    });
    assert.equal(result?.type, EVENT_TYPES.toolCall);
  });

  it("returns null for unknown block types", () => {
    assert.equal(blockToEvent({ type: "thinking" }), null);
  });
});

describe("createStreamParser — delta streaming", () => {
  it("emits text events from stream_event text_delta", () => {
    const parser = createStreamParser();
    const events = parser.parse({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "hello " },
      },
    });
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], { type: EVENT_TYPES.text, message: "hello " });
  });

  it("suppresses assistant text block after deltas were streamed", () => {
    const parser = createStreamParser();
    // Stream a delta first
    parser.parse({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "streamed" },
      },
    });
    // Then assistant event with full text
    const events = parser.parse({
      type: "assistant",
      message: { content: [{ type: "text", text: "streamed" }] },
    });
    // Should have status but NO text (filtered as duplicate)
    const textEvents = events.filter((evt) => evt.type === EVENT_TYPES.text);
    assert.equal(textEvents.length, 0);
    assert.ok(events.some((evt) => evt.type === EVENT_TYPES.status));
  });

  it("suppresses result text after deltas were streamed", () => {
    const parser = createStreamParser();
    parser.parse({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "streamed" },
      },
    });
    // Result should only emit session_id, not text
    const events = parser.parse({
      type: "result",
      result: "streamed",
      session_id: "sess-1",
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].type, EVENT_TYPES.claudeSessionId);
  });
});

describe("createStreamParser — no deltas (fallback)", () => {
  it("emits text from assistant block when no deltas preceded", () => {
    const parser = createStreamParser();
    const events = parser.parse({
      type: "assistant",
      message: { content: [{ type: "text", text: "direct reply" }] },
    });
    const textEvents = events.filter((evt) => evt.type === EVENT_TYPES.text);
    assert.equal(textEvents.length, 1);
    assert.equal(textEvents[0].message, "direct reply");
  });

  it("suppresses result text after assistant block emitted text", () => {
    const parser = createStreamParser();
    parser.parse({
      type: "assistant",
      message: { content: [{ type: "text", text: "from block" }] },
    });
    const events = parser.parse({
      type: "result",
      result: "from block",
    });
    // No text event from result (already emitted via assistant)
    const textEvents = events.filter((evt) => evt.type === EVENT_TYPES.text);
    assert.equal(textEvents.length, 0);
  });

  it("falls back to result text when neither delta nor assistant text existed", () => {
    const parser = createStreamParser();
    // Only a result event, no assistant blocks
    const events = parser.parse({
      type: "result",
      result: "fallback text",
      session_id: "s1",
    });
    assert.equal(events.length, 2);
    assert.deepEqual(events[0], {
      type: EVENT_TYPES.text,
      message: "fallback text",
    });
    assert.equal(events[1].type, EVENT_TYPES.claudeSessionId);
  });
});

describe("createStreamParser — multi-turn reset", () => {
  it("resets flags after result so next turn works independently", () => {
    const parser = createStreamParser();
    // Turn 1: delta streamed
    parser.parse({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "turn1" },
      },
    });
    parser.parse({ type: "result", result: "turn1" });
    // Turn 2: no deltas, assistant block only
    const events = parser.parse({
      type: "assistant",
      message: { content: [{ type: "text", text: "turn2" }] },
    });
    const textEvents = events.filter((evt) => evt.type === EVENT_TYPES.text);
    assert.equal(textEvents.length, 1);
    assert.equal(textEvents[0].message, "turn2");
  });
});

describe("createStreamParser — ignores non-text stream_events", () => {
  it("returns empty for message_start", () => {
    const parser = createStreamParser();
    const events = parser.parse({
      type: "stream_event",
      event: { type: "message_start" },
    } as RawStreamEvent);
    assert.equal(events.length, 0);
  });

  it("returns empty for content_block_start", () => {
    const parser = createStreamParser();
    const events = parser.parse({
      type: "stream_event",
      event: { type: "content_block_start" },
    } as RawStreamEvent);
    assert.equal(events.length, 0);
  });
});
