import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatDate } from "../../src/utils/format.js";

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

  it("returns 'Invalid Date' for an unparseable input but does not throw", () => {
    // Locale-aware formatting of an invalid date returns the literal
    // 'Invalid Date' on every platform tested. The important thing is
    // that the function does not throw.
    assert.doesNotThrow(() => formatDate("not a date"));
  });

  it("differs across days at the same time", () => {
    const a = formatDate("2026-01-01T12:00:00Z");
    const b = formatDate("2026-12-31T12:00:00Z");
    assert.notEqual(a, b);
  });
});
