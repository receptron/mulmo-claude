// Aggregates over more than one argument. Excel takes up to 255 (`SUM(A1:A2,
// B1:B2)`, `SUM(A1:A2, 10)`), but eight of these functions were registered with
// `maxArgs: 1` and read only `args[0]`, so the second range made the whole
// formula fail — a loud `#ERROR!` on ordinary spreadsheet usage (#2360).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetEngine, type SheetData } from "../../../../src/plugins/spreadsheet/engine/index.ts";

// A = 1,2 ; B = 3,4 ; the formula sits in C1.
const evaluate = (formula: string): unknown => {
  const sheet: SheetData = {
    name: "S",
    data: [
      [{ v: 1 }, { v: 3 }, { v: formula }],
      [{ v: 2 }, { v: 4 }],
    ],
  };
  return new SpreadsheetEngine().calculate(sheet).data[0][2];
};

describe("aggregates accept several ranges", () => {
  it("sums two ranges", () => {
    assert.equal(evaluate("=SUM(A1:A2,B1:B2)"), 10);
  });

  it("averages across two ranges", () => {
    assert.equal(evaluate("=AVERAGE(A1:A2,B1:B2)"), 2.5);
  });

  it("counts numbers across two ranges", () => {
    assert.equal(evaluate("=COUNT(A1:A2,B1:B2)"), 4);
  });

  it("counts non-empty cells across two ranges", () => {
    assert.equal(evaluate("=COUNTA(A1:A2,B1:B2)"), 4);
  });

  it("takes the median across two ranges", () => {
    assert.equal(evaluate("=MEDIAN(A1:A2,B1:B2)"), 2.5);
  });
});

describe("aggregates mix ranges with plain values", () => {
  it("sums a range plus a literal", () => {
    assert.equal(evaluate("=SUM(A1:A2,10)"), 13);
  });

  it("sums a range plus a single cell reference", () => {
    assert.equal(evaluate("=SUM(A1:A2,B1)"), 6);
  });
});

describe("a single cell reference is read as a range, not a scalar", () => {
  // The scalar path coerces a blank or text cell to 0, so COUNT(A999) counted an
  // empty cell as a value once multi-argument collection was introduced (Codex
  // review). A bare cell ref goes through the range path instead.
  const countSheet = (formula: string): unknown => {
    const sheet: SheetData = {
      name: "S",
      data: [[{ v: 5 }, { v: formula }], [{ v: "txt" }]],
    };
    return new SpreadsheetEngine().calculate(sheet).data[0][1];
  };

  it("does not count an out-of-bounds cell", () => {
    assert.equal(countSheet("=COUNT(A999)"), 0);
    assert.equal(countSheet("=COUNTA(A999)"), 0);
  });

  it("does not count a text cell as a number", () => {
    assert.equal(countSheet("=COUNT(A2)"), 0);
    assert.equal(countSheet("=COUNTA(A2)"), 1, "COUNTA does count text");
  });

  it("counts a single numeric cell", () => {
    assert.equal(countSheet("=COUNT(A1)"), 1);
  });
});

describe("COUNT counts only the arguments that hold a number", () => {
  // Multi-argument collection reads a non-reference argument as a scalar, and the
  // lenient `toNumber` turns anything unreadable into 0 — so every scalar looked
  // like a value and COUNT("text") answered 1 (Codex review). Excel and the
  // pre-change engine both answer 0.
  it("does not count a text literal", () => {
    assert.equal(evaluate('=COUNT("text")'), 0);
  });

  it("counts the numbers and skips the text when both are given", () => {
    assert.equal(evaluate('=COUNT(1,"text")'), 1);
    assert.equal(evaluate('=COUNT(A1:A2,"text")'), 2);
  });

  it("counts a number typed directly, quoted, or computed", () => {
    assert.equal(evaluate("=COUNT(1)"), 1);
    assert.equal(evaluate('=COUNT("1")'), 1, "Excel counts a quoted number typed as an argument");
    assert.equal(evaluate("=COUNT(1+1)"), 1);
  });

  // Excel counts a logical typed directly as an argument; this engine has PINNED
  // booleans as non-numbers throughout (`toNumber(true)` is 0, see #2391), so
  // COUNT follows the engine rather than splitting the difference.
  it("does not count a logical literal", () => {
    assert.equal(evaluate("=COUNT(TRUE)"), 0);
    assert.equal(evaluate("=COUNT(FALSE)"), 0);
  });

  // Excel reads "12abc" as text and answers 0. The engine's shared numeric parser
  // reads the leading number everywhere (SUM(1,"12abc") is 13), so COUNT stays
  // consistent with the engine instead.
  it("counts a leading-number string, as the rest of the engine reads it", () => {
    assert.equal(evaluate('=COUNT("12abc")'), 1);
  });

  it("leaves the lenient aggregates coercing as before", () => {
    assert.equal(evaluate('=SUM(1,"text")'), 1);
    assert.equal(evaluate('=AVERAGE(1,"text")'), 0.5);
  });

  it("still lets COUNTA count a text literal", () => {
    assert.equal(evaluate('=COUNTA(1,"text")'), 2);
    assert.equal(evaluate('=COUNTA("")'), 0);
  });
});

describe("the single-range behaviour is unchanged", () => {
  it("sums, averages and counts one range as before", () => {
    assert.equal(evaluate("=SUM(A1:A2)"), 3);
    assert.equal(evaluate("=AVERAGE(A1:A2)"), 1.5);
    assert.equal(evaluate("=COUNT(A1:A2)"), 2);
  });
});
