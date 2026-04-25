// Priority tests for the favicon resolver. Each test pins one rule
// by constructing the exact context that should fire it, then checks
// both the returned hex and the `reason` tag so a mis-classification
// (right colour, wrong branch) still fails.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveFaviconColor, FAVICON_COLORS } from "../../../src/composables/favicon/resolveColor.js";
import { FAVICON_REASONS, FAVICON_STATES, type FaviconContext } from "../../../src/composables/favicon/types.js";

// Plain weekday afternoon — every flavour rule is off so "idle" is
// the default fallback. Use this as a base and override one field
// per test to keep the intent obvious.
function baseIdle(): FaviconContext {
  return {
    state: FAVICON_STATES.idle,
    sessionsUnreadCount: 0,
    runningSinceMs: null,
    now: new Date(2026, 3, 23, 14, 0), // Thu 2026-04-23 14:00
    userBirthdayMMDD: null,
    cpuLoadRatio: 0.2,
  };
}

describe("resolveFaviconColor — state-driven rules (priority 1-4)", () => {
  it("error state beats everything, including overload and calendar", () => {
    const pick = resolveFaviconColor({
      ...baseIdle(),
      state: FAVICON_STATES.error,
      cpuLoadRatio: 1.5, // would be overloaded
      now: new Date(2026, 11, 25, 3, 0), // would be christmas + late-night
      sessionsUnreadCount: 99, // would be many-unread
    });
    assert.equal(pick.reason, FAVICON_REASONS.error);
    assert.equal(pick.color, FAVICON_COLORS.error);
  });

  it("overloaded beats many-unread + running", () => {
    const pick = resolveFaviconColor({
      ...baseIdle(),
      state: FAVICON_STATES.running,
      cpuLoadRatio: 1.2,
      sessionsUnreadCount: 7,
    });
    assert.equal(pick.reason, FAVICON_REASONS.overloaded);
    assert.equal(pick.color, FAVICON_COLORS.overloaded);
  });

  it("many-unread beats running and done", () => {
    const runningPick = resolveFaviconColor({
      ...baseIdle(),
      state: FAVICON_STATES.running,
      sessionsUnreadCount: 6,
    });
    assert.equal(runningPick.reason, FAVICON_REASONS.manyUnread);

    const donePick = resolveFaviconColor({
      ...baseIdle(),
      state: FAVICON_STATES.done,
      sessionsUnreadCount: 10,
    });
    assert.equal(donePick.reason, FAVICON_REASONS.manyUnread);
  });

  it("running-long replaces running after 60s", () => {
    const now = new Date(2026, 3, 23, 14, 1, 30); // 90 s elapsed
    const runningSinceMs = new Date(2026, 3, 23, 14, 0).getTime();
    const pick = resolveFaviconColor({
      ...baseIdle(),
      state: FAVICON_STATES.running,
      now,
      runningSinceMs,
    });
    assert.equal(pick.reason, FAVICON_REASONS.runningLong);
    assert.equal(pick.color, FAVICON_COLORS.runningLong);
  });

  it("short running falls through to flavour — yellow dot carries the signal, background shows ambient context", () => {
    // 10 s elapsed on a plain weekday midday — no escalation fires,
    // so the background should land on the flavour default (idle).
    const now = new Date(2026, 3, 23, 14, 0, 10);
    const runningSinceMs = new Date(2026, 3, 23, 14, 0).getTime();
    const pick = resolveFaviconColor({
      ...baseIdle(),
      state: FAVICON_STATES.running,
      now,
      runningSinceMs,
    });
    assert.equal(pick.reason, FAVICON_REASONS.idle);
    assert.equal(pick.color, FAVICON_COLORS.idle);
  });

  it("done state with a modest unread count falls through to flavour — red dot carries the signal", () => {
    // Morning weekday with 2 unread — red dot shows unread, background
    // paints the morning flavour. Previously this would have been green.
    const pick = resolveFaviconColor({
      ...baseIdle(),
      state: FAVICON_STATES.done,
      sessionsUnreadCount: 2,
      now: new Date(2026, 3, 23, 7, 0),
    });
    assert.equal(pick.reason, FAVICON_REASONS.morning);
  });
});

