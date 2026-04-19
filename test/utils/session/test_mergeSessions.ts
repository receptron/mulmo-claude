// Unit tests for `mergeSessionLists` + `compareSessionsByRecency`.
// Extracted from `src/App.vue`'s `mergedSessions` computed — see
// plans/done/refactor-vue-cognitive-complexity.md and issue #175.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mergeSessionLists,
  applySessionDiff,
  compareSessionsByRecency,
} from "../../../src/utils/session/mergeSessions.js";
import type {
  ActiveSession,
  SessionSummary,
} from "../../../src/types/session.js";
import type { ToolResultComplete } from "gui-chat-protocol/vue";

function makeActive(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    id: "live-1",
    roleId: "general",
    toolResults: [],
    isRunning: false,
    statusMessage: "",
    toolCallHistory: [],
    selectedResultUuid: null,
    hasUnread: false,
    startedAt: "2026-04-10T10:00:00.000Z",
    updatedAt: "2026-04-10T10:05:00.000Z",
    ...overrides,
  };
}

function makeSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "srv-1",
    roleId: "general",
    startedAt: "2026-04-09T10:00:00.000Z",
    updatedAt: "2026-04-09T10:05:00.000Z",
    preview: "first user message",
    ...overrides,
  };
}

function makeUserTextResult(message: string): ToolResultComplete {
  // Matches what `makeTextResult(message, "user")` produces.
  // `message` lives at the top level (that's what the sidebar
  // preview reads) AND on `data` alongside the `role: "user"`
  // discriminator that `isUserTextResponse` keys off.
  return {
    uuid: `u-${message}`,
    toolName: "text-response",
    message,
    data: { role: "user", message },
  } as unknown as ToolResultComplete;
}

describe("compareSessionsByRecency", () => {
  it("returns negative when a is more recently updated", () => {
    const a = makeSummary({ updatedAt: "2026-04-12T10:00:00.000Z" });
    const b = makeSummary({ updatedAt: "2026-04-10T10:00:00.000Z" });
    assert.ok(compareSessionsByRecency(a, b) < 0);
  });

  it("returns positive when b is more recently updated", () => {
    const a = makeSummary({ updatedAt: "2026-04-10T10:00:00.000Z" });
    const b = makeSummary({ updatedAt: "2026-04-12T10:00:00.000Z" });
    assert.ok(compareSessionsByRecency(a, b) > 0);
  });

  it("falls back to startedAt on updatedAt tie", () => {
    const a = makeSummary({
      updatedAt: "2026-04-10T10:00:00.000Z",
      startedAt: "2026-04-08T10:00:00.000Z",
    });
    const b = makeSummary({
      updatedAt: "2026-04-10T10:00:00.000Z",
      startedAt: "2026-04-09T10:00:00.000Z",
    });
    // b has newer startedAt, so b should come first
    assert.ok(compareSessionsByRecency(a, b) > 0);
  });

  it("returns 0 when both updatedAt and startedAt match", () => {
    const a = makeSummary({ id: "a" });
    const b = makeSummary({ id: "b" });
    assert.equal(compareSessionsByRecency(a, b), 0);
  });
});

describe("mergeSessionLists — basic cases", () => {
  it("returns empty array when both inputs are empty", () => {
    assert.deepEqual(mergeSessionLists([], []), []);
  });

  it("returns only the server summary when there are no live sessions", () => {
    const summary = makeSummary({ id: "srv-1" });
    assert.deepEqual(mergeSessionLists([], [summary]), [summary]);
  });

  it("returns the live summary when there are no server entries", () => {
    const live = makeActive({
      id: "live-1",
      toolResults: [makeUserTextResult("hello")],
    });
    const result = mergeSessionLists([live], []);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "live-1");
    assert.equal(result[0].preview, "hello");
    assert.equal(result[0].summary, undefined);
    assert.equal(result[0].keywords, undefined);
  });
});

