// SUMIF / AVERAGEIF must pair the criteria range and the value range by
// POSITION. Reading the value range in numeric-only mode dropped blanks, which
// shifted its indexes out of step with the (raw) criteria range and pulled a
// later row's number into an earlier match (#2358 Codex review).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetEngine, type SheetData } from "../../../../src/plugins/spreadsheet/engine/index.ts";

// A = criteria column, B = value column (with a blank at row 2), formula in C1.
const sheet = (formula: string): SheetData => ({
  name: "S",
  data: [
    [{ v: 1 }, { v: 100 }, { v: formula }],
    [{ v: 0 }, { v: "" }],
    [{ v: 1 }, { v: 300 }],
  ],
});

const evalFormula = (formula: string): unknown => new SpreadsheetEngine().calculate(sheet(formula)).data[0][2];

describe("SUMIF / AVERAGEIF stay row-aligned when the value range has a blank", () => {
  // Rows 1 and 3 match (A > 0); their B values are 100 and 300. The blank B2
  // belongs to the non-matching row 2 and must not slide up into row 3.
  it("sums the value range by position, not by compacted index", () => {
    assert.equal(evalFormula('=SUMIF(A1:A3, ">0", B1:B3)'), 400);
  });

  it("averages the matching rows' values by position", () => {
    assert.equal(evalFormula('=AVERAGEIF(A1:A3, ">0", B1:B3)'), 200);
  });

  // A blank inside the matched rows counts as 0 in SUMIF (not skipped), matching
  // Excel: here rows 1 and 3 match, B1 is blank, so the sum is just 300.
  it("treats a blank in a matched value cell as 0", () => {
    const withBlankMatch: SheetData = {
      name: "S",
      data: [
        [{ v: 1 }, { v: "" }, { v: '=SUMIF(A1:A3, ">0", B1:B3)' }],
        [{ v: 0 }, { v: 999 }],
        [{ v: 1 }, { v: 300 }],
      ],
    };
    assert.equal(new SpreadsheetEngine().calculate(withBlankMatch).data[0][2], 300);
  });
});
