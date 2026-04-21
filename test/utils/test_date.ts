import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toLocalIsoDate, toUtcIsoDate, isoDateOnly, isValidIsoDate } from "../../server/utils/date.js";

describe("toLocalIsoDate", () => {
  it("formats a Date to YYYY-MM-DD in local time", () => {
    // Use a date where local and UTC differ to verify local is used.
    const d = new Date(2026, 3, 17); // April 17, 2026 in local tz
    assert.equal(toLocalIsoDate(d), "2026-04-17");
  });

  it("accepts a ms timestamp", () => {
    const d = new Date(2026, 0, 1);
    assert.equal(toLocalIsoDate(d.getTime()), "2026-01-01");
  });

  it("zero-pads single-digit months and days", () => {
    const d = new Date(2026, 0, 5); // Jan 5
    assert.equal(toLocalIsoDate(d), "2026-01-05");
  });
});

describe("toUtcIsoDate", () => {
  it("formats a Date to YYYY-MM-DD in UTC", () => {
    const d = new Date("2026-04-17T23:30:00Z");
    assert.equal(toUtcIsoDate(d), "2026-04-17");
  });

  it("zero-pads single-digit months and days", () => {
    const d = new Date("2026-01-05T00:00:00Z");
    assert.equal(toUtcIsoDate(d), "2026-01-05");
  });
});

describe("isoDateOnly", () => {
  it("trims an ISO timestamp to YYYY-MM-DD", () => {
    assert.equal(isoDateOnly("2026-04-17T08:30:00.000Z"), "2026-04-17");
  });

  it("passes through a bare YYYY-MM-DD", () => {
    assert.equal(isoDateOnly("2026-04-17"), "2026-04-17");
  });
});

describe("isValidIsoDate", () => {
  it("accepts YYYY-MM-DD", () => {
    assert.equal(isValidIsoDate("2026-04-17"), true);
    assert.equal(isValidIsoDate("2026-01-01"), true);
    assert.equal(isValidIsoDate("2026-12-31"), true);
  });

  it("rejects wrong length", () => {
    assert.equal(isValidIsoDate("2026-04-1"), false);
    assert.equal(isValidIsoDate("2026-04-177"), false);
    assert.equal(isValidIsoDate(""), false);
  });

  it("rejects non-numeric segments", () => {
    assert.equal(isValidIsoDate("202a-04-17"), false);
    assert.equal(isValidIsoDate("2026-0b-17"), false);
    assert.equal(isValidIsoDate("2026-04-1c"), false);
  });

  it("rejects wrong separators", () => {
    assert.equal(isValidIsoDate("2026/04/17"), false);
    assert.equal(isValidIsoDate("2026.04.17"), false);
  });
});
