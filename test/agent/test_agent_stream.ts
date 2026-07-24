import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { blockToEvent, createStreamParser, parseStreamEvent, type ClaudeContentBlock, type RawStreamEvent } from "../../server/agent/stream.js";
import { EVENT_TYPES } from "../../src/types/events.js";

// `content` is declared as an array, so a payload that reaches the
// `Array.isArray` guard's false branch — the CLI is a separate process
// and can send anything — has to be built from JSON.
const rawEventFromJson = (json: string): RawStreamEvent => JSON.parse(json);

describe("blockToEvent", () => {
  it("converts tool_use block to tool_call event", () => {
    const block: ClaudeContentBlock = {
      type: "tool_use",
      id: "tu_1",
      name: "myTool",
      input: { a: 1 },
    };
    assert.deepEqual(blockToEvent(block), {
      type: "tool_call",
      toolUseId: "tu_1",
      toolName: "myTool",
      args: { a: 1 },
    });
  });

  it("converts tool_result block to tool_call_result event", () => {
    const block: ClaudeContentBlock = {
      type: "tool_result",
      tool_use_id: "tu_2",
      content: "ok",
    };
    assert.deepEqual(blockToEvent(block), {
      type: "tool_call_result",
      toolUseId: "tu_2",
      content: "ok",
    });
  });

  it("stringifies non-string content in tool_result", () => {
    const block: ClaudeContentBlock = {
      type: "tool_result",
      tool_use_id: "tu_3",
      content: [1, 2],
    };
    assert.deepEqual(blockToEvent(block), {
      type: "tool_call_result",
      toolUseId: "tu_3",
      content: "[1,2]",
    });
  });

  it("returns null for tool_use missing id", () => {
    assert.equal(blockToEvent({ type: "tool_use", name: "x" }), null);
  });

  it("returns null for tool_use missing name", () => {
    assert.equal(blockToEvent({ type: "tool_use", id: "x" }), null);
  });

  it("returns null for tool_result missing tool_use_id", () => {
    assert.equal(blockToEvent({ type: "tool_result", content: "x" }), null);
  });

  it("returns empty string for tool_result with undefined content", () => {
    const block: ClaudeContentBlock = {
      type: "tool_result",
      tool_use_id: "tu_4",
    };
    assert.deepEqual(blockToEvent(block), {
      type: "tool_call_result",
      toolUseId: "tu_4",
      content: "",
    });
  });

  it("returns null for unknown block type", () => {
    assert.equal(blockToEvent({ type: "text" }), null);
  });
});

describe("parseStreamEvent", () => {
  it("returns status for assistant event", () => {
    const event: RawStreamEvent = {
      type: "assistant",
      message: { content: [] },
    };
    const result = parseStreamEvent(event);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0], { type: "status", message: "Thinking..." });
  });

  it("extracts tool_call from assistant with tool_use blocks", () => {
    const event: RawStreamEvent = {
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "tu_123",
            name: "manageBookmarks",
            input: { action: "show" },
          },
        ],
      },
    };
    const result = parseStreamEvent(event);
    assert.equal(result.length, 2);
    assert.deepEqual(result[0], { type: "status", message: "Thinking..." });
    assert.deepEqual(result[1], {
      type: "tool_call",
      toolUseId: "tu_123",
      toolName: "manageBookmarks",
      args: { action: "show" },
    });
  });

  it("skips tool_use blocks missing id or name", () => {
    const event: RawStreamEvent = {
      type: "assistant",
      message: {
        content: [
          { type: "tool_use" }, // missing id and name
          { type: "tool_use", id: "tu_1" }, // missing name
          { type: "tool_use", name: "foo" }, // missing id
        ],
      },
    };
    const result = parseStreamEvent(event);
    assert.equal(result.length, 1); // only the status event
  });

  it("extracts tool_call_result from user event", () => {
    const event: RawStreamEvent = {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu_456",
            content: "Items listed",
          },
        ],
      },
    };
    const result = parseStreamEvent(event);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0], {
      type: "tool_call_result",
      toolUseId: "tu_456",
      content: "Items listed",
    });
  });

  it("stringifies non-string tool_result content", () => {
    const event: RawStreamEvent = {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu_789",
            content: { key: "value" },
          },
        ],
      },
    };
    const result = parseStreamEvent(event);
    assert.equal(result.length, 1);
    assert.equal(result[0].type, "tool_call_result");
    if (result[0].type === "tool_call_result") {
      assert.equal(result[0].content, '{"key":"value"}');
    }
  });

  it("skips tool_result blocks without tool_use_id", () => {
    const event: RawStreamEvent = {
      type: "user",
      message: {
        content: [{ type: "tool_result", content: "orphan" }],
      },
    };
    const result = parseStreamEvent(event);
    assert.equal(result.length, 0);
  });

  it("returns text and session_id for result event", () => {
    const event: RawStreamEvent = {
      type: "result",
      result: "Here is your answer",
      session_id: "sess_abc",
    };
    const result = parseStreamEvent(event);
    assert.equal(result.length, 2);
    assert.deepEqual(result[0], {
      type: "text",
      message: "Here is your answer",
    });
    assert.deepEqual(result[1], {
      type: "claude_session_id",
      id: "sess_abc",
    });
  });

  it("returns only text for result without session_id", () => {
    const event: RawStreamEvent = {
      type: "result",
      result: "Done",
    };
    const result = parseStreamEvent(event);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0], { type: "text", message: "Done" });
  });

  it("returns empty for user event with no content", () => {
    const event: RawStreamEvent = {
      type: "user",
      message: {},
    };
    const result = parseStreamEvent(event);
    assert.equal(result.length, 0);
  });

  it("returns empty for unknown event types (e.g. system)", () => {
    const event: RawStreamEvent = { type: "system" };
    const result = parseStreamEvent(event);
    assert.equal(result.length, 0);
  });

  it("keeps recognised blocks and drops the rest for an assistant event mixing block types", () => {
    const event: RawStreamEvent = {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "checking" },
          { type: "tool_use", id: "tu_mix", name: "Bash", input: { command: "ls" } },
          { type: "tool_result", tool_use_id: "tu_mix", content: "ok", is_error: true },
          { type: "thinking" },
        ],
      },
    };
    assert.deepEqual(parseStreamEvent(event), [
      { type: EVENT_TYPES.status, message: "Thinking..." },
      { type: EVENT_TYPES.text, message: "checking" },
      { type: EVENT_TYPES.toolCall, toolUseId: "tu_mix", toolName: "Bash", args: { command: "ls" } },
      { type: EVENT_TYPES.toolCallResult, toolUseId: "tu_mix", content: "ok", isError: true },
    ]);
  });

  it("returns only the status for an assistant event whose content is not an array", () => {
    assert.deepEqual(parseStreamEvent(rawEventFromJson('{"type":"assistant","message":{"content":"not-an-array"}}')), [
      { type: EVENT_TYPES.status, message: "Thinking..." },
    ]);
  });

  it("returns empty for a user event whose content is not an array", () => {
    assert.deepEqual(parseStreamEvent(rawEventFromJson('{"type":"user","message":{"content":"not-an-array"}}')), []);
  });

  it("returns empty for a user event with no message at all", () => {
    assert.deepEqual(parseStreamEvent({ type: "user" }), []);
  });

  // A result event can arrive with empty text (the reply already
  // streamed). The session id rides on that same event, so it must not
  // be gated on the text being present.
  it("returns the session id for a result event carrying no text", () => {
    assert.deepEqual(parseStreamEvent({ type: "result", result: "", session_id: "sess_empty" }), [{ type: EVENT_TYPES.claudeSessionId, id: "sess_empty" }]);
  });

  // stream_event is neither "assistant" nor "user", so a parser that
  // reaches its type guard before extracting the delta swallows the
  // partial-message text entirely.
  it("emits the text of a stream_event delta", () => {
    const event: RawStreamEvent = {
      type: "stream_event",
      event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "chunk" } },
    };
    assert.deepEqual(parseStreamEvent(event), [{ type: EVENT_TYPES.text, message: "chunk" }]);
  });

  it("returns empty for a stream_event that carries no text delta", () => {
    assert.deepEqual(parseStreamEvent({ type: "stream_event", event: { type: "message_start" } }), []);
  });
});

