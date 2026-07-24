// A1-notation column conversion. Every other reference-handling path in the
// engine is built on these two, and both fail silently: `columnToIndex` does
// arithmetic on char codes with no validation, so a bad input returns a
// plausible-looking number instead of throwing, and the caller reads the wrong
// column.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { columnToIndex, indexToColumn } from "../../../../src/plugins/spreadsheet/engine/parser.ts";

describe("columnToIndex", () => {
  it("maps the single-letter columns", () => {
    assert.equal(columnToIndex("A"), 0);
    assert.equal(columnToIndex("B"), 1);
    assert.equal(columnToIndex("Z"), 25);
  });

  // The bijective-base-26 boundary: AA follows Z, not "BA" or index 26+1.
  it("maps the two-letter columns across the Z→AA boundary", () => {
    assert.equal(columnToIndex("AA"), 26);
    assert.equal(columnToIndex("AB"), 27);
    assert.equal(columnToIndex("AZ"), 51);
    assert.equal(columnToIndex("BA"), 52);
    assert.equal(columnToIndex("ZZ"), 701);
  });

  it("maps three-letter columns", () => {
    assert.equal(columnToIndex("AAA"), 702);
    // XFD is Excel's last column (16384 columns, 0-based → 16383).
    assert.equal(columnToIndex("XFD"), 16383);
  });

  // Documented current behaviour, NOT an endorsement: the function does no
  // validation, so these return numbers rather than failing. Callers all
  // pre-match `[A-Z]+`, which is what keeps the garbage out today — pinned so
  // that if a caller's regex is ever relaxed, the consequence is visible here.
  it("returns a wrong-but-plausible index for lowercase input (no validation)", () => {
    // 'a' is 97; 97 - 64 - 1 = 32, i.e. column AG.
    assert.equal(columnToIndex("a"), 32);
    assert.equal(columnToIndex("z"), 57);
  });

  it("returns -1 for the empty string", () => {
    assert.equal(columnToIndex(""), -1);
  });
});

describe("indexToColumn", () => {
  it("maps the single-letter columns", () => {
    assert.equal(indexToColumn(0), "A");
    assert.equal(indexToColumn(1), "B");
    assert.equal(indexToColumn(25), "Z");
  });

  it("maps the two-letter columns across the Z→AA boundary", () => {
    assert.equal(indexToColumn(26), "AA");
    assert.equal(indexToColumn(27), "AB");
    assert.equal(indexToColumn(51), "AZ");
    assert.equal(indexToColumn(52), "BA");
    assert.equal(indexToColumn(701), "ZZ");
  });

  it("maps three-letter columns", () => {
    assert.equal(indexToColumn(702), "AAA");
    assert.equal(indexToColumn(16383), "XFD");
  });

  it("returns an empty string for a negative index", () => {
    assert.equal(indexToColumn(-1), "");
  });
});

describe("columnToIndex / indexToColumn round-trip", () => {
  // The pair is used in both directions on the same value (range expansion
  // walks indices, then renders refs back), so an asymmetry anywhere in the
  // range silently shifts a whole range by one column.
  it("round-trips every index across the single/double/triple letter boundaries", () => {
    const boundaries = [0, 1, 24, 25, 26, 27, 50, 51, 52, 700, 701, 702, 703, 16382, 16383];
    for (const index of boundaries) {
      assert.equal(columnToIndex(indexToColumn(index)), index, `round-trip failed at ${index}`);
    }
  });

  it("round-trips a contiguous span with no gaps or repeats", () => {
    const seen = new Set<string>();
    for (let index = 0; index <= 1000; index++) {
      const col = indexToColumn(index);
      assert.equal(seen.has(col), false, `duplicate column label ${col} at index ${index}`);
      seen.add(col);
      assert.equal(columnToIndex(col), index);
    }
  });
});
