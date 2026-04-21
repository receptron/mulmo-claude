import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isCallStillPending, PENDING_MIN_MS } from "../../../src/utils/tools/pendingCalls.js";
import type { ToolCallHistoryItem } from "../../../src/types/toolCallHistory";

function call(over: Partial<ToolCallHistoryItem>): ToolCallHistoryItem {
  return {
    toolUseId: "u",
    toolName: "t",
    args: {},
    timestamp: 1_000_000,
    ...over,
  };
}

describe("isCallStillPending", () => {
  it("is true when neither result nor error is set", () => {
    const toolCall = call({ timestamp: 1000 });
    assert.equal(isCallStillPending(toolCall, 9999999), true);
  });

  it("is true when result has just landed (within the min window)", () => {
    const toolCall = call({ timestamp: 1000, result: "done" });
    assert.equal(isCallStillPending(toolCall, 1000 + PENDING_MIN_MS - 1), true);
  });

  it("is false when result landed and the min window has elapsed", () => {
    const toolCall = call({ timestamp: 1000, result: "done" });
    assert.equal(isCallStillPending(toolCall, 1000 + PENDING_MIN_MS + 1), false);
  });

  it("is false at the exact PENDING_MIN_MS boundary", () => {
    const toolCall = call({ timestamp: 1000, result: "done" });
    assert.equal(isCallStillPending(toolCall, 1000 + PENDING_MIN_MS), false);
  });

  it("is true when error landed within the min window", () => {
    const toolCall = call({ timestamp: 1000, error: "boom" });
    assert.equal(isCallStillPending(toolCall, 1100), true);
  });

  it("is false when error landed and the min window has elapsed", () => {
    const toolCall = call({ timestamp: 1000, error: "boom" });
    assert.equal(isCallStillPending(toolCall, 1000 + PENDING_MIN_MS + 100), false);
  });

  it("treats a result of empty string as resolved (not still pending)", () => {
    const toolCall = call({ timestamp: 1000, result: "" });
    assert.equal(isCallStillPending(toolCall, 1000 + PENDING_MIN_MS + 1), false);
  });

  it("PENDING_MIN_MS is exposed as a positive constant", () => {
    assert.ok(PENDING_MIN_MS > 0);
  });
});
