// MID's bounds and VALUE's parsing. Both returned a plausible answer instead of
// an error: `substring` SWAPS reversed bounds, so a negative MID count read
// backwards and produced earlier characters, and `parseFloat` stops at the first
// unreadable character, so VALUE("12abc") came back 12 (#2360).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { takeMid, parseValueText } from "../../../../src/plugins/spreadsheet/engine/functions/text.ts";
import { VALUE_ERROR } from "../../../../src/plugins/spreadsheet/engine/spreadsheet-errors.ts";
import { SpreadsheetEngine, type SheetData } from "../../../../src/plugins/spreadsheet/engine/index.ts";

const evaluate = (formula: string, cell: string | number = "Hello"): unknown => {
  const sheet: SheetData = { name: "S", data: [[{ v: cell }, { v: formula }]] };
  return new SpreadsheetEngine().calculate(sheet).data[0][1];
};

describe("takeMid — bounds", () => {
  it("errors on a negative count instead of reading backwards", () => {
    assert.equal(takeMid("Hello", 3, -1), VALUE_ERROR);
  });

  it("errors on a non-finite count", () => {
    assert.equal(takeMid("Hello", 3, NaN), VALUE_ERROR);
    assert.equal(takeMid("Hello", 3, Infinity), VALUE_ERROR);
  });

  // Excel's MID is 1-based; 0 and negatives are not positions.
  it("errors on a start position below 1", () => {
    assert.equal(takeMid("Hello", 0, 2), VALUE_ERROR);
    assert.equal(takeMid("Hello", -1, 2), VALUE_ERROR);
  });

  it("takes the requested characters from a 1-based start", () => {
    assert.equal(takeMid("Hello", 1, 2), "He");
    assert.equal(takeMid("Hello", 2, 3), "ell");
  });

  it("stops at the end of the text when the count overruns", () => {
    assert.equal(takeMid("Hello", 4, 99), "lo");
  });

  it("returns an empty string for a zero count", () => {
    assert.equal(takeMid("Hello", 2, 0), "");
  });

  it("truncates a fractional count and start toward zero", () => {
    assert.equal(takeMid("Hello", 2.9, 2.9), "el");
  });
});

describe("parseValueText — the whole string must be a number", () => {
  it("errors on trailing text rather than salvaging the prefix", () => {
    assert.equal(parseValueText("12abc"), VALUE_ERROR);
    assert.equal(parseValueText("3.5kg"), VALUE_ERROR);
  });

  it("errors on an empty or blank string", () => {
    assert.equal(parseValueText(""), VALUE_ERROR);
    assert.equal(parseValueText("   "), VALUE_ERROR);
  });

  it("reads a plain number, tolerating surrounding whitespace", () => {
    assert.equal(parseValueText("42"), 42);
    assert.equal(parseValueText("  7  "), 7);
    assert.equal(parseValueText("-3.5"), -3.5);
  });

  it("strips currency symbols and thousands separators", () => {
    assert.equal(parseValueText("$1,234.5"), 1234.5);
  });

  it("reads a trailing percent as a fraction", () => {
    assert.equal(parseValueText("50%"), 0.5);
    assert.equal(parseValueText("12abc%"), VALUE_ERROR, "still a whole-string match");
  });

  // `Number` accepts JS-only spellings a spreadsheet never should.
  it("rejects JS-only numeric syntaxes", () => {
    assert.equal(parseValueText("0x10"), VALUE_ERROR, "hex");
    assert.equal(parseValueText("0X10"), VALUE_ERROR, "hex, upper case");
    assert.equal(parseValueText("0b10"), VALUE_ERROR, "binary");
    assert.equal(parseValueText("0o17"), VALUE_ERROR, "octal");
    assert.equal(parseValueText("Infinity"), VALUE_ERROR);
    assert.equal(parseValueText("-Infinity"), VALUE_ERROR);
    assert.equal(parseValueText("1_000"), VALUE_ERROR, "numeric separator");
  });

  // The decimal pattern matches these, so only the finiteness check rejects
  // them — without it the guard would be dead code and could be dropped unseen.
  it("rejects an exponent that overflows to infinity", () => {
    assert.equal(parseValueText("1e999"), VALUE_ERROR);
    assert.equal(parseValueText("-1e999"), VALUE_ERROR);
    assert.equal(parseValueText("1e999%"), VALUE_ERROR, "also through the percent path");
  });

  it("still reads decimal and scientific notation", () => {
    assert.equal(parseValueText("1e3"), 1000);
    assert.equal(parseValueText("-2.5E-2"), -0.025);
    assert.equal(parseValueText(".5"), 0.5);
    assert.equal(parseValueText("+7"), 7);
  });
});

describe("through the engine", () => {
  it("surfaces the MID and VALUE errors in the cell", () => {
    assert.equal(evaluate("=MID(A1,3,-1)"), "#VALUE!");
    assert.equal(evaluate('=VALUE("12abc")'), "#VALUE!");
  });

  it("keeps the working cases working", () => {
    assert.equal(evaluate("=MID(A1,2,3)"), "ell");
    assert.equal(evaluate('=VALUE("42")'), 42);
  });
});
