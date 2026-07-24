// Excel serial-number conversion. Every date function in the engine routes
// through this pair, and an error here is invisible: a date still renders, it
// is just the wrong day. The epoch choice is the subtle part — Excel's serial
// numbering embeds a 1900 leap-year bug, and the base date compensates for it.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  dateToSerial,
  serialToDate,
  DAY_NAMES_FULL,
  DAY_NAMES_SHORT,
  MONTH_NAMES_FULL,
  MONTH_NAMES_SHORT,
} from "../../../../src/plugins/spreadsheet/engine/date-utils.ts";

const utc = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0) => new Date(Date.UTC(year, month - 1, day, hour, minute, second));

describe("dateToSerial", () => {
  it("anchors serial 0 at the Dec 30 1899 base", () => {
    assert.equal(dateToSerial(utc(1899, 12, 30)), 0);
    assert.equal(dateToSerial(utc(1899, 12, 31)), 1);
  });

  it("counts whole days forward", () => {
    assert.equal(dateToSerial(utc(1900, 1, 2)), 3);
    assert.equal(dateToSerial(utc(1900, 2, 1)), 33);
  });

  // The point of the Dec 30 1899 base: Excel counts a phantom 1900-02-29 that
  // never existed, and starting two days early makes every serial from March
  // 1900 onward — i.e. every date anyone actually uses — agree with Excel's.
  it("agrees with Excel from March 1900 onward", () => {
    assert.equal(dateToSerial(utc(1900, 3, 1)), 61); // Excel: 61
    assert.equal(dateToSerial(utc(2000, 1, 1)), 36526); // Excel: 36526
    assert.equal(dateToSerial(utc(2026, 7, 22)), 46225);
  });

  // The flip side of that choice, pinned so it is a known limitation rather
  // than a surprise: for the first two months of 1900 the serials sit one
  // ahead of Excel's, because the phantom leap day has not been passed yet.
  it("sits one ahead of Excel for Jan and Feb 1900", () => {
    assert.equal(dateToSerial(utc(1900, 1, 1)), 2); // Excel: 1
    assert.equal(dateToSerial(utc(1900, 2, 28)), 60); // Excel: 59
  });

  it("represents a time of day as the fractional part", () => {
    assert.equal(dateToSerial(utc(1899, 12, 31, 12)), 1.5);
    assert.equal(dateToSerial(utc(1899, 12, 31, 6)), 1.25);
  });

  it("goes negative for dates before the base", () => {
    assert.ok(dateToSerial(utc(1899, 12, 29)) < 0);
  });
});

describe("serialToDate", () => {
  it("maps serial 1 back to the day after the base", () => {
    assert.equal(serialToDate(1).toISOString().slice(0, 10), "1899-12-31");
  });

  it("maps a modern serial back to its date", () => {
    assert.equal(serialToDate(46225).toISOString().slice(0, 10), "2026-07-22");
    assert.equal(serialToDate(61).toISOString().slice(0, 10), "1900-03-01");
  });

  it("restores the time of day from the fractional part", () => {
    assert.equal(serialToDate(1.5).toISOString().slice(11, 19), "12:00:00");
    assert.equal(serialToDate(1.25).toISOString().slice(11, 19), "06:00:00");
  });

  // The fraction is rounded to the nearest second, so a value that lands
  // mid-second must not drift to the previous one.
  it("rounds the time component to the nearest second", () => {
    const almostOneMinute = 1 + 59.6 / 86400;
    assert.equal(serialToDate(almostOneMinute).toISOString().slice(11, 19), "00:01:00");
  });
});

describe("dateToSerial / serialToDate round-trip", () => {
  it("round-trips whole days across month, year and leap boundaries", () => {
    const dates = [utc(1900, 1, 1), utc(1900, 3, 1), utc(1999, 12, 31), utc(2000, 2, 29), utc(2024, 2, 29), utc(2026, 7, 22), utc(2100, 1, 1)];
    for (const date of dates) {
      const back = serialToDate(dateToSerial(date));
      assert.equal(back.toISOString(), date.toISOString(), `round-trip failed for ${date.toISOString()}`);
    }
  });

  it("round-trips a date carrying a time of day", () => {
    const date = utc(2026, 7, 22, 13, 45, 30);
    assert.equal(serialToDate(dateToSerial(date)).toISOString(), date.toISOString());
  });
});

describe("name tables", () => {
  // These are indexed by `getMonth()` / `getDay()` directly, so a wrong length
  // or a shifted entry produces an off-by-one month or weekday with no error.
  it("has twelve months starting at January", () => {
    assert.equal(MONTH_NAMES_SHORT.length, 12);
    assert.equal(MONTH_NAMES_FULL.length, 12);
    assert.equal(MONTH_NAMES_SHORT[0], "Jan");
    assert.equal(MONTH_NAMES_FULL[0], "January");
    assert.equal(MONTH_NAMES_SHORT[11], "Dec");
    assert.equal(MONTH_NAMES_FULL[11], "December");
  });

  it("has seven days starting at Sunday, matching Date#getDay", () => {
    assert.equal(DAY_NAMES_SHORT.length, 7);
    assert.equal(DAY_NAMES_FULL.length, 7);
    assert.equal(DAY_NAMES_SHORT[0], "Sun");
    assert.equal(DAY_NAMES_FULL[0], "Sunday");
    assert.equal(DAY_NAMES_SHORT[6], "Sat");
  });

  it("keeps the short names as prefixes of the full names", () => {
    MONTH_NAMES_SHORT.forEach((short, index) =>
      assert.ok(MONTH_NAMES_FULL[index]?.startsWith(short), `${short} is not a prefix of ${String(MONTH_NAMES_FULL[index])}`),
    );
    DAY_NAMES_SHORT.forEach((short, index) =>
      assert.ok(DAY_NAMES_FULL[index]?.startsWith(short), `${short} is not a prefix of ${String(DAY_NAMES_FULL[index])}`),
    );
  });
});
