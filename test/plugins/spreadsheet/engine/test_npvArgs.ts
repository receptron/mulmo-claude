// NPV period assignment through the handler. The pre-refactor handler used
// `period = argIndex + rangePosition`, so a scalar argument after a multi-cell
// range landed on the range's period rather than continuing the sequence (a
// latent off-by bug). The refactor normalizes this to strictly sequential
// periods — the Excel semantics — so a mixed `NPV(rate, range, scalar)` now
// discounts every flow by its position in the flattened series (#2394 / #2442).
// This pins the intended (sequential) behavior at the handler level.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetEngine, type SheetData } from "../../../../src/plugins/spreadsheet/engine/index.ts";

const closeTo = (actual: number, expected: number, eps = 0.01): boolean => Math.abs(actual - expected) <= eps;

describe("NPV — sequential periods across mixed range and scalar arguments", () => {
  it("discounts a scalar after a range by the next period, not the range's", () => {
    // A1:A3 = 100, 200, 300 (periods 1..3); B1 = 400 must be period 4.
    // 100/1.1 + 200/1.1^2 + 300/1.1^3 + 400/1.1^4 = 754.7967…
    // The old arg-index math discounted B1 at period 2 (= 812.17), which is wrong.
    const sheet: SheetData = {
      name: "S",
      data: [[{ v: 100 }, { v: 400 }, { v: "=NPV(0.1, A1:A3, B1)" }], [{ v: 200 }], [{ v: 300 }]],
    };
    const result = new SpreadsheetEngine().calculate(sheet).data[0][2] as number;
    assert.ok(closeTo(result, 754.7967), `NPV mixed args = ${result}, expected ~754.80 (sequential)`);
  });

  it("matches a single range read as consecutive periods", () => {
    // 100/1.1 + 200/1.1^2 + 300/1.1^3 = 481.5928…
    const sheet: SheetData = {
      name: "S",
      data: [[{ v: 100 }, { v: "=NPV(0.1, A1:A3)" }], [{ v: 200 }], [{ v: 300 }]],
    };
    const result = new SpreadsheetEngine().calculate(sheet).data[0][1] as number;
    assert.ok(closeTo(result, 481.5928), `NPV single range = ${result}, expected ~481.59`);
  });
});
