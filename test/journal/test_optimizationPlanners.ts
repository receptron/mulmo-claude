import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyRemovedTopics, planMerges, type RawMerge } from "../../server/workspace/journal/optimizationPass.js";
import type { JournalState } from "../../server/workspace/journal/state.js";

describe("planMerges", () => {
  it("returns an empty list when given no merges", () => {
    assert.deepEqual(planMerges([]), []);
  });

  it("slugifies the into and from fields", () => {
    const raw: RawMerge[] = [{ into: "Video Generation", from: ["Old Video Notes"], newContent: "x" }];
    const plans = planMerges(raw);
    assert.equal(plans.length, 1);
    assert.equal(plans[0]?.intoSlug, "video-generation");
    assert.deepEqual(plans[0]?.fromSlugs, ["old-video-notes"]);
  });

  it("preserves newContent verbatim", () => {
    const raw: RawMerge[] = [{ into: "a", from: ["b"], newContent: "# Merged body\n\nstuff" }];
    const plans = planMerges(raw);
    assert.equal(plans[0]?.newContent, "# Merged body\n\nstuff");
  });

  it("drops merges where every from slug equals the into slug", () => {
    const raw: RawMerge[] = [{ into: "Topic A", from: ["Topic-A", "topic a"], newContent: "x" }];
    assert.deepEqual(planMerges(raw), []);
  });

  it("filters self-references but keeps the rest of the merge", () => {
    const raw: RawMerge[] = [
      {
        into: "Topic A",
        from: ["Topic-A", "Topic B", "Topic C"],
        newContent: "x",
      },
    ];
    const plans = planMerges(raw);
    assert.equal(plans.length, 1);
    assert.deepEqual(plans[0]?.fromSlugs, ["topic-b", "topic-c"]);
  });

  it("preserves multiple distinct merges in order", () => {
    const raw: RawMerge[] = [
      { into: "A", from: ["B"], newContent: "ab" },
      { into: "C", from: ["D", "E"], newContent: "cde" },
    ];
    const plans = planMerges(raw);
    assert.equal(plans.length, 2);
    assert.equal(plans[0]?.intoSlug, "a");
    assert.equal(plans[1]?.intoSlug, "c");
    assert.deepEqual(plans[1]?.fromSlugs, ["d", "e"]);
  });
});

describe("applyRemovedTopics", () => {
  function makeState(over: Partial<JournalState> = {}): JournalState {
    return {
      version: 1,
      knownTopics: [],
      lastDailyRunAt: null,
      lastOptimizationRunAt: null,
      dailyIntervalHours: 1,
      optimizationIntervalDays: 7,
      processedSessions: {},
      ...over,
    };
  }

  it("returns a new state object, not the same reference", () => {
    const state = makeState({ knownTopics: ["a"] });
    const next = applyRemovedTopics(state, new Set());
    assert.notEqual(next, state);
  });

  it("filters knownTopics by the removed set", () => {
    const state = makeState({ knownTopics: ["a", "b", "c"] });
    const next = applyRemovedTopics(state, new Set(["b"]));
    assert.deepEqual(next.knownTopics, ["a", "c"]);
  });

  it("removes multiple topics", () => {
    const state = makeState({ knownTopics: ["a", "b", "c", "d"] });
    const next = applyRemovedTopics(state, new Set(["a", "c"]));
    assert.deepEqual(next.knownTopics, ["b", "d"]);
  });

  it("is a no-op when removed set is empty", () => {
    const state = makeState({ knownTopics: ["a", "b"] });
    const next = applyRemovedTopics(state, new Set());
    assert.deepEqual(next.knownTopics, ["a", "b"]);
  });

  it("preserves other state fields", () => {
    const state = makeState({
      knownTopics: ["a"],
      lastDailyRunAt: "2026-04-11T00:00:00Z",
      processedSessions: { sess1: { lastMtimeMs: 1 } },
    });
    const next = applyRemovedTopics(state, new Set(["a"]));
    assert.equal(next.lastDailyRunAt, "2026-04-11T00:00:00Z");
    assert.deepEqual(next.processedSessions, { sess1: { lastMtimeMs: 1 } });
  });

  it("does not mutate the input state", () => {
    const state = makeState({ knownTopics: ["a", "b"] });
    applyRemovedTopics(state, new Set(["a"]));
    assert.deepEqual(state.knownTopics, ["a", "b"]);
  });
});
