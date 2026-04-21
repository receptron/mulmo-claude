// Unit tests for the pure helpers extracted from
// `src/App.vue#loadSession`. Tracks #175.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSessionEntries, resolveSelectedUuid, resolveSessionTimestamps } from "../../../src/utils/session/sessionEntries.js";
import type { SessionEntry, SessionSummary } from "../../../src/types/session.js";
import type { ToolResultComplete } from "gui-chat-protocol/vue";

// --- parseSessionEntries ------------------------------------------

describe("parseSessionEntries", () => {
  it("returns empty array for empty input", () => {
    assert.deepEqual(parseSessionEntries([]), []);
  });

  it("skips session_meta entries", () => {
    const entries: SessionEntry[] = [
      {
        type: "session_meta",
        roleId: "general",
      } as SessionEntry,
    ];
    assert.deepEqual(parseSessionEntries(entries), []);
  });

  it("converts user text entries into tool-result envelopes", () => {
    const entries: SessionEntry[] = [
      {
        source: "user",
        type: "text",
        message: "hello",
      },
    ];
    const out = parseSessionEntries(entries);
    assert.equal(out.length, 1);
    assert.equal(out[0].toolName, "text-response");
  });

  it("converts assistant text entries", () => {
    const entries: SessionEntry[] = [
      {
        source: "assistant",
        type: "text",
        message: "ok",
      },
    ];
    const out = parseSessionEntries(entries);
    assert.equal(out.length, 1);
    assert.equal(out[0].toolName, "text-response");
  });

  it("passes tool_result entries through verbatim", () => {
    const toolResult = {
      uuid: "r1",
      toolName: "generateImage",
    } as unknown as ToolResultComplete;
    const entries: SessionEntry[] = [
      {
        source: "tool",
        type: "tool_result",
        result: toolResult,
      },
    ];
    const out = parseSessionEntries(entries);
    assert.equal(out.length, 1);
    assert.equal(out[0], toolResult);
  });

  it("preserves ordering across a mixed feed", () => {
    const toolResult = {
      uuid: "tool-1",
      toolName: "generateImage",
    } as unknown as ToolResultComplete;
    const entries: SessionEntry[] = [
      { source: "user", type: "text", message: "make an image" },
      { source: "tool", type: "tool_result", result: toolResult },
      { source: "assistant", type: "text", message: "done" },
    ];
    const out = parseSessionEntries(entries);
    assert.equal(out.length, 3);
    assert.equal(out[0].toolName, "text-response");
    assert.equal(out[1], toolResult);
    assert.equal(out[2].toolName, "text-response");
  });

  it("skips entries that are neither text nor tool_result", () => {
    const entries = [{ source: "unknown", type: "unknown-kind", message: "x" }] as unknown as SessionEntry[];
    assert.deepEqual(parseSessionEntries(entries), []);
  });

  it("tolerates session_meta mixed with real entries", () => {
    const entries: SessionEntry[] = [
      {
        type: "session_meta",
        roleId: "general",
      } as SessionEntry,
      { source: "user", type: "text", message: "hi" },
    ];
    const out = parseSessionEntries(entries);
    assert.equal(out.length, 1);
  });
});

// --- resolveSelectedUuid ------------------------------------------

function makeResult(uuid: string, toolName: string): ToolResultComplete {
  return { uuid, toolName } as unknown as ToolResultComplete;
}

describe("resolveSelectedUuid — empty list", () => {
  it("returns null for empty list regardless of urlResult", () => {
    assert.equal(resolveSelectedUuid([], null), null);
    assert.equal(resolveSelectedUuid([], "any"), null);
  });
});

describe("resolveSelectedUuid — URL override", () => {
  it("honours url-specified uuid when it exists in the list", () => {
    const results = [makeResult("a", "text-response"), makeResult("b", "generateImage"), makeResult("c", "text-response")];
    assert.equal(resolveSelectedUuid(results, "a"), "a");
    assert.equal(resolveSelectedUuid(results, "b"), "b");
    assert.equal(resolveSelectedUuid(results, "c"), "c");
  });

  it("ignores url uuid when it doesn't exist in the list", () => {
    const results = [makeResult("a", "generateImage")];
    assert.equal(resolveSelectedUuid(results, "missing"), "a");
  });

  it("ignores url uuid when null", () => {
    const results = [makeResult("a", "generateImage")];
    assert.equal(resolveSelectedUuid(results, null), "a");
  });
});

describe("resolveSelectedUuid — heuristic (last non-text)", () => {
  it("picks the last non-text result when no url override", () => {
    const results = [
      makeResult("text-1", "text-response"),
      makeResult("img-1", "generateImage"),
      makeResult("text-2", "text-response"),
      makeResult("img-2", "generateImage"),
      makeResult("text-3", "text-response"),
    ];
    // The last non-text is img-2
    assert.equal(resolveSelectedUuid(results, null), "img-2");
  });

  it("picks a non-text result even at the end of the list", () => {
    const results = [makeResult("text-1", "text-response"), makeResult("img-1", "generateImage")];
    assert.equal(resolveSelectedUuid(results, null), "img-1");
  });

  it("falls back to the last text result when all results are text", () => {
    const results = [makeResult("text-1", "text-response"), makeResult("text-2", "text-response")];
    assert.equal(resolveSelectedUuid(results, null), "text-2");
  });

  it("returns the only result regardless of type", () => {
    assert.equal(resolveSelectedUuid([makeResult("only", "text-response")], null), "only");
  });
});

// --- resolveSessionTimestamps -------------------------------------

describe("resolveSessionTimestamps", () => {
  const now = "2026-04-13T10:00:00.000Z";

  it("uses server summary timestamps when available", () => {
    const summary = {
      id: "s",
      roleId: "g",
      startedAt: "2026-04-10T10:00:00.000Z",
      updatedAt: "2026-04-11T10:00:00.000Z",
      preview: "",
    } as SessionSummary;
    assert.deepEqual(resolveSessionTimestamps(summary, now), {
      startedAt: "2026-04-10T10:00:00.000Z",
      updatedAt: "2026-04-11T10:00:00.000Z",
    });
  });

  it("falls back to now when summary is undefined", () => {
    assert.deepEqual(resolveSessionTimestamps(undefined, now), {
      startedAt: now,
      updatedAt: now,
    });
  });

  it("falls back updatedAt to startedAt when summary lacks updatedAt", () => {
    // The SessionSummary interface requires updatedAt, but defensive
    // programming: if it's missing at runtime (corrupt persistence),
    // prefer startedAt over the current clock — the session's
    // sidebar position should stay stable rather than jumping to
    // "just updated".
    const summary = {
      id: "s",
      roleId: "g",
      startedAt: "2026-04-10T10:00:00.000Z",
      preview: "",
    } as unknown as SessionSummary;
    assert.deepEqual(resolveSessionTimestamps(summary, now), {
      startedAt: "2026-04-10T10:00:00.000Z",
      updatedAt: "2026-04-10T10:00:00.000Z",
    });
  });

  it("falls back to now when summary lacks both timestamps (pathological)", () => {
    const summary = {
      id: "s",
      roleId: "g",
      preview: "",
    } as unknown as SessionSummary;
    assert.deepEqual(resolveSessionTimestamps(summary, now), {
      startedAt: now,
      updatedAt: now,
    });
  });
});