const equivalenceCases: { name: string; event: RawStreamEvent }[] = [
  { name: "a result event with a session id", event: { type: "result", result: "answer", session_id: "sess_eq" } },
  { name: "a result event without a session id", event: { type: "result", result: "answer" } },
  { name: "a result event with no text but a session id", event: { type: "result", result: "", session_id: "sess_eq" } },
  { name: "an unrecognised event type", event: { type: "system" } },
  {
    name: "an assistant event mixing block types",
    event: {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "checking" },
          { type: "tool_use", id: "tu_eq", name: "Bash", input: { command: "ls" } },
          { type: "tool_result", tool_use_id: "tu_eq", content: "ok" },
          { type: "thinking" },
        ],
      },
    },
  },
  { name: "an assistant event with an empty content array", event: { type: "assistant", message: { content: [] } } },
  { name: "a user event", event: { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu_eq", content: "ok" }] } } },
  { name: "a user event with content absent", event: { type: "user", message: {} } },
  { name: "a user event with content that is not an array", event: rawEventFromJson('{"type":"user","message":{"content":"not-an-array"}}') },
  {
    name: "a stream_event text delta",
    event: { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "chunk" } } },
  },
];

// Tautological while parseStreamEvent delegates — which is the point:
// it turns red the moment someone re-forks the body into a second
// implementation that these tests would vouch for instead of the
// parser the agent loop actually runs.
describe("parseStreamEvent matches a fresh createStreamParser().parse", () => {
  equivalenceCases.forEach(({ name, event }) => {
    it(`agrees on ${name}`, () => {
      assert.deepEqual(parseStreamEvent(event), createStreamParser().parse(event));
    });
  });
});

// filterAssistantBlocks(blocks, false) is the identity, which is the
// only reason a per-event parser may stand in for the stateful one.
// Both sides are pinned here: dropping the deltaStreamed guard, or
// making the filter depend on the blocks themselves, breaks a case
// below instead of silently changing what reaches the client.
describe("filterAssistantBlocks divergence between the stateless and stateful paths", () => {
  const assistantWithText: RawStreamEvent = {
    type: "assistant",
    message: { content: [{ type: "text", text: "streamed" }] },
  };
  const textDelta: RawStreamEvent = {
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "streamed" } },
  };

  it("keeps the assistant text block when no delta preceded it", () => {
    assert.deepEqual(parseStreamEvent(assistantWithText), [
      { type: EVENT_TYPES.status, message: "Thinking..." },
      { type: EVENT_TYPES.text, message: "streamed" },
    ]);
  });

  it("drops the assistant text block once the same parser streamed a delta", () => {
    const parser = createStreamParser();
    parser.parse(textDelta);
    assert.deepEqual(parser.parse(assistantWithText), [{ type: EVENT_TYPES.status, message: "Thinking..." }]);
  });

  it("never filters via parseStreamEvent, because each call gets an unstreamed parser", () => {
    parseStreamEvent(textDelta);
    assert.deepEqual(parseStreamEvent(assistantWithText), [
      { type: EVENT_TYPES.status, message: "Thinking..." },
      { type: EVENT_TYPES.text, message: "streamed" },
    ]);
  });
});
