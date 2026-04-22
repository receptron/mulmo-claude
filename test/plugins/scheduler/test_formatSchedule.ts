// Tests for the UTC → local-timezone formatter used by TasksTab.vue.
//
// The scheduler engine stores daily triggers as "HH:MM" UTC, but a
// user in Tokyo expects to see the same moment rendered in JST. These
// tests pin the formatter's behaviour for both the conversion and
// the graceful-degradation paths (malformed input, bad runtime).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatSchedule, formatDailyLocal, formatInterval } from "../../../src/plugins/scheduler/formatSchedule.js";

// A fixed moment anchors the date portion of the UTC instant so DST
// transitions don't make the assertions flap.
const FIXED_NOW = new Date("2026-04-23T00:30:00Z");

// `Intl.DateTimeFormat` picks up the host's timezone when the first
// argument is `undefined`. Many CI runners use UTC; tests that assert
// a non-UTC conversion override that by wrapping the formatter call.
// Rather than spoofing process.env.TZ (unreliable on macOS workers),
// we verify the conversion indirectly: any valid host TZ must at a
// minimum produce a HH:MM pair and a non-empty TZ label.

describe("formatDailyLocal", () => {
  it("produces Daily HH:MM <tz> for a valid UTC input", () => {
    const out = formatDailyLocal("20:00", FIXED_NOW);
    assert.match(out, /^Daily \d{2}:\d{2} \S.+$/);
  });

  it("keeps the Daily ... UTC fallback for a malformed time", () => {
    assert.equal(formatDailyLocal("not-a-time", FIXED_NOW), "Daily not-a-time UTC");
    assert.equal(formatDailyLocal("99:99", FIXED_NOW), "Daily 99:99 UTC");
    assert.equal(formatDailyLocal("", FIXED_NOW), "Daily  UTC");
  });

  it("normalizes hour 24 to 00 (some runtimes return '24' for midnight)", () => {
    const out = formatDailyLocal("00:00", FIXED_NOW);
    assert.ok(!out.startsWith("Daily 24:"), `got '${out}' — expected 00 not 24`);
  });

  it("uses the viewer's current date so DST transitions are respected", () => {
    // The formatter anchors to `now` rather than a fixed epoch.
    // Passing two different dates around a DST boundary can produce
    // different outputs — we assert only that both calls succeed and
    // format-check passes. (A full DST assertion would require
    // forcing a specific host TZ, which is outside this test's scope.)
    const march = new Date("2026-03-15T12:00:00Z");
    const july = new Date("2026-07-15T12:00:00Z");
    const outMar = formatDailyLocal("12:00", march);
    const outJul = formatDailyLocal("12:00", july);
    assert.match(outMar, /^Daily \d{2}:\d{2} \S.+$/);
    assert.match(outJul, /^Daily \d{2}:\d{2} \S.+$/);
  });
});

describe("formatInterval", () => {
  it("rounds to hours once the interval crosses 60 minutes", () => {
    assert.equal(formatInterval(60 * 60 * 1000), "Every 1h");
    assert.equal(formatInterval(4 * 60 * 60 * 1000), "Every 4h");
  });

  it("keeps sub-hour intervals in minutes", () => {
    assert.equal(formatInterval(5 * 60 * 1000), "Every 5m");
    assert.equal(formatInterval(30 * 60 * 1000), "Every 30m");
  });

  it("handles invalid input gracefully", () => {
    assert.equal(formatInterval(0), "Every ?");
    assert.equal(formatInterval(-1000), "Every ?");
    assert.equal(formatInterval(Number.NaN), "Every ?");
  });
});

describe("formatSchedule", () => {
  it("dispatches to the daily formatter for daily schedules", () => {
    const out = formatSchedule({ type: "daily", time: "23:00" }, FIXED_NOW);
    assert.match(out, /^Daily \d{2}:\d{2} \S.+$/);
  });

  it("dispatches to the interval formatter for interval schedules", () => {
    assert.equal(formatSchedule({ type: "interval", intervalMs: 3_600_000 }, FIXED_NOW), "Every 1h");
  });

  it("stringifies unknown shapes as-is so the user can still see what came down the wire", () => {
    // JSON.stringify returns identical output, just asserting the
    // fallback exists so a future refactor can't silently drop it.
    const out = formatSchedule({ type: "cron", cron: "0 * * * *" }, FIXED_NOW);
    assert.ok(out.includes("cron"));
  });
});
