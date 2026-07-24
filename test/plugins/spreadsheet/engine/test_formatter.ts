// Excel format codes → display strings. Nothing here throws: a bad format code
// produces a bad-looking cell, and a wrong decimal count produces a number that
// is simply off. Both read as ordinary output.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatNumber } from "../../../../src/plugins/spreadsheet/engine/formatter.ts";
import { dateToSerial } from "../../../../src/plugins/spreadsheet/engine/date-utils.ts";

const serialOf = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0) =>
  dateToSerial(new Date(Date.UTC(year, month - 1, day, hour, minute, second)));

const MAR_4_2025 = serialOf(2025, 3, 4);

describe("formatNumber — numeric date formats", () => {
  it("renders the padded and unpadded numeric orders", () => {
    assert.equal(formatNumber(MAR_4_2025, "MM/DD/YYYY"), "03/04/2025");
    assert.equal(formatNumber(MAR_4_2025, "M/D/YYYY"), "3/4/2025");
    assert.equal(formatNumber(MAR_4_2025, "YYYY-MM-DD"), "2025-03-04");
    assert.equal(formatNumber(MAR_4_2025, "DD/MM/YYYY"), "04/03/2025");
  });

  it("renders a two-digit year", () => {
    assert.equal(formatNumber(MAR_4_2025, "MM/DD/YY"), "03/04/25");
  });
});

describe("formatNumber — month-name formats", () => {
  // The regression from #2330: substitution used to run as a sequence of
  // replaces, so `/M/g` fired AFTER the month name had been inserted and
  // rewrote the M inside "Mar" / "March" — and "March" then lost its "h" to
  // the hour token, giving "3arc0".
  it("renders month names intact", () => {
    assert.equal(formatNumber(MAR_4_2025, "DD-MMM-YYYY"), "04-Mar-2025");
    assert.equal(formatNumber(MAR_4_2025, "MMM D, YYYY"), "Mar 4, 2025");
    assert.equal(formatNumber(MAR_4_2025, "MMMM D, YYYY"), "March 4, 2025");
  });

  // These are the shapes `getDefaultDateFormat` hands back for the matching
  // input, so a user typing "4-Mar-2025" gets this format applied to their own
  // cell without asking for it.
  it("round-trips the formats getDefaultDateFormat infers", () => {
    assert.equal(formatNumber(serialOf(2025, 9, 30), "MMMM D, YYYY"), "September 30, 2025");
    assert.equal(formatNumber(serialOf(2025, 12, 1), "DD-MMM-YYYY"), "01-Dec-2025");
  });

  it("renders weekday names", () => {
    assert.equal(formatNumber(MAR_4_2025, "dddd"), "Tuesday");
    assert.equal(formatNumber(MAR_4_2025, "ddd"), "Tue");
  });
});

describe("formatNumber — time formats", () => {
  it("renders 24-hour time", () => {
    assert.equal(formatNumber(serialOf(2025, 3, 4, 13, 45, 30), "HH:mm:ss"), "13:45:30");
    assert.equal(formatNumber(serialOf(2025, 3, 4, 9, 5, 0), "HH:mm"), "09:05");
  });

  it("renders 12-hour time with a meridiem", () => {
    assert.equal(formatNumber(serialOf(2025, 3, 4, 13, 45), "h:mm AM/PM"), "1:45 PM");
    assert.equal(formatNumber(serialOf(2025, 3, 4, 9, 5), "h:mm AM/PM"), "9:05 AM");
  });

  // Midnight and noon are the two values a `% 12` gets wrong without the
  // `|| 12` fallback.
  it("renders midnight as 12 AM and noon as 12 PM", () => {
    assert.equal(formatNumber(serialOf(2025, 3, 4, 0, 0), "h:mm AM/PM"), "12:00 AM");
    assert.equal(formatNumber(serialOf(2025, 3, 4, 12, 0), "h:mm AM/PM"), "12:00 PM");
  });
});

describe("formatNumber — currency", () => {
  it("renders a currency amount with separators and decimals", () => {
    assert.equal(formatNumber(1234.5, "$#,##0.00"), "$1,234.50");
    assert.equal(formatNumber(1234.5, "$#,##0"), "$1,235");
    assert.equal(formatNumber(1234.5, "$0.00"), "$1234.50");
  });

  it("groups every three digits", () => {
    assert.equal(formatNumber(1234567.89, "$#,##0.00"), "$1,234,567.89");
    assert.equal(formatNumber(100, "$#,##0"), "$100");
    assert.equal(formatNumber(1000, "$#,##0"), "$1,000");
  });

  // The sign goes outside the symbol: "-$1,000.00", not "$-1,000.00".
  it("puts the minus sign before the currency symbol", () => {
    assert.equal(formatNumber(-1000, "$#,##0.00"), "-$1,000.00");
  });

  it("renders zero", () => {
    assert.equal(formatNumber(0, "$#,##0.00"), "$0.00");
  });
});

describe("formatNumber — percentage", () => {
  it("multiplies by 100 and appends the sign", () => {
    assert.equal(formatNumber(0.5, "0.0%"), "50.0%");
    assert.equal(formatNumber(0.1234, "0.00%"), "12.34%");
    assert.equal(formatNumber(1, "0.00%"), "100.00%");
  });

  // The decimal count is read from a `.0+` run in the format. A format with no
  // such run falls back to 2 for percentages while currency falls back to 0 —
  // an asymmetry worth knowing about, since "0%" renders as "50.00%".
  it("falls back to two decimals when the format declares none", () => {
    assert.equal(formatNumber(0.5, "0%"), "50.00%");
  });
});

describe("formatNumber — plain numbers", () => {
  it("renders a fixed number of decimals", () => {
    assert.equal(formatNumber(1234.5678, "0.00"), "1234.57");
    assert.equal(formatNumber(1234.5678, "0.000"), "1234.568");
  });

  it("renders thousands separators without a currency symbol", () => {
    assert.equal(formatNumber(1234567, "#,##0"), "1,234,567");
    assert.equal(formatNumber(1234.5, "#,##0.00"), "1,234.50");
    assert.equal(formatNumber(-1234.5, "#,##0.00"), "-1,234.50");
  });

  it("returns the raw number when there is no format", () => {
    assert.equal(formatNumber(1234.5, ""), "1234.5");
  });

  // `#` placeholders are not read at all — only a literal `.0+` run sets the
  // decimal count — so a format built from them is ignored entirely.
  it("ignores a format whose decimals are written with # placeholders", () => {
    assert.equal(formatNumber(0.5, "0.##"), "0.5");
    assert.equal(formatNumber(1234.5678, "0.###"), "1234.5678");
  });

  it("reads the decimal count from the leading .0 run of a mixed format", () => {
    assert.equal(formatNumber(0.5, "0.0#"), "0.5");
  });
});