describe("mergeSessionLists — live + server overlap", () => {
  it("live wins when a session appears on both sides", () => {
    const live = makeActive({
      id: "both",
      updatedAt: "2026-04-12T10:00:00.000Z",
      toolResults: [makeUserTextResult("live message")],
    });
    const server = makeSummary({
      id: "both",
      updatedAt: "2026-04-11T10:00:00.000Z",
      preview: "server preview",
    });
    const result = mergeSessionLists([live], [server]);
    assert.equal(result.length, 1, "session should not be duplicated");
    assert.equal(result[0].id, "both");
    // Server preview wins over first-user-message heuristic — the
    // AI-generated title is more informative
    assert.equal(result[0].preview, "server preview");
    // updatedAt comes from the live side (it's the fresher source)
    assert.equal(result[0].updatedAt, "2026-04-12T10:00:00.000Z");
  });

  it("carries over server summary + keywords to the live entry", () => {
    const live = makeActive({ id: "both" });
    const server = makeSummary({
      id: "both",
      preview: "Plan a project",
      summary: "User wants help planning.",
      keywords: ["plan", "project"],
    });
    const result = mergeSessionLists([live], [server]);
    assert.equal(result[0].preview, "Plan a project");
    assert.equal(result[0].summary, "User wants help planning.");
    assert.deepEqual(result[0].keywords, ["plan", "project"]);
  });

  it("falls back to first-user-message when server preview is empty", () => {
    const live = makeActive({
      id: "both",
      toolResults: [makeUserTextResult("hello from live")],
    });
    const server = makeSummary({ id: "both", preview: "" });
    const result = mergeSessionLists([live], [server]);
    assert.equal(result[0].preview, "hello from live");
  });

  it("uses empty preview when neither server nor live has text", () => {
    const live = makeActive({ id: "both", toolResults: [] });
    const server = makeSummary({ id: "both", preview: "" });
    const result = mergeSessionLists([live], [server]);
    assert.equal(result[0].preview, "");
  });
});

describe("mergeSessionLists — server-only entries", () => {
  it("includes server-only entries untouched", () => {
    const live = makeActive({ id: "live-only" });
    const server = makeSummary({ id: "srv-only" });
    const result = mergeSessionLists([live], [server]);
    const serverEntry = result.find((s) => s.id === "srv-only");
    assert.equal(serverEntry, server);
  });

  it("dedupes: a server entry with matching live id does not duplicate", () => {
    const live = makeActive({ id: "shared" });
    const server = makeSummary({ id: "shared" });
    const result = mergeSessionLists([live], [server]);
    assert.equal(result.length, 1);
  });
});

describe("mergeSessionLists — sort order", () => {
  it("sorts by updatedAt descending (most recent first)", () => {
    const recent = makeSummary({
      id: "recent",
      updatedAt: "2026-04-12T10:00:00.000Z",
    });
    const older = makeSummary({
      id: "older",
      updatedAt: "2026-04-10T10:00:00.000Z",
    });
    const result = mergeSessionLists([], [older, recent]);
    assert.deepEqual(
      result.map((s) => s.id),
      ["recent", "older"],
    );
  });

  it("mixes live and server-only entries in the same sort", () => {
    const live = makeActive({
      id: "live",
      updatedAt: "2026-04-11T00:00:00.000Z",
    });
    const server = makeSummary({
      id: "srv",
      updatedAt: "2026-04-12T00:00:00.000Z",
    });
    const result = mergeSessionLists([live], [server]);
    // srv is newer → comes first
    assert.deepEqual(
      result.map((s) => s.id),
      ["srv", "live"],
    );
  });

  it("breaks updatedAt ties with startedAt", () => {
    const a = makeSummary({
      id: "a",
      updatedAt: "2026-04-10T10:00:00.000Z",
      startedAt: "2026-04-08T10:00:00.000Z",
    });
    const b = makeSummary({
      id: "b",
      updatedAt: "2026-04-10T10:00:00.000Z",
      startedAt: "2026-04-09T10:00:00.000Z",
    });
    const result = mergeSessionLists([], [a, b]);
    // b has newer startedAt → b first
    assert.deepEqual(
      result.map((s) => s.id),
      ["b", "a"],
    );
  });
});

