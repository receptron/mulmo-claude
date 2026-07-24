// NPV through the whole engine. The #2390 bug used each value's ARGUMENT index
// as its discount period, so a scalar after a range was discounted too little:
// NPV(0.1, A1:A3, 500) put 500 at period 2 instead of period 4. The period must
// count flattened values, not arguments.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetEngine } from "../../../../src/plugins/spreadsheet/engine/index.ts";

const closeTo = (actual: unknown, expected: number, eps = 1e-6): boolean => typeof actual === "number" && Math.abs(actual - expected) <= eps;

describe("NPV — range followed by a scalar (#2390)", () => {
  it("discounts the trailing scalar at period 4, not period 2", () => {
    const sheet = {
      name: "S",
      data: [[{ v: 100 }], [{ v: 200 }], [{ v: 300 }], [{ v: "=NPV(0.1, A1:A3, 500)" }]],
    };
    const result = new SpreadsheetEngine().calculate(sheet);
    const expected = 100 / 1.1 + 200 / 1.1 ** 2 + 300 / 1.1 ** 3 + 500 / 1.1 ** 4;
    assert.ok(closeTo(result.data[3][0], expected), `NPV ≈ ${expected}, got ${result.data[3][0]}`);
  });

  it("matches the all-scalar form when there is no range", () => {
    const sheet = { name: "S", data: [[{ v: "=NPV(0.1, 100, 200, 300, 500)" }]] };
    const result = new SpreadsheetEngine().calculate(sheet);
    const expected = 100 / 1.1 + 200 / 1.1 ** 2 + 300 / 1.1 ** 3 + 500 / 1.1 ** 4;
    assert.ok(closeTo(result.data[0][0], expected), `NPV ≈ ${expected}, got ${result.data[0][0]}`);
  });
});
