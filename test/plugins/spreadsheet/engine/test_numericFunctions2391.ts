// The four #2391 scenarios end-to-end through the engine, plus pins that the
// out-of-scope lenient aggregation paths (SUM / AVERAGE over text) are unchanged
// (those blanks-as-0 cases belong to #2383, not this PR).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetEngine, type SheetData } from "../../../../src/plugins/spreadsheet/engine/index.ts";

// Column A holds `colA` (one value per row); `formula` goes in a row below it so a
// range like A1:A3 never overlaps the formula cell.
const evalWithColumnA = (formula: string, colA: (string | number)[] = []): unknown => {
  const data: { v: string | number }[][] = colA.map((value) => [{ v: value }]);
  data.push([{ v: formula }]);
  const result = new SpreadsheetEngine().calculate({ name: "S", data } as SheetData);
  return result.data[data.length - 1][0];
};

describe("ABS / SIGN — scalar coercion (#2391)", () => {
  it("reads a logical argument as 1 / 0 (was 0)", () => {
    assert.equal(evalWithColumnA("=ABS(TRUE())"), 1);
    assert.equal(evalWithColumnA("=ABS(FALSE())"), 0);
    assert.equal(evalWithColumnA("=SIGN(TRUE())"), 1);
  });

  it("returns #VALUE! for non-numeric text (was 0)", () => {
    assert.equal(evalWithColumnA('=ABS("abc")'), "#VALUE!");
    assert.equal(evalWithColumnA('=SIGN("abc")'), "#VALUE!");
  });

  it("errors when the argument cell holds text", () => {
    assert.equal(evalWithColumnA("=ABS(A1)", ["abc"]), "#VALUE!");
  });

  it("still works for ordinary numbers", () => {
    assert.equal(evalWithColumnA("=ABS(-5)"), 5);
    assert.equal(evalWithColumnA("=SIGN(-5)"), -1);
    assert.equal(evalWithColumnA("=ABS(A1)", [-42]), 42);
  });
});

describe("MODE — no repeat is #N/A (#2391)", () => {
  it("returns #N/A when every value is distinct (was the first value)", () => {
    assert.equal(evalWithColumnA("=MODE(A1:A3)", [1, 2, 3]), "#N/A");
  });

  it("still returns the most frequent value when one repeats", () => {
    assert.equal(evalWithColumnA("=MODE(A1:A4)", [1, 2, 2, 3]), 2);
  });
});

describe("AVERAGEIF — no match is #DIV/0! (#2391)", () => {
  it("returns #DIV/0! when nothing matches (was 0)", () => {
    assert.equal(evalWithColumnA('=AVERAGEIF(A1:A3,">100")', [1, 2, 3]), "#DIV/0!");
  });

  it("still averages the matching cells", () => {
    assert.equal(evalWithColumnA('=AVERAGEIF(A1:A3,">1")', [1, 2, 3]), 2.5);
  });
});

describe("out-of-scope lenient paths stay unchanged (#2383, not this PR)", () => {
  // A text cell inside a SUM range leaves the total unchanged (30, not #VALUE!) —
  // the aggregation path keeps its lenient reading. This PR must not touch it.
  it("SUM leaves a text cell out of the total", () => {
    assert.equal(evalWithColumnA("=SUM(A1:A3)", [10, "abc", 20]), 30);
  });

  it("AVERAGE over numeric cells is unaffected", () => {
    assert.equal(evalWithColumnA("=AVERAGE(A1:A3)", [10, 20, 30]), 20);
  });
});
