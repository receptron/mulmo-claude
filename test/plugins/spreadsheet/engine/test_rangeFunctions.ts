// Range-consuming functions through the whole engine. `expandRangeOrCell` is
// unit-tested on its own; this drives the shapes that used to return 0 with no
// error — the failure that is invisible because 0 is a plausible answer (#2356).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetEngine, type SheetData } from "../../../../src/plugins/spreadsheet/engine/index.ts";

/** A single column of numbers with `formula` beside the first cell. */
const column = (values: number[], formula: string): SheetData => ({
  name: "S",
  data: values.map((value, index) => (index === 0 ? [{ v: value }, { v: formula }] : [{ v: value }])),
});

const result = (values: number[], formula: string): unknown => new SpreadsheetEngine().calculate(column(values, formula)).data[0][1];

describe("range references that used to return 0", () => {
  it("sums an absolute range", () => {
    assert.equal(result([10, 20, 30], "=SUM($A$1:$A$3)"), 60);
  });

  it("sums a lowercase range", () => {
    assert.equal(result([10, 20, 30], "=sum(a1:a3)"), 60);
  });

  it("sums a single-cell argument", () => {
    assert.equal(result([42], "=SUM(A1)"), 42);
  });

  // MAX/MIN took a different path already, so they worked where SUM did not.
  // The two must agree now that both go through the same expansion.
  it("makes SUM and MAX agree on a single cell", () => {
    assert.equal(result([42], "=SUM(A1)"), result([42], "=MAX(A1)"));
  });
});

describe("range functions over an absolute range", () => {
  it("averages, counts and finds extremes", () => {
    assert.equal(result([10, 20, 30], "=AVERAGE($A$1:$A$3)"), 20);
    assert.equal(result([10, 20, 30], "=COUNT($A$1:$A$3)"), 3);
    assert.equal(result([10, 20, 30], "=MAX($A$1:$A$3)"), 30);
    assert.equal(result([10, 20, 30], "=MIN($A$1:$A$3)"), 10);
  });
});
