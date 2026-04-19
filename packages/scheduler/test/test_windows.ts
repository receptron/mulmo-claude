import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  nextWindowAfter,
  listMissedWindows,
  isDueAt,
  parseTimeToMs,
} from "../src/windows.ts";

const hour = (h: number, m = 0) => Date.UTC(2026, 3, 17, h, m, 0); // 2026-04-17 HH:MM UTC

describe("parseTimeToMs", () => {
  it("parses HH:MM to ms since midnight", () => {
    assert.equal(parseTimeToMs("08:00"), 8 * 3_600_000);
    assert.equal(parseTimeToMs("23:30"), 23 * 3_600_000 + 30 * 60_000);
    assert.equal(parseTimeToMs("00:00"), 0);
  });
});

describe("nextWindowAfter — interval", () => {
  it("returns the next epoch-aligned interval", () => {
    const schedule = { type: "interval" as const, intervalSec: 3600 };
    const after = hour(8, 15); // 08:15
    const next = nextWindowAfter(schedule, after)!;
    // Next whole hour after 08:15 = 09:00
    assert.equal(new Date(next).getUTCHours(), 9);
    assert.equal(new Date(next).getUTCMinutes(), 0);
  });

  it("returns the current tick if exactly on boundary", () => {
    const schedule = { type: "interval" as const, intervalSec: 3600 };
    const next = nextWindowAfter(schedule, hour(9, 0))!;
    assert.equal(next, hour(9, 0));
  });
});

describe("nextWindowAfter — daily", () => {
  it("returns today if time hasn't passed", () => {
    const schedule = { type: "daily" as const, time: "14:00" };
    const next = nextWindowAfter(schedule, hour(8, 0))!;
    assert.equal(new Date(next).getUTCHours(), 14);
    assert.equal(new Date(next).getUTCDate(), 17); // same day
  });

  it("returns tomorrow if time already passed", () => {
    const schedule = { type: "daily" as const, time: "08:00" };
    const next = nextWindowAfter(schedule, hour(10, 0))!;
    assert.equal(new Date(next).getUTCHours(), 8);
    assert.equal(new Date(next).getUTCDate(), 18); // next day
  });
});

describe("nextWindowAfter — weekly", () => {
  it("returns the next matching day", () => {
    // 2026-04-17 is a Friday (day 5)
    const schedule = {
      type: "weekly" as const,
      daysOfWeek: [1], // Monday
      time: "09:00",
    };
    const next = nextWindowAfter(schedule, hour(0, 0))!;
    assert.equal(new Date(next).getUTCDay(), 1); // Monday
    assert.equal(new Date(next).getUTCHours(), 9);
  });

  it("returns today if matching day and time hasn't passed", () => {
    // Friday
    const schedule = {
      type: "weekly" as const,
      daysOfWeek: [5],
      time: "14:00",
    };
    const next = nextWindowAfter(schedule, hour(8, 0))!;
    assert.equal(new Date(next).getUTCDate(), 17); // today (Friday)
  });

  it("returns null for empty daysOfWeek", () => {
    const schedule = {
      type: "weekly" as const,
      daysOfWeek: [],
      time: "09:00",
    };
    assert.equal(nextWindowAfter(schedule, hour(0, 0)), null);
  });
});

describe("nextWindowAfter — once", () => {
  it("returns the scheduled time if in the future", () => {
    const at = new Date(hour(20, 0)).toISOString();
    const schedule = { type: "once" as const, at };
    const next = nextWindowAfter(schedule, hour(8, 0))!;
    assert.equal(next, hour(20, 0));
  });

  it("returns null if already passed", () => {
    const at = new Date(hour(6, 0)).toISOString();
    const schedule = { type: "once" as const, at };
    assert.equal(nextWindowAfter(schedule, hour(8, 0)), null);
  });
});

describe("listMissedWindows", () => {
  it("lists all daily windows in a 3-day gap", () => {
    const schedule = { type: "daily" as const, time: "08:00" };
    const afterMs = Date.UTC(2026, 3, 14, 9, 0); // Apr 14 09:00
    const untilMs = Date.UTC(2026, 3, 17, 10, 0); // Apr 17 10:00
    const windows = listMissedWindows(schedule, afterMs, untilMs);
    assert.equal(windows.length, 3); // Apr 15, 16, 17 @ 08:00
  });

  it("returns empty when nothing was missed", () => {
    const schedule = { type: "daily" as const, time: "08:00" };
    const afterMs = hour(8, 0);
    const untilMs = hour(8, 30);
    assert.deepEqual(listMissedWindows(schedule, afterMs, untilMs), []);
  });

  it("caps at maxWindows", () => {
    const schedule = { type: "interval" as const, intervalSec: 60 };
    const afterMs = hour(0, 0);
    const untilMs = hour(23, 0);
    const windows = listMissedWindows(schedule, afterMs, untilMs, 5);
    assert.equal(windows.length, 5);
  });

  it("handles once schedule", () => {
    const at = new Date(hour(12, 0)).toISOString();
    const schedule = { type: "once" as const, at };
    const windows = listMissedWindows(schedule, hour(0, 0), hour(23, 0));
    assert.equal(windows.length, 1);
    assert.equal(windows[0], hour(12, 0));
  });
});

describe("isDueAt", () => {
  it("returns true when a daily window falls in the current tick", () => {
    const schedule = { type: "daily" as const, time: "08:00" };
    assert.equal(isDueAt(schedule, hour(8, 0), 60_000), true);
  });

  it("returns false outside the tick window", () => {
    const schedule = { type: "daily" as const, time: "08:00" };
    assert.equal(isDueAt(schedule, hour(8, 2), 60_000), false);
  });

  it("returns false for once schedule already passed", () => {
    const at = new Date(hour(6, 0)).toISOString();
    const schedule = { type: "once" as const, at };
    assert.equal(isDueAt(schedule, hour(8, 0), 60_000), false);
  });
});
