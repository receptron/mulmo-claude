// Turning a range or single-cell reference into coordinates. The calculator's
// old inline regex was range-only and case-sensitive and did not strip `$`, so
// three common reference shapes fell through to "no values" — and a function
// over an empty list is 0, not an error (#2356).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { expandRangeOrCell } from "../../../../src/plugins/spreadsheet/engine/formulaRefs.ts";

describe("expandRangeOrCell — ranges", () => {
  it("expands a simple range top-to-bottom, left-to-right", () => {
    assert.deepEqual(expandRangeOrCell("A1:B2"), [
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 1, col: 0 },
      { row: 1, col: 1 },
    ]);
  });

  it("expands a single-column range", () => {
    assert.deepEqual(expandRangeOrCell("A1:A3"), [
      { row: 0, col: 0 },
      { row: 1, col: 0 },
      { row: 2, col: 0 },
    ]);
  });

  // The fill-down form. The old regex left the `$` in and matched nothing.
  it("strips absolute-reference dollar signs", () => {
    assert.deepEqual(expandRangeOrCell("$A$1:$A$3"), expandRangeOrCell("A1:A3"));
    assert.deepEqual(expandRangeOrCell("$A1:A$3"), expandRangeOrCell("A1:A3"));
  });

  // Spreadsheets accept lowercase and upcase it; the old regex was `[A-Z]`
  // only, so a lowercase range silently produced nothing.
  it("upcases lowercase references", () => {
    assert.deepEqual(expandRangeOrCell("a1:b2"), expandRangeOrCell("A1:B2"));
    assert.deepEqual(expandRangeOrCell("$a$1:$a$3"), expandRangeOrCell("A1:A3"));
  });

  it("tolerates surrounding whitespace", () => {
    assert.deepEqual(expandRangeOrCell("  A1:A2  "), expandRangeOrCell("A1:A2"));
  });

  it("crosses the Z→AA column boundary", () => {
    assert.deepEqual(expandRangeOrCell("Z1:AA1"), [
      { row: 0, col: 25 },
      { row: 0, col: 26 },
    ]);
  });
});

describe("expandRangeOrCell — single cells", () => {
  // The case Excel sums as one value and the old regex refused for lack of a
  // colon.
  it("expands a bare cell to one coordinate", () => {
    assert.deepEqual(expandRangeOrCell("A1"), [{ row: 0, col: 0 }]);
    assert.deepEqual(expandRangeOrCell("B3"), [{ row: 2, col: 1 }]);
  });

  it("strips dollar signs and upcases a single cell", () => {
    assert.deepEqual(expandRangeOrCell("$A$1"), [{ row: 0, col: 0 }]);
    assert.deepEqual(expandRangeOrCell("a1"), [{ row: 0, col: 0 }]);
  });

  it("reads a multi-letter column", () => {
    assert.deepEqual(expandRangeOrCell("AA10"), [{ row: 9, col: 26 }]);
  });
});

describe("expandRangeOrCell — non-references", () => {
  // Null rather than an empty array: the caller distinguishes "not a reference"
  // from "a valid but empty range", and returning [] for garbage would hide
  // typos as zero-value sums.
  it("returns null for text that is not a reference", () => {
    assert.equal(expandRangeOrCell("hello"), null);
    assert.equal(expandRangeOrCell(""), null);
    assert.equal(expandRangeOrCell("A"), null);
    assert.equal(expandRangeOrCell("1"), null);
    assert.equal(expandRangeOrCell("A1:B"), null);
    assert.equal(expandRangeOrCell("A1:"), null);
  });
});
