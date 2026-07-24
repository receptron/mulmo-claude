// Cross-sheet references (`=Data!A1`) must resolve a cell to the SAME value a
// same-sheet reference would. Regression for #2332: the target sheet was being
// resolved through its display-formatted output, so a date serial arrived as
// the string "03/04/2025" and parseFloat read it as 3 — `=Data!A1` returned 3
// and `=DAY(Data!A1)` returned 2. Same-sheet was always correct; these tests
// pin cross-sheet to that same behaviour.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetEngine, type SheetData } from "../../../../src/plugins/spreadsheet/engine/index.ts";

const engine = new SpreadsheetEngine();

const calcRow = (target: SheetData, all: SheetData[], row = 0) => engine.calculate(target, all).data[row];

describe("cross-sheet date reference (#2332 regression)", () => {
  const data: SheetData = { name: "Data", data: [[{ v: "03/04/2025" }]] };
  const summary: SheetData = { name: "Summary", data: [[{ v: "=DAY(Data!A1)" }, { v: "=Data!A1" }]] };

  it("=DAY(Data!A1) reads the date, not the leading digits", () => {
    assert.equal(calcRow(summary, [data, summary])[0], 4);
  });

  it("=Data!A1 does not collapse to 3", () => {
    assert.notEqual(calcRow(summary, [data, summary])[1], 3);
  });

  it("=Data!A1 matches the identical same-sheet reference", () => {
    const sameSheet: SheetData = { name: "S", data: [[{ v: "03/04/2025" }, { v: "=DAY(A1)" }, { v: "=A1" }]] };
    const same = calcRow(sameSheet, [sameSheet]);
    const cross = calcRow(summary, [data, summary]);
    assert.equal(cross[0], same[1]); // =DAY
    assert.equal(cross[1], same[2]); // =ref -> "03/04/2025"
  });
});

describe("cross-sheet reference — value types read straight across", () => {
  const data: SheetData = {
    name: "Data",
    // date, number, text, empty, a formula that itself produces a date serial
    data: [[{ v: "03/04/2025" }, { v: 42 }, { v: "hello" }, { v: "" }, { v: "=DATE(2025,3,4)" }]],
  };
  const refs: SheetData = {
    name: "Refs",
    data: [[{ v: "=Data!A1" }, { v: "=Data!B1" }, { v: "=Data!C1" }, { v: "=Data!D1" }, { v: "=Data!E1" }]],
  };

  it("resolves each type the way the source cell holds it", () => {
    assert.deepEqual(calcRow(refs, [data, refs]), ["03/04/2025", 42, "hello", 0, "03/04/2025"]);
  });

  it("feeds a cross-sheet date into a date function", () => {
    const derived: SheetData = { name: "D2", data: [[{ v: "=DAY(Data!E1)" }, { v: "=Data!B1*2" }]] };
    assert.deepEqual(calcRow(derived, [data, derived]), [4, 84]);
  });
});

describe("cross-sheet range aggregation stays numeric", () => {
  it("SUM over a cross-sheet range adds the raw numbers", () => {
    const data: SheetData = { name: "D", data: [[{ v: 10 }, { v: 20 }, { v: 30 }]] };
    const sum: SheetData = { name: "S", data: [[{ v: "=SUM(D!A1:C1)" }]] };
    assert.deepEqual(calcRow(sum, [data, sum]), [60]);
  });
});
