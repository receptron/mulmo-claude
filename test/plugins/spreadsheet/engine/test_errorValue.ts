// Formula errors as a distinct VALUE (#2451).
//
// While errors were plain strings, `SQRT(-1)` and `CONCAT("#N","UM!")` both
// produced "#NUM!", so IFERROR could not tell a real error from text that
// merely spells one — the computed case was caught as an error and silently
// replaced by the fallback. An error is now its own value carrying the code;
// text stays text. The display pass renders the value back to `#NUM!`, so the
// cells look exactly as they did.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetEngine, type SheetData } from "../../../../src/plugins/spreadsheet/engine/index.ts";
import { evaluateFormula } from "../../../../src/plugins/spreadsheet/engine/evaluator.ts";
import { formatCellForDisplay } from "../../../../src/plugins/spreadsheet/engine/cellFormatting.ts";
import {
  DIV_ZERO_ERROR,
  NA_ERROR,
  NUM_ERROR,
  SpreadsheetError,
  isSpreadsheetErrorValue,
  isErrorResult,
  spreadsheetError,
} from "../../../../src/plugins/spreadsheet/engine/spreadsheet-errors.ts";
import type { CellValue } from "../../../../src/plugins/spreadsheet/engine/types.ts";

/** The raw computed value of a formula, before the display pass turns an error
 *  back into its code — this is where provenance is observable. */
const evaluateRaw: (formula: string) => CellValue = (formula) =>
  evaluateFormula(formula, {
    getCellValue: () => 0,
    getRangeValues: () => [],
    evaluateFormula: evaluateRaw,
  });

/** What a single-formula sheet DISPLAYS, through the public engine API. */
const displayed = (formula: string): CellValue => new SpreadsheetEngine().calculate({ name: "S", data: [[{ v: formula }]] } satisfies SheetData).data[0][0];

describe("the error value and its guard", () => {
  it("recognises an error value and rejects a string that spells the same code", () => {
    assert.equal(isSpreadsheetErrorValue(NUM_ERROR), true);
    assert.equal(isSpreadsheetErrorValue("#NUM!"), false);
    assert.equal(isSpreadsheetErrorValue(0), false);
    assert.equal(isSpreadsheetErrorValue(null), false);
  });

  it("carries the code and renders as it when coerced to text", () => {
    assert.equal(NUM_ERROR.code, "#NUM!");
    assert.equal(String(NUM_ERROR), "#NUM!");
    assert.equal(`${DIV_ZERO_ERROR}`, "#DIV/0!");
  });

  it("hands out one instance per code, so two errors of a kind compare equal", () => {
    const fromLookup = spreadsheetError("#N/A");
    const fromLookupAgain = spreadsheetError("#N/A");
    assert.equal(fromLookup, NA_ERROR);
    assert.equal(fromLookup === fromLookupAgain, true);
    assert.equal(NA_ERROR instanceof SpreadsheetError, true);
  });

  it("serializes to its code rather than to an empty object", () => {
    assert.equal(JSON.stringify({ cell: NUM_ERROR }), '{"cell":"#NUM!"}');
  });
});

describe("isErrorResult keys off the value, not the text", () => {
  it("catches an error value", () => {
    assert.equal(isErrorResult(NUM_ERROR), true);
    assert.equal(isErrorResult(DIV_ZERO_ERROR), true);
  });

  it("still catches NaN / infinity / missing", () => {
    assert.equal(isErrorResult(NaN), true);
    assert.equal(isErrorResult(Infinity), true);
    assert.equal(isErrorResult(null), true);
  });

  it("does NOT catch a look-alike string — the whole point of #2451", () => {
    assert.equal(isErrorResult("#NUM!"), false);
    assert.equal(isErrorResult("#N/A"), false);
  });
});

describe("the display pass renders an error value to its code", () => {
  it("returns the code for a formula cell", () => {
    assert.equal(formatCellForDisplay({ v: "=SQRT(-1)" }, NUM_ERROR, false), "#NUM!");
  });

  it("returns the code regardless of the cell's format code", () => {
    assert.equal(formatCellForDisplay({ v: "=A1/A2", f: "$#,##0.00" }, DIV_ZERO_ERROR, false), "#DIV/0!");
  });

  it("leaves ordinary values alone", () => {
    assert.equal(formatCellForDisplay({ v: "=1+1" }, 2, false), 2);
    assert.equal(formatCellForDisplay({ v: "text" }, "text", false), "text");
  });
});

