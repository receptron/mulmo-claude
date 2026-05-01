// Unit tests for the pairing helper that lets SessionSidebar render
// `toolName(action)` labels. See src/utils/agent/resultCallArgs.ts.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeToolName, pairResultsWithCallArgs, pickCallArgLabel } from "../../../src/utils/agent/resultCallArgs.js";
import type { ToolCallHistoryItem } from "../../../src/types/toolCallHistory.js";
import type { ToolResultComplete } from "gui-chat-protocol/vue";

function makeResult(uuid: string, toolName: string): ToolResultComplete {
  return { uuid, toolName, message: "" };
}

let nextCallId = 0;
function makeCall(toolName: string, args: unknown, toolUseId = `${toolName}-${++nextCallId}`): ToolCallHistoryItem {
  return { toolUseId, toolName, args, timestamp: 0 };
}

describe("pairResultsWithCallArgs", () => {
  it("returns an empty map when both inputs are empty", () => {
    assert.deepEqual(pairResultsWithCallArgs([], []), new Map());
  });

  it("pairs a single result with its single call", () => {
    const results = [makeResult("u1", "manageAccounting")];
    const history = [makeCall("manageAccounting", { action: "openApp" })];
    const map = pairResultsWithCallArgs(results, history);
    assert.deepEqual(map.get("u1"), { action: "openApp" });
  });

  it("pairs multiple same-name calls in order", () => {
    const results = [makeResult("u1", "manageAccounting"), makeResult("u2", "manageAccounting"), makeResult("u3", "manageAccounting")];
    const history = [
      makeCall("manageAccounting", { action: "openApp" }),
      makeCall("manageAccounting", { action: "addEntry" }),
      makeCall("manageAccounting", { action: "getReport" }),
    ];
    const map = pairResultsWithCallArgs(results, history);
    assert.deepEqual(map.get("u1"), { action: "openApp" });
    assert.deepEqual(map.get("u2"), { action: "addEntry" });
    assert.deepEqual(map.get("u3"), { action: "getReport" });
  });

  it("interleaves two tool names without crossing them", () => {
    const results = [makeResult("u1", "manageAccounting"), makeResult("u2", "manageWiki"), makeResult("u3", "manageAccounting")];
    const history = [
      makeCall("manageAccounting", { action: "openApp" }),
      makeCall("manageWiki", { action: "index" }),
      makeCall("manageAccounting", { action: "getReport" }),
    ];
    const map = pairResultsWithCallArgs(results, history);
    assert.deepEqual(map.get("u1"), { action: "openApp" });
    assert.deepEqual(map.get("u2"), { action: "index" });
    assert.deepEqual(map.get("u3"), { action: "getReport" });
  });

  it("omits results that have no matching call", () => {
    const results = [makeResult("u1", "manageAccounting")];
    const history: ToolCallHistoryItem[] = [];
    const map = pairResultsWithCallArgs(results, history);
    assert.equal(map.has("u1"), false);
  });

  it("ignores history entries that have no matching result", () => {
    const results = [makeResult("u1", "manageAccounting")];
    const history = [makeCall("manageAccounting", { action: "first" }), makeCall("manageAccounting", { action: "second" })];
    const map = pairResultsWithCallArgs(results, history);
    assert.deepEqual(map.get("u1"), { action: "first" });
    assert.equal(map.size, 1);
  });

  it("matches MCP-namespaced call names against bare result names", () => {
    const results = [makeResult("u1", "manageAccounting")];
    const history = [makeCall("mcp__mulmoclaude__manageAccounting", { action: "openApp" })];
    const map = pairResultsWithCallArgs(results, history);
    assert.deepEqual(map.get("u1"), { action: "openApp" });
  });
});

describe("normalizeToolName", () => {
  it("strips an mcp__<server>__ prefix", () => {
    assert.equal(normalizeToolName("mcp__mulmoclaude__manageAccounting"), "manageAccounting");
  });

  it("returns the input unchanged when no prefix is present", () => {
    assert.equal(normalizeToolName("manageAccounting"), "manageAccounting");
  });

  it("returns the input unchanged when the second separator is missing", () => {
    assert.equal(normalizeToolName("mcp__broken"), "mcp__broken");
  });
});

describe("pickCallArgLabel", () => {
  it("returns null when args is not an object", () => {
    assert.equal(pickCallArgLabel(null), null);
    assert.equal(pickCallArgLabel(undefined), null);
    assert.equal(pickCallArgLabel("openApp"), null);
  });

  it("prefers the action arg when present", () => {
    assert.equal(pickCallArgLabel({ action: "openApp", title: "Books" }), "openApp");
  });

  it("falls back to the first string-valued arg when action is missing", () => {
    assert.equal(pickCallArgLabel({ slug: "home", count: 3 }), "home");
  });

  it("skips empty string action and keeps searching", () => {
    assert.equal(pickCallArgLabel({ action: "", slug: "home" }), "home");
  });

  it("returns null when no string-valued args exist", () => {
    assert.equal(pickCallArgLabel({ count: 3, enabled: true }), null);
  });
});
