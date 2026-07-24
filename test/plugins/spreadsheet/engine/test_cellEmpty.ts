// Telling a blank cell apart from a stored 0. Get this wrong and an aggregate
// reports a plausible number computed over the wrong count — a blank counted as
// a value drags AVERAGE down and COUNT up, with nothing to show it happened.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isEmptyCell } from "../../../../src/plugins/spreadsheet/engine/cellEmpty.ts";
import type { SpreadsheetCell } from "../../../../src/plugins/spreadsheet/engine/types.ts";
import { SpreadsheetEngine, type SheetData } from "../../../../src/plugins/spreadsheet/engine/index.ts";

describe("isEmptyCell — empty", () => {
  it("treats an absent cell as empty", () => {
    assert.equal(isEmptyCell(null), true);
    assert.equal(isEmptyCell(undefined), true);
  });

  it("treats an object with no value as empty", () => {
    assert.equal(isEmptyCell({}), true);
    assert.equal(isEmptyCell({ f: "0.00" }), true, "a format without a value is still empty");
  });

  it("treats a null or undefined stored value as empty", () => {
    assert.equal(isEmptyCell({ v: null }), true);
    assert.equal(isEmptyCell({ v: undefined }), true);
  });

  it("treats an empty or whitespace string as empty, bare or wrapped", () => {
    assert.equal(isEmptyCell(""), true);
    assert.equal(isEmptyCell("   "), true);
    assert.equal(isEmptyCell({ v: "" }), true);
    assert.equal(isEmptyCell({ v: "  " }), true);
  });
});

describe("isEmptyCell — not empty", () => {
  // The distinction the whole module exists for: a stored 0 is a value.
  it("treats a stored zero as a value", () => {
    assert.equal(isEmptyCell(0), false);
    assert.equal(isEmptyCell({ v: 0 }), false);
  });

  it("treats false as a value", () => {
    assert.equal(isEmptyCell(false), false);
    assert.equal(isEmptyCell({ v: false }), false);
  });

  it("treats any non-empty text as a value", () => {
    assert.equal(isEmptyCell("x"), false);
    assert.equal(isEmptyCell({ v: "hello" }), false);
    assert.equal(isEmptyCell({ v: "0" }), false, "a zero written as text is still a value");
  });

  it("treats a number as a value", () => {
    assert.equal(isEmptyCell(42), false);
    assert.equal(isEmptyCell({ v: 42 }), false);
    assert.equal(isEmptyCell(-1), false);
  });
});

// The same distinction driven through the engine: an aggregate over a range
// with blanks must count only the real values.
describe("blank cells are not values in an aggregate (#2358)", () => {
  // 10, 20, 30 followed by two blanks. Excel divides by 3 and counts 3.
  const withBlanks = (formula: string): SheetData => ({
    name: "S",
    data: [[{ v: 10 }, { v: formula }], [{ v: 20 }], [{ v: 30 }], [{ v: "" }], [{ v: null } as unknown as SpreadsheetCell]],
  });
  const run = (formula: string): unknown => new SpreadsheetEngine().calculate(withBlanks(formula)).data[0][1];

  it("excludes blanks from AVERAGE's denominator", () => {
    assert.equal(run("=AVERAGE(A1:A5)"), 20, "not 15, which counts the two blanks as 0");
  });

  it("excludes blanks from COUNT", () => {
    assert.equal(run("=COUNT(A1:A5)"), 3, "not 4");
  });

  // A blank would have read as 0, and 0 does not change a sum — so SUM is the
  // one aggregate the old behaviour got right, and it must stay right.
  it("leaves SUM unchanged", () => {
    assert.equal(run("=SUM(A1:A5)"), 60);
  });

  it("does not disturb MAX or MIN", () => {
    assert.equal(run("=MAX(A1:A5)"), 30);
    assert.equal(run("=MIN(A1:A5)"), 10);
  });

  // The line the fix walks: a stored 0 is a value and must still count, even
  // though a blank does not.
  it("still counts a stored zero", () => {
    const sheet: SheetData = { name: "S", data: [[{ v: 10 }, { v: "=COUNT(A1:A3)" }], [{ v: 0 }], [{ v: 20 }]] };
    assert.equal(new SpreadsheetEngine().calculate(sheet).data[0][1], 3);
  });

  it("averages a stored zero in, but not a blank", () => {
    const sheet: SheetData = { name: "S", data: [[{ v: 6 }, { v: "=AVERAGE(A1:A3)" }], [{ v: 0 }], [{ v: "" }]] };
    assert.equal(new SpreadsheetEngine().calculate(sheet).data[0][1], 3, "(6 + 0) / 2, the blank excluded");
  });
});

describe("blanks stay in the raw range so criteria and values stay aligned", () => {
  // SUMIF reads the criteria range and the sum range separately. Dropping
  // blanks from the raw list would compact each independently and shift the
  // rows out of alignment, aggregating the wrong values (Codex review on
  // #2383). A blank in the criteria column must NOT desync the two ranges.
  it("keeps SUMIF row-aligned when a criteria cell is blank", () => {
    const sheet: SheetData = {
      name: "S",
      data: [
        [{ v: 10 }, { v: 100 }, { v: '=SUMIF(A1:A4,">5",B1:B4)' }],
        [{ v: "" }, { v: 200 }],
        [{ v: 20 }, { v: 300 }],
        [{ v: 30 }, { v: 400 }],
      ],
    };
    // A1=10, A3=20, A4=30 are >5; their B values are 100, 300, 400 → 800.
    // If the blank A2 shifted the value range, B would misalign and the sum
    // would be wrong.
    assert.equal(new SpreadsheetEngine().calculate(sheet).data[0][2], 800);
  });
});
