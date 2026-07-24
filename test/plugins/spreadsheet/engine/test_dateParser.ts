// Turning a cell's text into a date. Every failure mode here is a wrong date
// rather than an error: March 4 read as April 3, 1930 read as 2030, a real
// date rejected as text. The cell still shows something plausible.
//
// Assertions compare against `dateToSerial(Date.UTC(...))` rather than literal
// serial numbers, so these tests are about how the STRING is interpreted;
// serial arithmetic itself is covered in test_dateUtils.ts.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getDefaultDateFormat, isDateLike, parseDate } from "../../../../src/plugins/spreadsheet/engine/date-parser.ts";
import { dateToSerial } from "../../../../src/plugins/spreadsheet/engine/date-utils.ts";

const serialOf = (year: number, month: number, day: number) => dateToSerial(new Date(Date.UTC(year, month - 1, day)));

function assertParsesTo(input: string, year: number, month: number, day: number, preferDayFirst = false): void {
  assert.equal(parseDate(input, preferDayFirst), serialOf(year, month, day), `${input} should read as ${year}-${month}-${day}`);
}

describe("isDateLike", () => {
  it("accepts the formats the parser handles", () => {
    for (const input of ["03/04/2025", "2025-03-04", "2025/03/04", "4-Mar-2025", "Mar 4, 2025", "March 4, 2025", "4 Mar 2025"]) {
      assert.equal(isDateLike(input), true, `${input} should look like a date`);
    }
  });

  it("rejects text with no digits or no separator", () => {
    assert.equal(isDateLike("hello world"), false);
    assert.equal(isDateLike("20250304"), false);
  });

  // The length gate runs before any pattern match, so a short but perfectly
  // well-formed date is rejected outright.
  it("rejects a valid short date because of the 6-character floor", () => {
    assert.equal(isDateLike("1/1/26"), true, "exactly 6 characters passes");
    assert.equal(isDateLike("1/1/6"), false, "5 characters is refused before any pattern runs");
  });

  it("rejects anything longer than 30 characters", () => {
    assert.equal(isDateLike(`${"September 30, 2025".padEnd(31, " ")}`), false);
  });

  it("rejects partial or malformed dates", () => {
    assert.equal(isDateLike("03/2025"), false);
    assert.equal(isDateLike("03-04-2025"), false, "hyphen-separated numerics are not a supported pattern");
  });
});

describe("parseDate — ISO format", () => {
  it("reads YYYY-MM-DD and YYYY/MM/DD", () => {
    assertParsesTo("2025-03-04", 2025, 3, 4);
    assertParsesTo("2025/03/04", 2025, 3, 4);
  });

  it("accepts unpadded month and day", () => {
    assertParsesTo("2025-3-4", 2025, 3, 4);
  });

  // ISO is matched first, so a leading 4-digit group is never mistaken for a
  // day even when it would be a legal day-first date.
  it("takes the leading 4-digit group as the year", () => {
    assertParsesTo("2025-01-02", 2025, 1, 2);
  });
});

describe("parseDate — slash format and the MM/DD vs DD/MM decision", () => {
  // The default is US order. This is the single most consequential choice in
  // the module: an ambiguous date silently becomes a different day.
  it("defaults an ambiguous date to MM/DD", () => {
    assertParsesTo("03/04/2025", 2025, 3, 4);
  });

  it("reads an ambiguous date as DD/MM when asked to prefer it", () => {
    assertParsesTo("03/04/2025", 2025, 4, 3, true);
  });

  // Unambiguous cases ignore the preference entirely — the value decides.
  it("reads day-first when the first number cannot be a month", () => {
    assertParsesTo("13/04/2025", 2025, 4, 13);
    assertParsesTo("13/04/2025", 2025, 4, 13, true);
  });

  it("reads month-first when the second number cannot be a day-of-month position", () => {
    assertParsesTo("03/13/2025", 2025, 3, 13);
    assertParsesTo("03/13/2025", 2025, 3, 13, true);
  });

  it("rejects a slash date where neither ordering is valid", () => {
    assert.equal(parseDate("13/13/2025"), null);
  });
});

describe("parseDate — two-digit years", () => {
  // The pivot is hardcoded at 30 and not configurable, so "01/01/30" is 1930.
  it("maps years under 30 to the 2000s and 30 or over to the 1900s", () => {
    assertParsesTo("01/01/29", 2029, 1, 1);
    assertParsesTo("01/01/30", 1930, 1, 1);
    assertParsesTo("01/01/99", 1999, 1, 1);
    assertParsesTo("01/01/00", 2000, 1, 1);
  });

  it("applies the same pivot to the DD-MMM-YY form", () => {
    assertParsesTo("1-Jan-29", 2029, 1, 1);
    assertParsesTo("1-Jan-30", 1930, 1, 1);
  });
});

