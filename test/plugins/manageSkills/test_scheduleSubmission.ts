// Pin the conversion logic that turns the SkillScheduleDialog's
// local-time + unit form into the UTC HH:MM / intervalMs payload the
// scheduler API accepts. These cover both branches without spinning
// up Vue.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildScheduleSubmission, localHHMMToUtcHHMM, DAILY_TIME_RE } from "../../../src/plugins/manageSkills/scheduleSubmission.js";

const ONE_MINUTE_MS = 60_000;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;

const DEFAULT_DAILY = { localTime: "09:00" };
const DEFAULT_INTERVAL = { amount: 1, unit: "hours" } as const;

describe("DAILY_TIME_RE", () => {
  it("accepts well-formed HH:MM in 24h range", () => {
    for (const value of ["00:00", "09:00", "12:30", "23:59"]) {
      assert.ok(DAILY_TIME_RE.test(value), `expected ${value} to match`);
    }
  });

  it("rejects out-of-range or malformed input", () => {
    for (const value of ["", "9:00", "24:00", "25:00", "12:60", "12-30", "ab:cd"]) {
      assert.ok(!DAILY_TIME_RE.test(value), `expected ${value} to be rejected`);
    }
  });
});

describe("localHHMMToUtcHHMM", () => {
  // The function depends on the host TZ. Rather than spoofing
  // process.env.TZ (unreliable on macOS workers — same caveat as
  // test_formatSchedule.ts), we test invariants that hold in any TZ.

  it("returns HH:MM zero-padded to two digits", () => {
    const out = localHHMMToUtcHHMM("09:05");
    assert.match(out, /^\d{2}:\d{2}$/);
  });

  it("preserves the minute value (TZ shifts only affect the hour)", () => {
    // No country uses a sub-hour offset that lands on minutes other
    // than :00, :30, or :45. Most CI runners are :00. Asserting that
    // the minute survives a round-trip rules out string-handling
    // bugs without depending on the host TZ.
    const out = localHHMMToUtcHHMM("12:34");
    const minute = out.split(":")[1];
    assert.ok(minute === "34" || minute === "04" || minute === "19", `unexpected minute in '${out}'`);
  });

  it("shifts by exactly one hour when the input shifts by one hour", () => {
    const anchor = new Date("2026-04-15T12:00:00Z");
    const a = localHHMMToUtcHHMM("10:00", anchor);
    const b = localHHMMToUtcHHMM("11:00", anchor);
    const aMin = parseHHMMToMinutes(a);
    const bMin = parseHHMMToMinutes(b);
    // Modulo 24h to handle the case where one of them wraps midnight.
    const diff = (bMin - aMin + 24 * 60) % (24 * 60);
    assert.equal(diff, 60, `expected +60min between ${a} and ${b}`);
  });

  it("wraps midnight cleanly (no '24:00' output)", () => {
    const out = localHHMMToUtcHHMM("00:00");
    // Some runtimes return "24" for midnight under hour: 2-digit; the
    // helper must not surface that.
    assert.ok(!out.startsWith("24:"), `got '${out}' — expected wrapped to 00`);
  });
});

describe("buildScheduleSubmission", () => {
  describe("daily", () => {
    it("returns a daily payload for a valid time", () => {
      const out = buildScheduleSubmission("daily", { localTime: "09:00" }, DEFAULT_INTERVAL);
      if (out === null || out.type !== "daily") {
        assert.fail(`expected a daily payload, got ${JSON.stringify(out)}`);
      }
      assert.match(out.time, /^\d{2}:\d{2}$/);
    });

    it("returns null for an unparseable time", () => {
      const out = buildScheduleSubmission("daily", { localTime: "9:00" }, DEFAULT_INTERVAL);
      assert.equal(out, null);
    });

    it("returns null for empty input", () => {
      const out = buildScheduleSubmission("daily", { localTime: "" }, DEFAULT_INTERVAL);
      assert.equal(out, null);
    });
  });

  describe("interval", () => {
    it("converts 1 hour to 3_600_000 ms", () => {
      const out = buildScheduleSubmission("interval", DEFAULT_DAILY, { amount: 1, unit: "hours" });
      assert.deepEqual(out, { type: "interval", intervalMs: ONE_HOUR_MS });
    });

    it("converts 30 minutes to 1_800_000 ms", () => {
      const out = buildScheduleSubmission("interval", DEFAULT_DAILY, { amount: 30, unit: "minutes" });
      assert.deepEqual(out, { type: "interval", intervalMs: 30 * ONE_MINUTE_MS });
    });

    it("converts 4 hours to 14_400_000 ms", () => {
      const out = buildScheduleSubmission("interval", DEFAULT_DAILY, { amount: 4, unit: "hours" });
      assert.deepEqual(out, { type: "interval", intervalMs: 4 * ONE_HOUR_MS });
    });

    it("floors fractional amounts (input narrows to integer)", () => {
      const out = buildScheduleSubmission("interval", DEFAULT_DAILY, { amount: 2.7, unit: "hours" });
      assert.deepEqual(out, { type: "interval", intervalMs: 2 * ONE_HOUR_MS });
    });

    it("returns null for amount below 1", () => {
      assert.equal(buildScheduleSubmission("interval", DEFAULT_DAILY, { amount: 0, unit: "hours" }), null);
      assert.equal(buildScheduleSubmission("interval", DEFAULT_DAILY, { amount: -3, unit: "minutes" }), null);
    });

    it("returns null for non-finite amount", () => {
      assert.equal(buildScheduleSubmission("interval", DEFAULT_DAILY, { amount: Number.NaN, unit: "hours" }), null);
      assert.equal(buildScheduleSubmission("interval", DEFAULT_DAILY, { amount: Number.POSITIVE_INFINITY, unit: "hours" }), null);
    });
  });
});

function parseHHMMToMinutes(hhmm: string): number {
  const [hourStr, minuteStr] = hhmm.split(":");
  return Number(hourStr) * 60 + Number(minuteStr);
}
