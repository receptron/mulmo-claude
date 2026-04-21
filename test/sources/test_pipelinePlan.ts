import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planEligibleSources } from "../../server/workspace/sources/pipeline/plan.js";
import type { Source, SourceSchedule, SourceState } from "../../server/workspace/sources/types.js";

function makeSource(over: Partial<Source> = {}): Source {
  return {
    slug: "s",
    title: "t",
    url: "https://x.com",
    fetcherKind: "rss",
    fetcherParams: {},
    schedule: "daily",
    categories: ["tech-news"],
    maxItemsPerFetch: 30,
    addedAt: "2026-04-01T00:00:00Z",
    notes: "",
    ...over,
  };
}

function makeState(over: Partial<SourceState> = {}): SourceState {
  return {
    slug: "s",
    lastFetchedAt: null,
    cursor: {},
    consecutiveFailures: 0,
    nextAttemptAt: null,
    ...over,
  };
}

describe("planEligibleSources — schedule matching", () => {
  it("includes only sources whose schedule matches the run type", () => {
    const sources = [
      makeSource({ slug: "daily-1", schedule: "daily" }),
      makeSource({ slug: "hourly-1", schedule: "hourly" }),
      makeSource({ slug: "daily-2", schedule: "daily" }),
      makeSource({ slug: "weekly-1", schedule: "weekly" }),
      makeSource({ slug: "ondemand-1", schedule: "on-demand" }),
    ];
    const eligible = planEligibleSources({
      sources,
      statesBySlug: new Map(),
      scheduleType: "daily",
      nowMs: 0,
    });
    assert.deepEqual(
      eligible.map((src) => src.slug),
      ["daily-1", "daily-2"],
    );
  });

  it("never picks up on-demand sources in a scheduled run", () => {
    const sources: Source[] = [makeSource({ slug: "od", schedule: "on-demand" })];
    for (const kind of ["hourly", "daily", "weekly"] as SourceSchedule[]) {
      const eligible = planEligibleSources({
        sources,
        statesBySlug: new Map(),
        scheduleType: kind,
        nowMs: 0,
      });
      assert.equal(eligible.length, 0, `expected 0 for ${kind}`);
    }
  });

  it("returns an empty list when nothing matches", () => {
    const sources = [makeSource({ slug: "h", schedule: "hourly" })];
    const eligible = planEligibleSources({
      sources,
      statesBySlug: new Map(),
      scheduleType: "daily",
      nowMs: 0,
    });
    assert.equal(eligible.length, 0);
  });

  it("handles an empty source list", () => {
    const eligible = planEligibleSources({
      sources: [],
      statesBySlug: new Map(),
      scheduleType: "daily",
      nowMs: 0,
    });
    assert.deepEqual(eligible, []);
  });
});

describe("planEligibleSources — sort ordering", () => {
  it("returns eligible sources sorted by slug for deterministic runs", () => {
    const sources = [makeSource({ slug: "charlie" }), makeSource({ slug: "alpha" }), makeSource({ slug: "bravo" })];
    const eligible = planEligibleSources({
      sources,
      statesBySlug: new Map(),
      scheduleType: "daily",
      nowMs: 0,
    });
    assert.deepEqual(
      eligible.map((src) => src.slug),
      ["alpha", "bravo", "charlie"],
    );
  });
});

describe("planEligibleSources — backoff respect", () => {
  const now = Date.parse("2026-04-13T10:00:00Z");

  it("includes sources with no state", () => {
    const sources = [makeSource({ slug: "first-run" })];
    const eligible = planEligibleSources({
      sources,
      statesBySlug: new Map(),
      scheduleType: "daily",
      nowMs: now,
    });
    assert.equal(eligible.length, 1);
  });

  it("includes sources with state but no nextAttemptAt", () => {
    const sources = [makeSource({ slug: "settled" })];
    const states = new Map([["settled", makeState({ slug: "settled", nextAttemptAt: null })]]);
    const eligible = planEligibleSources({
      sources,
      statesBySlug: states,
      scheduleType: "daily",
      nowMs: now,
    });
    assert.equal(eligible.length, 1);
  });

  it("skips sources with a future nextAttemptAt (still backing off)", () => {
    const sources = [makeSource({ slug: "backing-off" })];
    const states = new Map([
      [
        "backing-off",
        makeState({
          slug: "backing-off",
          nextAttemptAt: "2026-04-13T12:00:00Z", // 2 hours after now
        }),
      ],
    ]);
    const eligible = planEligibleSources({
      sources,
      statesBySlug: states,
      scheduleType: "daily",
      nowMs: now,
    });
    assert.equal(eligible.length, 0);
  });

  it("includes sources whose nextAttemptAt has already passed", () => {
    const sources = [makeSource({ slug: "retry-ready" })];
    const states = new Map([
      [
        "retry-ready",
        makeState({
          slug: "retry-ready",
          nextAttemptAt: "2026-04-13T08:00:00Z", // 2 hours before now
        }),
      ],
    ]);
    const eligible = planEligibleSources({
      sources,
      statesBySlug: states,
      scheduleType: "daily",
      nowMs: now,
    });
    assert.equal(eligible.length, 1);
  });

  it("includes sources with an unparseable nextAttemptAt (avoid lockout)", () => {
    const sources = [makeSource({ slug: "corrupt-state" })];
    const states = new Map([
      [
        "corrupt-state",
        makeState({
          slug: "corrupt-state",
          nextAttemptAt: "not-a-date",
        }),
      ],
    ]);
    const eligible = planEligibleSources({
      sources,
      statesBySlug: states,
      scheduleType: "daily",
      nowMs: now,
    });
    // Defensive: a corrupt state file shouldn't permanently lock
    // out a source. Run it, and the next run's writeState will
    // overwrite with a valid timestamp.
    assert.equal(eligible.length, 1);
  });
});