describe("parseDate — month-name formats", () => {
  it("reads DD-MMM-YYYY", () => {
    assertParsesTo("4-Mar-2025", 2025, 3, 4);
    assertParsesTo("04-Mar-2025", 2025, 3, 4);
  });

  it("reads MMM D, YYYY and MMMM D, YYYY", () => {
    assertParsesTo("Mar 4, 2025", 2025, 3, 4);
    assertParsesTo("March 4, 2025", 2025, 3, 4);
  });

  it("reads D MMM YYYY", () => {
    assertParsesTo("4 Mar 2025", 2025, 3, 4);
    assertParsesTo("4 March 2025", 2025, 3, 4);
  });

  it("matches month names case-insensitively", () => {
    assertParsesTo("4-MAR-2025", 2025, 3, 4);
    assertParsesTo("march 4, 2025", 2025, 3, 4);
  });

  it("rejects a month name that is not a real month", () => {
    assert.equal(parseDate("4-Foo-2025"), null);
    assert.equal(parseDate("Smarch 4, 2025"), null);
  });

  it("makes the comma optional in MMM D YYYY", () => {
    assertParsesTo("Mar 4 2025", 2025, 3, 4);
  });
});

describe("parseDate — validity and range", () => {
  it("rejects a day that does not exist in its month", () => {
    assert.equal(parseDate("2025-02-30"), null);
    assert.equal(parseDate("2025-04-31"), null);
    assert.equal(parseDate("02/30/2025"), null);
  });

  it("accepts Feb 29 in a leap year and rejects it otherwise", () => {
    assertParsesTo("2024-02-29", 2024, 2, 29);
    assert.equal(parseDate("2025-02-29"), null);
  });

  // The window is 1900–2100 inclusive; outside it a well-formed date is
  // rejected rather than converted.
  it("enforces the 1900–2100 year window", () => {
    assertParsesTo("1900-01-01", 1900, 1, 1);
    assertParsesTo("2100-12-31", 2100, 12, 31);
    assert.equal(parseDate("1899-12-31"), null);
    assert.equal(parseDate("2101-01-01"), null);
  });

  it("returns null for anything isDateLike rejects", () => {
    assert.equal(parseDate("hello"), null);
    assert.equal(parseDate(""), null);
    assert.equal(parseDate("1/1/6"), null);
  });

  it("tolerates surrounding whitespace", () => {
    assertParsesTo("  2025-03-04  ", 2025, 3, 4);
  });
});

describe("getDefaultDateFormat", () => {
  it("echoes the shape it was given", () => {
    assert.equal(getDefaultDateFormat("2025-03-04"), "YYYY-MM-DD");
    assert.equal(getDefaultDateFormat("2025/03/04"), "YYYY/MM/DD");
    assert.equal(getDefaultDateFormat("4-Mar-2025"), "DD-MMM-YYYY");
    assert.equal(getDefaultDateFormat("Mar 4, 2025"), "MMM D, YYYY");
    assert.equal(getDefaultDateFormat("March 4, 2025"), "MMMM D, YYYY");
  });

  // The three-vs-four letter split is what separates the two month-name
  // formats; a four-letter month name takes the long form.
  it("splits the month-name formats on name length", () => {
    assert.equal(getDefaultDateFormat("Jun 4, 2025"), "MMM D, YYYY");
    assert.equal(getDefaultDateFormat("June 4, 2025"), "MMMM D, YYYY");
  });

  // A slash date is labelled in the order the parser READ it, so the cell
  // renders the halves the way the user typed them.
  it("labels a slash date in its reading order", () => {
    assert.equal(getDefaultDateFormat("03/04/2025"), "MM/DD/YYYY", "ambiguous: US default");
    assert.equal(getDefaultDateFormat("03/04/2025", true), "DD/MM/YYYY", "ambiguous: day-first when preferred");
    assert.equal(getDefaultDateFormat("13/04/2025"), "DD/MM/YYYY", "13 can only be a day, whatever the preference");
    assert.equal(getDefaultDateFormat("03/13/2025", true), "MM/DD/YYYY", "13 can only be a day here too");
  });

  // Slash-separated ISO parses year-first, so it must be LABELLED year-first
  // too. Falling through to the slash default re-rendered it as MM/DD or DD/MM
  // — the same digits in a different order, which reads as a different date
  // (Codex review).
  it("keeps a year-first label for YYYY/MM/DD under either preference", () => {
    assert.equal(getDefaultDateFormat("2025/03/04"), "YYYY/MM/DD");
    assert.equal(getDefaultDateFormat("2025/03/04", true), "YYYY/MM/DD");
    assert.equal(getDefaultDateFormat("2025/3/4", true), "YYYY/MM/DD", "unpadded too");
  });

  it("falls back to the preference for anything unrecognised", () => {
    assert.equal(getDefaultDateFormat("not a date"), "MM/DD/YYYY");
    assert.equal(getDefaultDateFormat("not a date", true), "DD/MM/YYYY");
    assert.equal(getDefaultDateFormat(""), "MM/DD/YYYY");
  });
});
