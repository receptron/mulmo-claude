// STDEV / VAR through the whole engine (#2360). Excel's STDEV / VAR are the
// SAMPLE estimators (divide by n-1); the engine used to divide by n, which is
// the POPULATION estimator (Excel's STDEVP / VARP) — a silent wrong answer.
// A single value has no n-1 to divide by, so Excel reports #DIV/0!.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetEngine } from "../../../../src/plugins/spreadsheet/engine/index.ts";

/** Calculate `formula` in the cell just below a single column of `values`. */
const evalOverColumn = (values: (string | number)[], formula: string): unknown => {
  const data: { v: string | number }[][] = values.map((value) => [{ v: value }]);
  data.push([{ v: formula }]);
  const result = new SpreadsheetEngine().calculate({ name: "S", data });
  return result.data[data.length - 1][0];
};

// {2,4,4,4,5,5,7,9}: mean 5, Σ(x-μ)² = 32.
// Sample:     32 / (8-1) = 4.5714… → stdev 2.1380…
// Population: 32 / 8      = 4       → stdev 2.0 (the old wrong answer).
const SAMPLE_VALUES = [2, 4, 4, 4, 5, 5, 7, 9];

describe("STDEV — sample estimator (#2360)", () => {
  it("divides by n-1, not n", () => {
    const result = evalOverColumn(SAMPLE_VALUES, "=STDEV(A1:A8)");
    assert.equal(typeof result, "number");
    assert.ok(Math.abs((result as number) - 2.138089935) < 1e-6, `expected ~2.1381 sample stdev, got ${result}`);
  });

  it("returns #DIV/0! for a single value (no n-1 to divide by)", () => {
    assert.equal(evalOverColumn([42], "=STDEV(A1:A1)"), "#DIV/0!");
  });
});

describe("VAR — sample estimator (#2360)", () => {
  it("divides by n-1, not n", () => {
    const result = evalOverColumn(SAMPLE_VALUES, "=VAR(A1:A8)");
    assert.equal(typeof result, "number");
    assert.ok(Math.abs((result as number) - 32 / 7) < 1e-9, `expected 32/7 sample variance, got ${result}`);
  });

  it("returns #DIV/0! for a single value", () => {
    assert.equal(evalOverColumn([42], "=VAR(A1:A1)"), "#DIV/0!");
  });
});

// A range holding no numbers is not a range of zeros. AVERAGE and MEDIAN used
// to answer 0 for it, which reads like a genuine result (#2360). MAX / MIN /
// SUM / COUNT are NOT part of this: Excel really does answer 0 there.

const BLANKS = ["", "", ""];
const TEXTS = ["apple", "banana", "cherry"];

describe("AVERAGE — no numbers to average is #DIV/0! (#2360)", () => {
  it("returns #DIV/0! for an all-blank range", () => {
    assert.equal(evalOverColumn(BLANKS, "=AVERAGE(A1:A3)"), "#DIV/0!");
  });

  it("returns #DIV/0! for a text-only range (Excel ignores text)", () => {
    assert.equal(evalOverColumn(TEXTS, "=AVERAGE(A1:A3)"), "#DIV/0!");
  });

  it("still averages when at least one number is present", () => {
    assert.equal(evalOverColumn(["", 10, 20], "=AVERAGE(A1:A3)"), 15);
  });

  it("is an error VALUE, so IFERROR catches it", () => {
    assert.equal(evalOverColumn(BLANKS, "=IFERROR(AVERAGE(A1:A3), 99)"), 99);
  });
});

describe("MEDIAN — no numbers has no middle, so #NUM! (#2360)", () => {
  it("returns #NUM! for an all-blank range", () => {
    assert.equal(evalOverColumn(BLANKS, "=MEDIAN(A1:A3)"), "#NUM!");
  });

  it("returns #NUM! for a text-only range", () => {
    assert.equal(evalOverColumn(TEXTS, "=MEDIAN(A1:A3)"), "#NUM!");
  });

  it("still takes the median when numbers are present", () => {
    assert.equal(evalOverColumn([3, 1, 2], "=MEDIAN(A1:A3)"), 2);
    assert.equal(evalOverColumn(["", 1, 3], "=MEDIAN(A1:A3)"), 2, "blanks are ignored, not averaged in as 0");
  });

  it("is an error VALUE, so IFERROR catches it", () => {
    assert.equal(evalOverColumn(BLANKS, "=IFERROR(MEDIAN(A1:A3), 99)"), 99);
  });
});

// Excel's own boundary for these four is 0, so the engine's 0 is correct and
// must NOT be "fixed" into an error.
describe("MAX / MIN / SUM / COUNT over an empty range stay 0 (Excel agrees)", () => {
  it("answers 0 rather than an error", () => {
    assert.equal(evalOverColumn(BLANKS, "=MAX(A1:A3)"), 0);
    assert.equal(evalOverColumn(BLANKS, "=MIN(A1:A3)"), 0);
    assert.equal(evalOverColumn(BLANKS, "=SUM(A1:A3)"), 0);
    assert.equal(evalOverColumn(BLANKS, "=COUNT(A1:A3)"), 0);
  });
});
