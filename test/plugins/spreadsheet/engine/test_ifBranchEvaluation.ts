// What IF does with the branch it picks. Both bugs here returned a plausible
// value instead of an error, so a sheet looked fine while holding wrong data:
// a hard-coded list of nine function names meant every OTHER nested call came
// back as its own text (`ROUND(A1,1)` → the string "ROUND(4.567,1)" — IF's own
// registered example did not work), and the fallback read an arithmetic branch
// through `parseFloat("3+1")`, yielding 3 (#2360).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetEngine, type SheetData } from "../../../../src/plugins/spreadsheet/engine/index.ts";

const evaluate = (rows: (string | number)[][], row: number, col: number): unknown => {
  const sheet: SheetData = { name: "S", data: rows.map((cells) => cells.map((value) => ({ v: value }))) };
  return new SpreadsheetEngine().calculate(sheet).data[row][col];
};

describe("IF evaluates a nested function branch, whatever the function", () => {
  // ROUND was outside the old whitelist, so this returned "ROUND(4.567,1)".
  it("evaluates a function that the old whitelist omitted", () => {
    assert.equal(evaluate([[4.567, "=IF(A1>0, ROUND(A1,1), 0)"]], 0, 1), 4.6);
  });

  it("evaluates a text function branch", () => {
    assert.equal(evaluate([["hi", '=IF(TRUE, UPPER(A1), "x")']], 0, 1), "HI");
  });

  it("still evaluates the functions the whitelist did cover", () => {
    assert.equal(evaluate([[1, "=IF(A1>0, SUM(A1:A1), 0)"]], 0, 1), 1);
  });

  it("evaluates a nested IF", () => {
    assert.equal(evaluate([[5, '=IF(A1>10, "big", IF(A1>3, "mid", "small"))']], 0, 1), "mid");
  });

  it("takes the false branch without evaluating the true one", () => {
    assert.equal(evaluate([[0, "=IF(A1>0, ROUND(9.99,1), 0)"]], 0, 1), 0);
  });
});

describe("IF evaluates an arithmetic branch", () => {
  // The fallback substituted refs then called parseFloat, which stops at the
  // operator: parseFloat("3+1") is 3.
  it("computes a reference plus a literal", () => {
    assert.equal(evaluate([[3, "=IF(A1>0, A1+1, 0)"]], 0, 1), 4);
  });

  it("returns a bare reference's value", () => {
    assert.equal(evaluate([[7, 0, "=IF(A1>0, A1, B1)"]], 0, 2), 7);
  });

  it("returns a numeric literal branch", () => {
    assert.equal(evaluate([[3, "=IF(A1>0, 42, 0)"]], 0, 1), 42);
  });
});

describe("IF still unwraps a quoted string branch", () => {
  it("returns the text without its quotes", () => {
    assert.equal(evaluate([[3, '=IF(A1>0, "yes", "no")']], 0, 1), "yes");
  });
});
