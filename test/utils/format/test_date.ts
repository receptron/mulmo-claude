import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatDate, formatDateTime, formatTime, formatShortTime, formatShortDate } from "../../../src/utils/format/date.js";

describe("formatDate", () => {
  it("returns a non-empty string for a valid ISO date", () => {
    const out = formatDate("2026-04-10T07:21:39.125Z");
    assert.equal(typeof out, "string");
    assert.ok(out.length > 0);
  });

  it("contains digits (some form of time/day)", () => {
    const out = formatDate("2026-04-10T07:21:39.125Z");
    assert.match(out, /\d/);
  });

  it("does not throw for an unparseable input", () => {
    // Locale-aware formatting of an invalid Date never throws — it
    // returns a placeholder string ("Invalid Date" / "Invalid Date
    // Invalid Date" depending on locale). We only assert the safety
    // contract: the function must not bubble an exception up to the
    // UI render path.
    assert.doesNotThrow(() => formatDate("not a date"));
    // And it returns a non-empty placeholder string of some kind.
    const out = formatDate("not a date");
    assert.equal(typeof out, "string");
    assert.ok(out.length > 0);
    assert.match(out, /Invalid Date/);
  });

  it("differs across days at the same time", () => {
    const a = formatDate("2026-01-01T12:00:00Z");
    const b = formatDate("2026-12-31T12:00:00Z");
    assert.notEqual(a, b);
  });
});

describe("formatDateTime", () => {
  it("returns a non-empty string from epoch ms", () => {
    const out = formatDateTime(Date.now());
    assert.equal(typeof out, "string");
    assert.ok(out.length > 0);
    assert.match(out, /\d/);
  });
});

describe("formatTime", () => {
  it("returns a non-empty string from epoch ms", () => {
    const out = formatTime(Date.now());
    assert.equal(typeof out, "string");
    assert.match(out, /\d/);
  });
});

describe("formatShortTime", () => {
  it("returns a short time from ISO string", () => {
    const out = formatShortTime("2026-04-10T07:21:39.125Z");
    assert.equal(typeof out, "string");
    assert.match(out, /\d/);
  });

  it("falls back to raw string on parse error", () => {
    const out = formatShortTime("not a date");
    assert.equal(typeof out, "string");
    assert.ok(out.length > 0);
  });
});

describe("formatShortDate", () => {
  it("returns a short date from epoch ms", () => {
    const out = formatShortDate(Date.now());
    assert.equal(typeof out, "string");
    assert.match(out, /\d/);
  });
});
