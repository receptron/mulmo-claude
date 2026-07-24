// Failed formulas must surface as TYPED errors with an Excel-style error value in
// the cell — not silently become a bare string or a wrong number with an empty
// errors[] (issue #2359). The root cause was the over-broad top-level catch in
// evaluateFormula, which meant the function never threw, so calculator.ts's
// per-cell catch was unreachable and only "circular" was ever recorded.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetEngine, type SheetData, type CalculatedSheet } from "../../../../src/plugins/spreadsheet/engine/index.ts";

const calc = (sheet: SheetData, all?: SheetData[]): CalculatedSheet => new SpreadsheetEngine().calculate(sheet, all ?? [sheet]);

/** The single formula cell's value and the error type recorded for it, if any. */
function cellAndError(sheet: SheetData, row: number, col: number, all?: SheetData[]) {
  const result = calc(sheet, all);
  const entry = result.errors.find((err) => err.cell.row === row && err.cell.col === col);
  return { value: result.data[row][col], errorType: entry?.type };
}

describe("#2359 typed error reporting", () => {
  it("div_zero: =1/0 becomes #DIV/0!, not Infinity", () => {
    const { value, errorType } = cellAndError({ name: "S", data: [[{ v: "=1/0" }]] }, 0, 0);
    assert.equal(value, "#DIV/0!");
    assert.equal(errorType, "div_zero");
  });

  it("div_zero: a reference division by zero (=A1/A2, 10/0) is #DIV/0!", () => {
    const sheet: SheetData = { name: "S", data: [[{ v: 10 }], [{ v: 0 }], [{ v: "=A1/A2" }]] };
    const { value, errorType } = cellAndError(sheet, 2, 0);
    assert.equal(value, "#DIV/0!");
    assert.equal(errorType, "div_zero");
  });

  it("invalid_ref: a reference to a missing sheet is #REF!", () => {
    const sheet: SheetData = { name: "S", data: [[{ v: "=Missing!A1" }]] };
    const { value, errorType } = cellAndError(sheet, 0, 0);
    assert.equal(value, "#REF!");
    assert.equal(errorType, "invalid_ref");
  });

  it("syntax: an unknown function is #NAME?, not a processed string", () => {
    const sheet: SheetData = { name: "S", data: [[{ v: 7 }, { v: "=UNKNOWNFN(A1)" }]] };
    const { value, errorType } = cellAndError(sheet, 0, 1);
    assert.equal(value, "#NAME?");
    assert.equal(errorType, "syntax");
  });

  it("unknown: a handler that throws (SUM over two ranges) is #ERROR!, not the formula text", () => {
    const sheet: SheetData = {
      name: "S",
      data: [
        [{ v: 1 }, { v: 10 }, { v: "=SUM(A1:A5,B1:B5)" }],
        [{ v: 2 }, { v: 20 }],
        [{ v: 3 }, { v: 30 }],
        [{ v: 4 }, { v: 40 }],
        [{ v: 5 }, { v: 50 }],
      ],
    };
    const { value, errorType } = cellAndError(sheet, 0, 2);
    assert.equal(value, "#ERROR!");
    assert.equal(errorType, "unknown");
  });

  it("propagates an error through an arithmetic reference (=A1+1 where A1 is #DIV/0!)", () => {
    const sheet: SheetData = { name: "S", data: [[{ v: "=1/0" }, { v: "=A1+1" }]] };
    const { value, errorType } = cellAndError(sheet, 0, 1);
    assert.equal(value, "#DIV/0!", "must not become the bare string 'Infinity+1'");
    assert.equal(errorType, "div_zero");
  });

  it("a failed formula never lands in the cell as a bare string", () => {
    const formulas = ["=1/0", "=UNKNOWNFN(A1)", "=SUM(A1:A5,B1:B5)"];
    for (const formula of formulas) {
      const [[value]] = calc({ name: "S", data: [[{ v: formula }]] }).data;
      assert.equal(typeof value === "string" && value.startsWith("#"), true, `${formula} → ${JSON.stringify(value)} should be an # error value`);
    }
  });
});

describe("#2359 success paths are preserved", () => {
  it("keeps circular-reference detection working", () => {
    const sheet: SheetData = { name: "S", data: [[{ v: "=B1+1" }, { v: "=A1+1" }]] };
    const result = calc(sheet);
    assert.equal(
      result.errors.some((err) => err.type === "circular"),
      true,
    );
  });

  it("=ZZ999 (an empty in-bounds cell) stays 0 and is NOT an error", () => {
    const { value, errorType } = cellAndError({ name: "S", data: [[{ v: "=ZZ999" }]] }, 0, 0);
    assert.equal(value, 0);
    assert.equal(errorType, undefined);
  });

  it("valid SUM and arithmetic are unaffected", () => {
    assert.equal(calc({ name: "S", data: [[{ v: 1 }, { v: "=SUM(A1:A3)" }], [{ v: 2 }], [{ v: 3 }]] }).data[0][1], 6);
    assert.equal(calc({ name: "S", data: [[{ v: 2 }], [{ v: 3 }], [{ v: "=A1+A2" }]] }).data[2][0], 5);
  });

  it("a valid cross-sheet reference still resolves", () => {
    const data: SheetData = { name: "Data", data: [[{ v: 100 }]] };
    const summary: SheetData = { name: "Summary", data: [[{ v: "=Data!A1*2" }]] };
    assert.equal(calc(summary, [data, summary]).data[0][0], 200);
  });
});
