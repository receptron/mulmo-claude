// Coercing whatever shape a model emitted into a 2D cell grid. It runs before
// every calculation, and a wrong reshape silently maps every A1-style reference
// onto a different cell — the sheet computes, just against the wrong layout.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeData } from "../../../../src/plugins/spreadsheet/engine/calculator.ts";

describe("normalizeData — already valid", () => {
  it("returns a 2D array unchanged", () => {
    const grid = [[{ v: 1 }, { v: 2 }], [{ v: 3 }]];
    assert.equal(normalizeData(grid), grid, "same reference, not a copy");
  });

  it("keeps an empty row structure", () => {
    const grid = [[]];
    assert.equal(normalizeData(grid), grid);
  });
});

describe("normalizeData — nothing to normalise", () => {
  it("returns empty for null, undefined and non-arrays", () => {
    assert.deepEqual(normalizeData(null), []);
    assert.deepEqual(normalizeData(undefined), []);
    assert.deepEqual(normalizeData("A1"), []);
    assert.deepEqual(normalizeData(42), []);
    assert.deepEqual(normalizeData({ v: 1 }), []);
  });

  it("returns empty for an empty array", () => {
    assert.deepEqual(normalizeData([]), []);
  });

  // A flat array of primitives is not a recognised shape — pairing them would
  // invent structure, so it returns empty rather than guess.
  it("returns empty for a flat array of primitives", () => {
    assert.deepEqual(normalizeData([1, 2, 3]), []);
    assert.deepEqual(normalizeData(["a", "b"]), []);
  });
});

describe("normalizeData — flat cell array to 2D", () => {
  // A model that emits a flat list of cell objects is reshaped into rows of two.
  it("pairs a flat cell array into two-column rows", () => {
    assert.deepEqual(normalizeData([{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }]), [
      [{ v: 1 }, { v: 2 }],
      [{ v: 3 }, { v: 4 }],
    ]);
  });

  // An odd length leaves a one-cell final row rather than dropping or padding.
  it("leaves a lone final cell in its own row when the count is odd", () => {
    assert.deepEqual(normalizeData([{ v: 1 }, { v: 2 }, { v: 3 }]), [[{ v: 1 }, { v: 2 }], [{ v: 3 }]]);
  });

  it("reshapes a single cell into one row", () => {
    assert.deepEqual(normalizeData([{ v: 1 }]), [[{ v: 1 }]]);
  });
});
