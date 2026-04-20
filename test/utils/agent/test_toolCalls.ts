// Unit tests for the pure helpers extracted from
// `src/App.vue#sendMessage` around tool-call-history management
// and text-result selection heuristics. See
// plans/done/refactor-vue-cognitive-complexity.md and issue #175.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findPendingToolCall,
  shouldSelectAssistantText,
} from "../../../src/utils/agent/toolCalls.js";
import type { ToolCallHistoryItem } from "../../../src/types/toolCallHistory.js";
import type { ToolResultComplete } from "gui-chat-protocol/vue";

function makeHistoryEntry(
  toolUseId: string,
  overrides: Partial<ToolCallHistoryItem> = {},
): ToolCallHistoryItem {
  return {
    toolUseId,
    toolName: "test",
    args: {},
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("findPendingToolCall — basic matching", () => {
  it("returns undefined for empty history", () => {
    assert.equal(findPendingToolCall([], "any"), undefined);
  });

  it("returns undefined when no entry matches the toolUseId", () => {
    const history = [makeHistoryEntry("id-1"), makeHistoryEntry("id-2")];
    assert.equal(findPendingToolCall(history, "id-3"), undefined);
  });

  it("returns the pending entry when toolUseId matches", () => {
    const entry = makeHistoryEntry("id-1");
    const result = findPendingToolCall([entry], "id-1");
    assert.equal(result, entry);
  });
});

describe("findPendingToolCall — pending vs resolved", () => {
  it("skips entries that already have a result", () => {
    const history = [makeHistoryEntry("id-1", { result: "already done" })];
    assert.equal(findPendingToolCall(history, "id-1"), undefined);
  });

  it("skips entries that already have an error", () => {
    const history = [makeHistoryEntry("id-1", { error: "already failed" })];
    assert.equal(findPendingToolCall(history, "id-1"), undefined);
  });

  it("distinguishes pending from resolved at the same toolUseId", () => {
    // Race / retry scenario: two calls with the same id, one done
    // and one still pending. Should find the pending one.
    const pending = makeHistoryEntry("id-1");
    const history = [makeHistoryEntry("id-1", { result: "old" }), pending];
    const result = findPendingToolCall(history, "id-1");
    assert.equal(result, pending);
  });
});

describe("findPendingToolCall — reverse-scan semantics", () => {
  it("returns the NEWEST pending match (reverse scan)", () => {
    // Two pending entries with the same toolUseId. The later
    // entry in the array is more recent and should win — this
    // mirrors LIFO ordering on the server side.
    const newer = makeHistoryEntry("id-1", { timestamp: 100 });
    const older = makeHistoryEntry("id-1", { timestamp: 50 });
    const result = findPendingToolCall([older, newer], "id-1");
    assert.equal(result, newer);
  });

  it("returns the pending match among a mix of ids and states", () => {
    const target = makeHistoryEntry("id-2");
    const history = [
      makeHistoryEntry("id-1"),
      makeHistoryEntry("id-2", { result: "done" }),
      makeHistoryEntry("id-1", { result: "done" }),
      target,
      makeHistoryEntry("id-3"),
    ];
    const result = findPendingToolCall(history, "id-2");
    assert.equal(result, target);
  });
});

// --- shouldSelectAssistantText ------------------------------------

function makeToolResult(uuid: string, toolName: string): ToolResultComplete {
  // Minimal shape — only `uuid` and `toolName` matter for this helper.
  return { uuid, toolName } as ToolResultComplete;
}

describe("shouldSelectAssistantText — returns true when run is text-only", () => {
  it("true for empty run tail (fresh run, nothing pushed yet)", () => {
    assert.equal(shouldSelectAssistantText([], 0), true);
  });

  it("true when every result in the run is text-response", () => {
    const results = [
      makeToolResult("u1", "text-response"),
      makeToolResult("u2", "text-response"),
    ];
    assert.equal(shouldSelectAssistantText(results, 0), true);
  });

  it("true when plugin results exist but predate the run (ignored)", () => {
    // Two text-response results after runStartIndex, a plugin
    // result before it — the pre-run result is irrelevant.
    const results = [
      makeToolResult("prev", "generateImage"),
      makeToolResult("u1", "text-response"),
    ];
    assert.equal(shouldSelectAssistantText(results, 1), true);
  });
});

describe("shouldSelectAssistantText — returns false when a plugin result is in the run", () => {
  it("false when a single plugin result is the only entry", () => {
    const results = [makeToolResult("u1", "generateImage")];
    assert.equal(shouldSelectAssistantText(results, 0), false);
  });

  it("false when a plugin result comes after a text-response", () => {
    const results = [
      makeToolResult("u1", "text-response"),
      makeToolResult("u2", "generateImage"),
    ];
    assert.equal(shouldSelectAssistantText(results, 0), false);
  });

  it("false when a plugin result comes before a text-response", () => {
    const results = [
      makeToolResult("u1", "generateImage"),
      makeToolResult("u2", "text-response"),
    ];
    assert.equal(shouldSelectAssistantText(results, 0), false);
  });
});

describe("shouldSelectAssistantText — boundary conditions", () => {
  it("runStartIndex at end of array → true (nothing to inspect)", () => {
    const results = [makeToolResult("prev", "generateImage")];
    assert.equal(shouldSelectAssistantText(results, results.length), true);
  });

  it("runStartIndex past end → true (defensive, shouldn't happen)", () => {
    const results = [makeToolResult("prev", "generateImage")];
    assert.equal(shouldSelectAssistantText(results, 99), true);
  });
});

describe("shouldSelectAssistantText — multi-turn regression (#stale-runStartIndex)", () => {
  it("turn 2 with a plugin result in turn 1 → true for text-only turn 2", () => {
    // Simulates the two-turn bug:
    //   Turn 1 (runStart=1): user asks a question that triggers a
    //   plugin; LLM also emits text. Plugin result lands.
    //   Turn 2 (runStart=4): user sends a text-only follow-up; LLM
    //   replies with text only.
    // Before the fix, the subscription closed over turn 1's
    // runStartIndex (=1) forever — so on turn 2 the scan still saw
    // the turn-1 plugin result and returned false. With the fix,
    // runStartIndex lives on the session and is refreshed per turn;
    // the turn-2 scan starts at index 4 and sees only the two
    // text-responses, returning true.
    const results = [
      makeToolResult("u1-user", "text-response"),
      makeToolResult("u1-plugin", "generateImage"),
      makeToolResult("u1-text", "text-response"),
      makeToolResult("u2-user", "text-response"),
      makeToolResult("u2-text", "text-response"),
    ];
    // Stale index (turn 1's) — demonstrates the bug.
    assert.equal(shouldSelectAssistantText(results, 1), false);
    // Fresh per-turn index — the fix.
    assert.equal(shouldSelectAssistantText(results, 4), true);
  });
});
