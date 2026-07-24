// The display-formatting decision for a single cell. It runs only on the final
// output pass — cross-sheet reference resolution deliberately skips it — so a
// wrong branch here either hides a date or, worse, turns a raw serial into a
// "03/04/2025" string that a downstream parseFloat reads as 3 (issue #2332).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatCellForDisplay, isLikelyDateSerial } from "../../../../src/plugins/spreadsheet/engine/cellFormatting.ts";
import { dateToSerial } from "../../../../src/plugins/spreadsheet/engine/date-utils.ts";

const serial2025Mar4 = dateToSerial(new Date(Date.UTC(2025, 2, 4)));

describe("isLikelyDateSerial", () => {
  it("accepts integers inside the date-serial window", () => {
    assert.equal(isLikelyDateSerial(serial2025Mar4), true);
  });

  it("accepts the exact window boundaries", () => {
    assert.equal(isLikelyDateSerial(36000), true);
    assert.equal(isLikelyDateSerial(63499), true);
  });

  it("rejects values just outside the window", () => {
    assert.equal(isLikelyDateSerial(35999), false);
    assert.equal(isLikelyDateSerial(63500), false);
  });

  it("rejects non-integers (a time component is not a bare date)", () => {
    assert.equal(isLikelyDateSerial(45720.5), false);
  });

  it("rejects non-numbers", () => {
    assert.equal(isLikelyDateSerial("45720" as unknown as number), false);
    assert.equal(isLikelyDateSerial(true as unknown as number), false);
  });
});

describe("formatCellForDisplay — passthrough", () => {
  it("returns the value unchanged when the original is not a cell", () => {
    assert.equal(formatCellForDisplay(5, 5, false), 5);
    assert.equal(formatCellForDisplay(null, 7, false), 7);
  });

  it("leaves text untouched", () => {
    assert.equal(formatCellForDisplay({ v: "hello" }, "hello", false), "hello");
  });

  it("leaves a plain formula number that is not a date serial", () => {
    assert.equal(formatCellForDisplay({ v: "=A1+A2" }, 100, false), 100);
  });

  it("leaves an empty cell's zero as a number", () => {
    assert.equal(formatCellForDisplay({ v: "" }, 0, false), 0);
  });
});

describe("formatCellForDisplay — formatting", () => {
  it("applies an explicit currency format", () => {
    assert.equal(formatCellForDisplay({ v: 1234.5, f: "$#,##0.00" }, 1234.5, false), "$1,234.50");
  });

  it("auto-formats a formula's date serial (month-first by default)", () => {
    assert.equal(formatCellForDisplay({ v: "=A1" }, serial2025Mar4, false), "03/04/2025");
  });

  it("honours day-first preference for the auto date format", () => {
    assert.equal(formatCellForDisplay({ v: "=A1" }, serial2025Mar4, true), "04/03/2025");
  });

  it("does NOT auto-format a non-formula date serial (only formulas opt in)", () => {
    assert.equal(formatCellForDisplay({ v: serial2025Mar4 }, serial2025Mar4, false), serial2025Mar4);
  });
});
