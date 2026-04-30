import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getArrowKeyOffset, isWithinSheetBounds } from "../../../src/plugins/spreadsheet/keyboardNav.js";

describe("getArrowKeyOffset", () => {
  it("ArrowUp decrements row", () => {
    assert.deepEqual(getArrowKeyOffset("ArrowUp", 3, 5), { row: 2, col: 5 });
  });

  it("ArrowDown increments row (no upper clamp — bounds check happens later)", () => {
    assert.deepEqual(getArrowKeyOffset("ArrowDown", 3, 5), { row: 4, col: 5 });
  });

  it("ArrowLeft decrements col", () => {
    assert.deepEqual(getArrowKeyOffset("ArrowLeft", 3, 5), { row: 3, col: 4 });
  });

  it("ArrowRight increments col", () => {
    assert.deepEqual(getArrowKeyOffset("ArrowRight", 3, 5), { row: 3, col: 6 });
  });

  it("ArrowUp clamps row at 0", () => {
    assert.deepEqual(getArrowKeyOffset("ArrowUp", 0, 5), { row: 0, col: 5 });
  });

  it("ArrowLeft clamps col at 0", () => {
    assert.deepEqual(getArrowKeyOffset("ArrowLeft", 3, 0), { row: 3, col: 0 });
  });

  it("returns null for non-arrow keys", () => {
    for (const key of ["Enter", "Tab", "Escape", "a", " ", "Shift"]) {
      assert.equal(getArrowKeyOffset(key, 3, 5), null, `expected null for ${JSON.stringify(key)}`);
    }
  });

  it("returns null for empty string", () => {
    assert.equal(getArrowKeyOffset("", 3, 5), null);
  });
});

describe("isWithinSheetBounds", () => {
  const sheet = {
    data: [
      [1, 2, 3],
      [4, 5, 6],
    ],
  };

  it("accepts an in-range cell", () => {
    assert.equal(isWithinSheetBounds(sheet, 0, 0), true);
    assert.equal(isWithinSheetBounds(sheet, 1, 2), true);
  });

  it("rejects negative row", () => {
    assert.equal(isWithinSheetBounds(sheet, -1, 0), false);
  });

  it("rejects negative col", () => {
    assert.equal(isWithinSheetBounds(sheet, 0, -1), false);
  });

  it("rejects row past data length", () => {
    assert.equal(isWithinSheetBounds(sheet, 2, 0), false);
  });

  it("rejects col past row length", () => {
    assert.equal(isWithinSheetBounds(sheet, 0, 3), false);
  });

  it("rejects when sheet is undefined", () => {
    assert.equal(isWithinSheetBounds(undefined, 0, 0), false);
  });

  it("rejects when sheet is null", () => {
    assert.equal(isWithinSheetBounds(null, 0, 0), false);
  });

  it("rejects when sheet.data is missing", () => {
    assert.equal(isWithinSheetBounds({}, 0, 0), false);
  });

  it("rejects when the target row entry is missing (sparse array)", () => {
    // eslint-disable-next-line no-sparse-arrays
    const sparse = { data: [[1, 2], , [3, 4]] as unknown[][] };
    assert.equal(isWithinSheetBounds(sparse, 1, 0), false);
  });

  it("handles a row of zero length (col always rejected)", () => {
    const empty = { data: [[]] };
    assert.equal(isWithinSheetBounds(empty, 0, 0), false);
  });
});