describe("functions return an error VALUE, and the cell still shows its code", () => {
  it("SQRT(-1) computes to the #NUM! value", () => {
    const value = evaluateRaw("SQRT(-1)");
    assert.equal(isSpreadsheetErrorValue(value), true);
    assert.equal(value, NUM_ERROR);
  });

  it("MOD(5, 0) computes to the #DIV/0! value", () => {
    assert.equal(evaluateRaw("MOD(5, 0)"), DIV_ZERO_ERROR);
  });

  it("computed text that spells an error stays a plain string", () => {
    const value = evaluateRaw('CONCAT("#N","UM!")');
    assert.equal(isSpreadsheetErrorValue(value), false);
    assert.equal(value, "#NUM!");
  });

  it("displays the same codes end-to-end as before the refactor", () => {
    assert.equal(displayed("=SQRT(-1)"), "#NUM!");
    assert.equal(displayed("=MOD(5, 0)"), "#DIV/0!");
    assert.equal(displayed("=1/0"), "#DIV/0!");
    assert.equal(displayed('=DATEDIF(45000, 44000, "D")'), "#NUM!");
    assert.equal(displayed('=VALUE("abc")'), "#VALUE!");
  });

  it("propagates an error VALUE through a reference and shows the code", () => {
    const sheet: SheetData = { name: "S", data: [[{ v: "=SQRT(-1)" }, { v: "=A1+1" }]] };
    assert.equal(new SpreadsheetEngine().calculate(sheet).data[0][1], "#NUM!");
  });
});

describe("IFERROR keys off provenance", () => {
  it("catches a real error", () => {
    assert.equal(displayed("=IFERROR(SQRT(-1), 42)"), 42);
    assert.equal(displayed("=IFERROR(MOD(5, 0), -1)"), -1);
  });

  it("passes a non-error through untouched", () => {
    assert.equal(displayed("=IFERROR(SQRT(4), 42)"), 2);
    assert.equal(displayed('=IFERROR("hello", 42)'), "hello");
  });

  it("does not catch a quoted literal that only looks like an error", () => {
    assert.equal(displayed('=IFERROR("#NUM!", 42)'), "#NUM!");
  });

  // THE headline case. Before #2451 this returned 42: the computed text was
  // indistinguishable from a real #NUM!, so IFERROR swallowed it.
  it("does not catch COMPUTED text that spells an error", () => {
    assert.equal(displayed('=IFERROR(CONCAT("#N","UM!"), 42)'), "#NUM!");
    assert.equal(displayed('=IFERROR(CONCATENATE("#DIV/", "0!"), 42)'), "#DIV/0!");
  });

  it("does not catch an error-looking string built with the & operator", () => {
    assert.equal(displayed('=IFERROR("#N" & "UM!", 42)'), "#NUM!");
  });

  it("still catches an error that reaches it through arithmetic", () => {
    assert.equal(displayed("=IFERROR(SQRT(-1) + 1, 42)"), 42);
  });
});

describe("IFNA keys off the error value's code", () => {
  it("substitutes the fallback for a real #N/A", () => {
    const sheet: SheetData = { name: "S", data: [[{ v: 1 }, { v: '=IFNA(MATCH(99, A1:A1, 0), "missing")' }]] };
    assert.equal(new SpreadsheetEngine().calculate(sheet).data[0][1], "missing");
  });

  it("leaves a different error alone", () => {
    assert.equal(displayed('=IFNA(SQRT(-1), "missing")'), "#NUM!");
  });

  it("does not substitute for text that merely spells #N/A", () => {
    assert.equal(displayed('=IFNA("#N/A", "missing")'), "#N/A");
    assert.equal(displayed('=IFNA(CONCAT("#N", "/A"), "missing")'), "#N/A");
  });

  it("passes an ordinary value through", () => {
    assert.equal(displayed('=IFNA(7, "missing")'), 7);
  });
});
