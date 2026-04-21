import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { blockToEvent, parseStreamEvent, type ClaudeContentBlock, type RawStreamEvent } from "../../server/agent/stream.js";

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
            name: "manageTodoList",
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
      toolName: "manageTodoList",
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
});
