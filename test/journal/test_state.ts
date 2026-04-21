import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  defaultState,
  parseState,
  isDailyDue,
  isOptimizationDue,
  JOURNAL_STATE_VERSION,
  DEFAULT_DAILY_INTERVAL_HOURS,
  DEFAULT_OPTIMIZATION_INTERVAL_DAYS,
  type JournalState,
} from "../../server/workspace/journal/state.js";

describe("defaultState", () => {
  it("produces a valid fresh state with the current schema version", () => {
    const s = defaultState();
    assert.equal(s.version, JOURNAL_STATE_VERSION);
    assert.equal(s.lastDailyRunAt, null);
    assert.equal(s.lastOptimizationRunAt, null);
    assert.equal(s.dailyIntervalHours, DEFAULT_DAILY_INTERVAL_HOURS);
    assert.equal(s.optimizationIntervalDays, DEFAULT_OPTIMIZATION_INTERVAL_DAYS);
    assert.deepEqual(s.processedSessions, {});
    assert.deepEqual(s.knownTopics, []);
  });
});

describe("parseState", () => {
  it("returns defaults for null / non-object input", () => {
    assert.deepEqual(parseState(null), defaultState());
    assert.deepEqual(parseState("foo"), defaultState());
    assert.deepEqual(parseState(42), defaultState());
  });

  it("returns defaults when the version mismatches", () => {
    const parsed = parseState({ version: 999, lastDailyRunAt: "ignored" });
    assert.equal(parsed.lastDailyRunAt, null);
  });

  it("round-trips a well-formed state", () => {
    const s: JournalState = {
      version: JOURNAL_STATE_VERSION,
      lastDailyRunAt: "2026-04-11T09:00:00.000Z",
      lastOptimizationRunAt: "2026-04-05T09:00:00.000Z",
      dailyIntervalHours: 2,
      optimizationIntervalDays: 14,
      processedSessions: { "abc-123": { lastMtimeMs: 1710000000000 } },
      knownTopics: ["refactoring", "video-generation"],
    };
    assert.deepEqual(parseState(s), s);
  });

  it("restores default intervals when stored values are non-positive", () => {
    const parsed = parseState({
      version: JOURNAL_STATE_VERSION,
      dailyIntervalHours: 0,
      optimizationIntervalDays: -3,
    });
    assert.equal(parsed.dailyIntervalHours, DEFAULT_DAILY_INTERVAL_HOURS);
    assert.equal(parsed.optimizationIntervalDays, DEFAULT_OPTIMIZATION_INTERVAL_DAYS);
  });

  it("drops processedSessions entries with invalid mtime", () => {
    const parsed = parseState({
      version: JOURNAL_STATE_VERSION,
      processedSessions: {
        good: { lastMtimeMs: 1000 },
        "bad-string": { lastMtimeMs: "nope" },
        "bad-negative": { lastMtimeMs: -5 },
        "bad-shape": "not an object",
      },
    });
    assert.deepEqual(parsed.processedSessions, {
      good: { lastMtimeMs: 1000 },
    });
  });

  it("filters non-string entries out of knownTopics", () => {
    const parsed = parseState({
      version: JOURNAL_STATE_VERSION,
      knownTopics: ["ok", 42, null, "also-ok"],
    });
    assert.deepEqual(parsed.knownTopics, ["ok", "also-ok"]);
  });
});

describe("isDailyDue", () => {
  const base = defaultState();
  base.dailyIntervalHours = 1;
  const HOUR = 60 * 60 * 1000;

  it("is true when lastDailyRunAt is null (never run)", () => {
    assert.equal(isDailyDue(base, Date.now()), true);
  });

  it("is true when an unparseable string is stored", () => {
    const s = { ...base, lastDailyRunAt: "not a date" };
    assert.equal(isDailyDue(s, Date.now()), true);
  });

  it("is false when less than one interval has elapsed", () => {
    const anchor = new Date("2026-04-11T09:00:00Z");
    const s = { ...base, lastDailyRunAt: anchor.toISOString() };
    assert.equal(isDailyDue(s, anchor.getTime() + 30 * 60 * 1000), false);
  });

  it("is true at exactly one interval elapsed", () => {
    const anchor = new Date("2026-04-11T09:00:00Z");
    const s = { ...base, lastDailyRunAt: anchor.toISOString() };
    assert.equal(isDailyDue(s, anchor.getTime() + HOUR), true);
  });

  it("is true after more than one interval", () => {
    const anchor = new Date("2026-04-11T09:00:00Z");
    const s = { ...base, lastDailyRunAt: anchor.toISOString() };
    assert.equal(isDailyDue(s, anchor.getTime() + 2 * HOUR), true);
  });

  it("respects a custom interval stored in state", () => {
    const anchor = new Date("2026-04-11T09:00:00Z");
    const s = {
      ...base,
      dailyIntervalHours: 6,
      lastDailyRunAt: anchor.toISOString(),
    };
    // 3 hours later — not due with a 6h interval
    assert.equal(isDailyDue(s, anchor.getTime() + 3 * HOUR), false);
    // 6 hours later — exactly due
    assert.equal(isDailyDue(s, anchor.getTime() + 6 * HOUR), true);
  });
});

describe("isOptimizationDue", () => {
  const base = defaultState();
  const DAY = 24 * 60 * 60 * 1000;

  it("is true when lastOptimizationRunAt is null", () => {
    assert.equal(isOptimizationDue(base, Date.now()), true);
  });

  it("is false until the full interval has passed", () => {
    const anchor = new Date("2026-04-01T00:00:00Z");
    const s = { ...base, lastOptimizationRunAt: anchor.toISOString() };
    assert.equal(isOptimizationDue(s, anchor.getTime() + 6 * DAY), false);
  });

  it("is true exactly at the interval boundary", () => {
    const anchor = new Date("2026-04-01T00:00:00Z");
    const s = { ...base, lastOptimizationRunAt: anchor.toISOString() };
    assert.equal(isOptimizationDue(s, anchor.getTime() + 7 * DAY), true);
  });
});