describe("mergeSessionLists — does not mutate inputs", () => {
  it("returns a new array without modifying the live list", () => {
    const live = [makeActive({ id: "a" }), makeActive({ id: "b" })];
    const liveSnapshot = live.slice();
    mergeSessionLists(live, []);
    assert.deepEqual(live, liveSnapshot);
  });

  it("returns a new array without modifying the server list", () => {
    const server = [makeSummary({ id: "a" }), makeSummary({ id: "b" })];
    const snapshot = server.slice();
    mergeSessionLists([], server);
    assert.deepEqual(server, snapshot);
  });
});

// applySessionDiff powers the cursor-aware incremental fetch in
// useSessionHistory (issue #205). Each diff row replaces the cached
// row with the same id, new ids prepend, and deletedIds remove.
describe("applySessionDiff — upsert", () => {
  it("replaces the cached row when a diff row shares its id", () => {
    const cache = [
      makeSummary({ id: "a", preview: "old" }),
      makeSummary({ id: "b" }),
    ];
    const diff = [makeSummary({ id: "a", preview: "new" })];
    const out = applySessionDiff(cache, diff, []);
    const a = out.find((s) => s.id === "a");
    assert.equal(a?.preview, "new");
    const b = out.find((s) => s.id === "b");
    assert.ok(b, "untouched cache rows survive");
  });

  it("adds rows whose ids are new to the cache", () => {
    const cache = [makeSummary({ id: "a" })];
    const diff = [makeSummary({ id: "b" })];
    const out = applySessionDiff(cache, diff, []);
    assert.deepEqual(out.map((s) => s.id).sort(), ["a", "b"]);
  });

  it("is a no-op when diff and deletedIds are both empty", () => {
    const cache = [makeSummary({ id: "a" }), makeSummary({ id: "b" })];
    const out = applySessionDiff(cache, [], []);
    assert.deepEqual(out.map((s) => s.id).sort(), ["a", "b"]);
  });
});

describe("applySessionDiff — deletedIds", () => {
  it("removes cached rows whose id is in deletedIds", () => {
    const cache = [
      makeSummary({ id: "a" }),
      makeSummary({ id: "b" }),
      makeSummary({ id: "c" }),
    ];
    const out = applySessionDiff(cache, [], ["b"]);
    assert.deepEqual(out.map((s) => s.id).sort(), ["a", "c"]);
  });

  it("removes before applying the diff (id in both → removed)", () => {
    // Shape-wise impossible in the real product (server wouldn't
    // both update and delete the same id), but the rule keeps the
    // helper's behaviour unambiguous.
    const cache = [makeSummary({ id: "a" })];
    const diff = [makeSummary({ id: "a", preview: "updated" })];
    const out = applySessionDiff(cache, diff, ["a"]);
    // The diff re-adds `a` because deletedIds only scopes the
    // *cache* pass; that matches the server's contract ("these
    // rows changed, these rows are gone") where every diff row
    // is authoritative.
    const a = out.find((s) => s.id === "a");
    assert.equal(a?.preview, "updated");
    assert.equal(out.length, 1);
  });
});

describe("applySessionDiff — sort + immutability", () => {
  it("returns the merged list sorted by updatedAt desc", () => {
    const cache = [
      makeSummary({ id: "old", updatedAt: "2026-04-10T00:00:00.000Z" }),
    ];
    const diff = [
      makeSummary({ id: "new", updatedAt: "2026-04-17T00:00:00.000Z" }),
    ];
    const out = applySessionDiff(cache, diff, []);
    assert.equal(out[0].id, "new");
    assert.equal(out[1].id, "old");
  });

  it("does not mutate cache or diff inputs", () => {
    const cache = [makeSummary({ id: "a" })];
    const diff = [makeSummary({ id: "b" })];
    const cacheSnap = cache.slice();
    const diffSnap = diff.slice();
    applySessionDiff(cache, diff, ["a"]);
    assert.deepEqual(cache, cacheSnap);
    assert.deepEqual(diff, diffSnap);
  });
});