describe("resolveFaviconColor — flavour rules (priority 7-12)", () => {
  it("birthday beats every other flavour rule", () => {
    // Dec 25 10:00 — would be christmas + weekend, but birthday wins.
    const pick = resolveFaviconColor({
      ...baseIdle(),
      now: new Date(2026, 11, 25, 10, 0),
      userBirthdayMMDD: "12-25",
    });
    assert.equal(pick.reason, FAVICON_REASONS.birthday);
    assert.equal(pick.color, FAVICON_COLORS.birthday);
  });

  it("new year beats late-night and christmas (can't overlap, but pins order)", () => {
    const pick = resolveFaviconColor({
      ...baseIdle(),
      now: new Date(2027, 0, 1, 23, 0), // Jan 1 23:00 — also late-night
    });
    assert.equal(pick.reason, FAVICON_REASONS.newYear);
  });

  it("christmas fires on Dec 24 midday", () => {
    const pick = resolveFaviconColor({
      ...baseIdle(),
      now: new Date(2026, 11, 24, 14, 0),
    });
    assert.equal(pick.reason, FAVICON_REASONS.christmas);
  });

  it("late-night fires at 23:00 on a plain weekday", () => {
    const pick = resolveFaviconColor({
      ...baseIdle(),
      now: new Date(2026, 3, 23, 23, 0),
    });
    assert.equal(pick.reason, FAVICON_REASONS.lateNight);
  });

  it("morning fires at 07:00 on a plain weekday", () => {
    const pick = resolveFaviconColor({
      ...baseIdle(),
      now: new Date(2026, 3, 23, 7, 0),
    });
    assert.equal(pick.reason, FAVICON_REASONS.morning);
  });

  it("weekend fires on Saturday afternoon", () => {
    const pick = resolveFaviconColor({
      ...baseIdle(),
      now: new Date(2026, 3, 25, 14, 0),
    });
    assert.equal(pick.reason, FAVICON_REASONS.weekend);
  });

  it("idle gray is the fallback on a plain weekday midday", () => {
    const pick = resolveFaviconColor(baseIdle());
    assert.equal(pick.reason, FAVICON_REASONS.idle);
    assert.equal(pick.color, FAVICON_COLORS.idle);
  });
});

describe("resolveFaviconColor — cross-rule priority", () => {
  it("short-running agent on Christmas shows christmas flavour (yellow dot will indicate running)", () => {
    // 1 s elapsed — under the 60 s runningLong threshold, so no state
    // escalation fires and the flavour rule wins.
    const pick = resolveFaviconColor({
      ...baseIdle(),
      state: FAVICON_STATES.running,
      runningSinceMs: new Date(2026, 11, 25, 14, 0).getTime() - 1000,
      now: new Date(2026, 11, 25, 14, 0),
    });
    assert.equal(pick.reason, FAVICON_REASONS.christmas);
  });

  it("long-running agent still beats flavour via the runningLong escalation", () => {
    // 90 s elapsed on Christmas — runningLong cyan takes priority.
    const pick = resolveFaviconColor({
      ...baseIdle(),
      state: FAVICON_STATES.running,
      runningSinceMs: new Date(2026, 11, 25, 14, 0).getTime() - 90_000,
      now: new Date(2026, 11, 25, 14, 0),
    });
    assert.equal(pick.reason, FAVICON_REASONS.runningLong);
  });

  it("skips overloaded when cpuLoadRatio is null (no data yet / Windows)", () => {
    const pick = resolveFaviconColor({
      ...baseIdle(),
      cpuLoadRatio: null,
    });
    assert.equal(pick.reason, FAVICON_REASONS.idle);
  });
});
