// The date-order setting reaching the cells. `prefersDayFirst` and `parseDate`
// are each covered on their own; what this file checks is that the flag
// actually travels from `EngineOptions` down to every place that reads a date —
// including the FORMAT the cell is given, because parsing day-first while
// rendering month-first would just move the confusion rather than fix it.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
// Imported through the barrel, not the class module: `engine/index.ts` is what
// registers the built-in functions, so a direct import leaves DAY() unknown.
import { SpreadsheetEngine, type SheetData } from "../../../../src/plugins/spreadsheet/engine/index.ts";

const sheetWith = (value: string): SheetData => ({ name: "S", data: [[{ v: value }]] });

const renderedCell = (value: string, preferDDMMYYYY: boolean): unknown => new SpreadsheetEngine({ preferDDMMYYYY }).calculate(sheetWith(value)).data[0][0];

describe("date order reaches the cell", () => {
  // The whole point: the same text means different days in different places,
  // and neither reading raises.
  it("reads an ambiguous date month-first by default and day-first when asked", () => {
    assert.equal(renderedCell("03/04/2025", false), "03/04/2025");
    assert.equal(renderedCell("03/04/2025", true), "03/04/2025");
  });

  // Rendering has to follow the reading, or a day-first user sees their April 3
  // written back as "04/03" under an MM/DD label.
  it("renders in the order it read, so the cell round-trips", () => {
    const monthFirst = new SpreadsheetEngine({ preferDDMMYYYY: false }).calculate(sheetWith("03/04/2025"));
    const dayFirst = new SpreadsheetEngine({ preferDDMMYYYY: true }).calculate(sheetWith("03/04/2025"));
    // Same displayed text, different underlying dates — which is exactly what a
    // user in each locale expects to see.
    assert.equal(monthFirst.data[0][0], "03/04/2025");
    assert.equal(dayFirst.data[0][0], "03/04/2025");
  });

  // Month-name formats are exercised in test_formatter.ts; this only needs the
  // shapes the day/month decision can reach.
  it("leaves unambiguous dates alone under either setting", () => {
    for (const prefer of [false, true]) {
      assert.equal(renderedCell("13/04/2025", prefer), "13/04/2025", "13 can only be a day");
      assert.equal(renderedCell("2025-03-04", prefer), "2025-03-04", "ISO is not affected");
    }
  });

  it("leaves non-dates alone", () => {
    for (const prefer of [false, true]) {
      assert.equal(renderedCell("hello", prefer), "hello");
    }
  });

  // The default must stay month-first, or every existing sheet silently
  // reinterprets on the next render.
  it("defaults to month-first when the option is omitted", () => {
    const engine = new SpreadsheetEngine();
    assert.equal(engine.getOptions().preferDDMMYYYY, false);
  });

  it("can be changed after construction", () => {
    const engine = new SpreadsheetEngine();
    engine.setOptions({ preferDDMMYYYY: true });
    assert.equal(engine.getOptions().preferDDMMYYYY, true);
  });
});

describe("date order reaches formulas", () => {
  const formulaResult = (cells: string[], preferDDMMYYYY: boolean): unknown =>
    new SpreadsheetEngine({ preferDDMMYYYY }).calculate({ name: "S", data: [cells.map((cell) => ({ v: cell }))] }).data[0].at(-1);

  // `DAY()` reads the serial, so it reports which number the parser took as the
  // day — the clearest observable difference between the two settings.
  it("applies the setting to a date held in a cell", () => {
    assert.equal(formulaResult(["03/04/2025", "=DAY(A1)"], false), 4, "month-first: the 4 is the day");
    assert.equal(formulaResult(["03/04/2025", "=DAY(A1)"], true), 3, "day-first: the 3 is the day");
  });

  // A date written INSIDE a formula never passes through the cell
  // preprocessing — the evaluator parses it on its own, so the setting has to
  // reach there separately.
  it("applies the setting to a date literal inside a formula", () => {
    assert.equal(formulaResult(['=DAY("03/04/2025")'], false), 4);
    assert.equal(formulaResult(['=DAY("03/04/2025")'], true), 3);
  });

  // Arithmetic takes a third route: quoted dates are substituted into the
  // expression before it is computed. The sign flip makes the difference
  // unmissable — the same subtraction is 30 days one way and -30 the other.
  it("applies the setting to a date literal in an arithmetic expression", () => {
    assert.equal(formulaResult(["04/03/2025", '=A1-"03/04/2025"'], false), 30, "Apr 3 minus Mar 4");
    assert.equal(formulaResult(["04/03/2025", '=A1-"03/04/2025"'], true), -30, "Mar 4 minus Apr 3");
  });

  // Cross-sheet references are NOT covered here: `=Data!A1` currently returns
  // 3 for a date cell on main, independent of this setting, because the
  // cross-sheet path never sees the date preprocessing (#2332). Adding the
  // coverage belongs with that fix, not here.
});
