// #2397: the handler-side `if (args.length ...) throw` guards were removed for
// every function whose arity is fully expressed by the registry minArgs/maxArgs.
// The evaluator (evaluator.ts) validates arity from the registry BEFORE calling
// the handler, so those guards were unreachable dead code with a divergent
// message ("requires N" vs the evaluator's "requires at least N").
//
// These tests pin that (a) invalid arity now surfaces the evaluator's single
// consistent message for the removed-guard functions — including the financial
// handlers, whose only remaining validation is the evaluator after #2394/#2442 —
// and (b) the shapes the registry CANNOT express keep their handler guard: IFS's
// even-count requirement and IRR's empty-range check.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetEngine, type SheetData, type CellValue } from "../../../../src/plugins/spreadsheet/engine/index.ts";

/** Calculate `sheet` and report the value, error type, and recorded message for
 *  the cell at (row, col). */
function cellResult(sheet: SheetData, row: number, col: number): { value: CellValue; type?: string; message?: string } {
  const result = new SpreadsheetEngine().calculate(sheet);
  const entry = result.errors.find((err) => err.cell.row === row && err.cell.col === col);
  return { value: result.data[row][col], type: entry?.type, message: entry?.error };
}

/** A one-cell sheet holding `formula` at A1 (for formulas that need no other cells). */
const soleFormula = (formula: string) => cellResult({ name: "S", data: [[{ v: formula }]] }, 0, 0);

describe("#2397 removed handler guards — arity now enforced by the evaluator", () => {
  it("too few args surfaces the evaluator's 'requires at least N' message (not the handler's)", () => {
    const { value, type, message } = soleFormula("=ROUND(1)");
    assert.equal(value, "#ERROR!");
    assert.equal(type, "unknown");
    assert.equal(message, "ROUND requires at least 2 arguments");
  });

  it("too many args surfaces the evaluator's 'accepts at most N' message", () => {
    const { value, type, message } = soleFormula("=ROUND(1, 2, 3)");
    assert.equal(value, "#ERROR!");
    assert.equal(type, "unknown");
    assert.equal(message, "ROUND accepts at most 2 arguments");
  });

  it("singular wording for a one-argument bound (ABS accepts at most 1 argument)", () => {
    assert.equal(soleFormula("=ABS(1, 2)").message, "ABS accepts at most 1 argument");
  });

  it("singular wording for a one-argument minimum (UPPER requires at least 1 argument)", () => {
    assert.equal(soleFormula("=UPPER()").message, "UPPER requires at least 1 argument");
  });

  it("a zero-arg function rejects any argument (PI accepts at most 0 arguments)", () => {
    assert.equal(soleFormula("=PI(1)").message, "PI accepts at most 0 arguments");
  });

  // Financial handlers used to carry the ONLY validation (IPMT/PPMT once called
  // pmtHandler/fvHandler directly). After #2394/#2442 they call the pure
  // computeIpmt/computePpmt and are reached only through the evaluator, so the
  // evaluator is now their sole arity gate.
  it("financial: FV too few args is the evaluator error (handler no longer guards)", () => {
    assert.equal(soleFormula("=FV(0.05, 10)").message, "FV requires at least 3 arguments");
  });

  it("financial: IPMT too many args is the evaluator error", () => {
    assert.equal(soleFormula("=IPMT(0.05, 1, 10, 1000, 0, 0, 9)").message, "IPMT accepts at most 6 arguments");
  });
});

describe("#2397 SUMIF / AVERAGEIF — arity fully expressed by registry [2,3], enforced by evaluator", () => {
  // Formula in C1 so it never self-references the A/B ranges it reads.
  const withData = (formula: string): SheetData => ({
    name: "S",
    data: [
      [{ v: 1 }, { v: 10 }, { v: formula }],
      [{ v: 2 }, { v: 20 }],
      [{ v: 3 }, { v: 30 }],
    ],
  });

  it("SUMIF with 1 arg is rejected with the consistent 'at least 2' message", () => {
    const { value, message } = cellResult(withData("=SUMIF(A1:A3)"), 0, 2);
    assert.equal(value, "#ERROR!");
    assert.equal(message, "SUMIF requires at least 2 arguments");
  });

  it("SUMIF with 4 args is rejected with the consistent 'at most 3' message", () => {
    const { value, message } = cellResult(withData('=SUMIF(A1:A3, ">0", B1:B3, C1)'), 0, 2);
    assert.equal(value, "#ERROR!");
    assert.equal(message, "SUMIF accepts at most 3 arguments");
  });

  it("AVERAGEIF with 4 args is rejected by the evaluator", () => {
    assert.equal(cellResult(withData('=AVERAGEIF(A1:A3, ">0", B1:B3, C1)'), 0, 2).message, "AVERAGEIF accepts at most 3 arguments");
  });

  it("a valid 3-arg SUMIF still computes", () => {
    assert.equal(cellResult(withData('=SUMIF(A1:A3, ">1", B1:B3)'), 0, 2).value, 50);
  });
});

describe("#2397 kept guards — shapes the registry cannot express", () => {
  // IFS is minArgs:2 with no maxArgs; the EVEN-count requirement is inexpressible
  // by min/max, so the handler guard stays. This is the red-on-break target: if
  // the guard is removed, a 3-arg IFS no longer reports this arity error.
  it("IFS with an odd number of args is rejected by the kept handler guard", () => {
    const sheet: SheetData = { name: "S", data: [[{ v: 5 }, { v: 0 }, { v: "=IFS(A1>0, 1, A1>5)" }]] };
    const { value, type, message } = cellResult(sheet, 0, 2);
    assert.equal(value, "#ERROR!");
    assert.equal(type, "unknown");
    assert.equal(message, "IFS requires an even number of arguments (condition-value pairs)");
  });

  it("a valid even-arg IFS still returns the matched value", () => {
    const sheet: SheetData = { name: "S", data: [[{ v: 5 }, { v: '=IFS(A1>0, "yes")' }]] };
    assert.equal(cellResult(sheet, 0, 1).value, "yes");
  });

  // IRR is minArgs:1/maxArgs:2 — its arg-count guard was removed — but the
  // "at least one numeric value in the range" rule is not an arg count and is
  // kept. D1:D3 is an empty range, so the kept guard fires.
  it("IRR over an empty range is rejected by the kept empty-range guard", () => {
    const sheet: SheetData = { name: "S", data: [[{ v: 1 }, { v: 2 }, { v: 3 }, { v: "=IRR(F1:F3)" }]] };
    const { value, type, message } = cellResult(sheet, 0, 3);
    assert.equal(value, "#ERROR!");
    assert.equal(type, "unknown");
    assert.equal(message, "IRR requires at least one value");
  });
});
