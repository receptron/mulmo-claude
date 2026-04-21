// Unit tests for the pure formula-reference scanner extracted from
// `src/plugins/spreadsheet/View.vue` (the original was 70 lines of
// inline regex + nested loops with cognitive complexity 32).
//
// Per CLAUDE.md's Testing requirements, covers:
//   - Happy path
//   - Edge cases (empty, single cell, ranges of every shape)
//   - Corner cases (absolute $ refs, large row/col indices)
//   - Boundary cases (last letter columns, max-int-ish rows)
//   - Invalid / malformed inputs
//   - Regression fixtures for the exact shapes View.vue passed to
//     the original function.
//
// Tracks #175.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stripFormulaPrefix, expandRange, parseSingleCellRef, extractCellReferences } from "../../../../src/plugins/spreadsheet/engine/formulaRefs.js";

describe("stripFormulaPrefix", () => {
  it("strips a leading =", () => {
    assert.equal(stripFormulaPrefix("=A1+B2"), "A1+B2");
  });

  it("leaves a formula without = untouched", () => {
    assert.equal(stripFormulaPrefix("A1+B2"), "A1+B2");
  });

  it("returns empty for empty", () => {
    assert.equal(stripFormulaPrefix(""), "");
  });

  it("only strips the first = (documenting behaviour)", () => {
    assert.equal(stripFormulaPrefix("==A1"), "=A1");
  });

  it("handles a bare =", () => {
    assert.equal(stripFormulaPrefix("="), "");
  });
});

describe("expandRange", () => {
  it("expands a small square range", () => {
    assert.deepEqual(expandRange("A1:B2"), [
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 1, col: 0 },
      { row: 1, col: 1 },
    ]);
  });

  it("expands a single-cell range (A1:A1)", () => {
    assert.deepEqual(expandRange("A1:A1"), [{ row: 0, col: 0 }]);
  });

  it("expands a single-row range (A1:C1)", () => {
    assert.deepEqual(expandRange("A1:C1"), [
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 0, col: 2 },
    ]);
  });

  it("expands a single-column range (A1:A3)", () => {
    assert.deepEqual(expandRange("A1:A3"), [
      { row: 0, col: 0 },
      { row: 1, col: 0 },
      { row: 2, col: 0 },
    ]);
  });

  it("strips $ on absolute refs ($A$1:$B$2)", () => {
    assert.deepEqual(expandRange("$A$1:$B$2"), expandRange("A1:B2"));
  });

  it("handles partial absolute refs ($A1:B$2)", () => {
    assert.deepEqual(expandRange("$A1:B$2"), expandRange("A1:B2"));
  });

  it("handles multi-letter columns (Z1:AA1)", () => {
    // Z = col 25, AA = col 26
    assert.deepEqual(expandRange("Z1:AA1"), [
      { row: 0, col: 25 },
      { row: 0, col: 26 },
    ]);
  });

  it("returns [] for a reversed range (loops fall through)", () => {
    // B2 to A1 — start > end, for-loops iterate 0 times. Matches
    // the original inline behaviour.
    assert.deepEqual(expandRange("B2:A1"), []);
  });

  it("returns [] for malformed input: no colon", () => {
    assert.deepEqual(expandRange("A1"), []);
  });

  it("returns [] for malformed input: junk", () => {
    assert.deepEqual(expandRange("foo:bar"), []);
  });

  it("returns [] for empty string", () => {
    assert.deepEqual(expandRange(""), []);
  });

  it("returns [] for missing column letters", () => {
    assert.deepEqual(expandRange("1:2"), []);
  });
});

describe("parseSingleCellRef", () => {
  it("parses A1 (col 0, row 0)", () => {
    assert.deepEqual(parseSingleCellRef("A1"), { row: 0, col: 0 });
  });

  it("parses B3 (col 1, row 2)", () => {
    assert.deepEqual(parseSingleCellRef("B3"), { row: 2, col: 1 });
  });

  it("parses absolute $A$1 (same as A1)", () => {
    assert.deepEqual(parseSingleCellRef("$A$1"), { row: 0, col: 0 });
  });

  it("parses partial absolute $A1 and A$1", () => {
    assert.deepEqual(parseSingleCellRef("$A1"), { row: 0, col: 0 });
    assert.deepEqual(parseSingleCellRef("A$1"), { row: 0, col: 0 });
  });

  it("parses multi-letter column AA1 (col 26)", () => {
    assert.deepEqual(parseSingleCellRef("AA1"), { row: 0, col: 26 });
  });

  it("parses large row A100 (row 99)", () => {
    assert.deepEqual(parseSingleCellRef("A100"), { row: 99, col: 0 });
  });

  it("parses the last single-letter column Z1 (col 25)", () => {
    assert.deepEqual(parseSingleCellRef("Z1"), { row: 0, col: 25 });
  });

  it("returns null for lowercase (regex is case-sensitive)", () => {
    assert.equal(parseSingleCellRef("a1"), null);
  });

  it("returns null for row-then-col order (1A)", () => {
    assert.equal(parseSingleCellRef("1A"), null);
  });

  it("returns null for empty string", () => {
    assert.equal(parseSingleCellRef(""), null);
  });

  it("returns null for garbage", () => {
    assert.equal(parseSingleCellRef("not-a-ref"), null);
  });

  it("returns null when the row part is missing", () => {
    assert.equal(parseSingleCellRef("A"), null);
  });

  it("returns null when the col part is missing", () => {
    assert.equal(parseSingleCellRef("42"), null);
  });
});

describe("extractCellReferences — happy path", () => {
  it("returns [] for empty formula", () => {
    assert.deepEqual(extractCellReferences(""), []);
  });

  it("returns [] for a formula with no cell refs (only literals)", () => {
    assert.deepEqual(extractCellReferences("=123+456"), []);
  });

  it("picks up a single cell ref", () => {
    assert.deepEqual(extractCellReferences("=A1"), [{ row: 0, col: 0 }]);
  });

  it("picks up multiple single cell refs in order", () => {
    assert.deepEqual(extractCellReferences("=A1+B2+C3"), [
      { row: 0, col: 0 },
      { row: 1, col: 1 },
      { row: 2, col: 2 },
    ]);
  });

  it("works without a leading = prefix", () => {
    // The scanner is also used on partial text (during live edit).
    assert.deepEqual(extractCellReferences("A1+B2"), [
      { row: 0, col: 0 },
      { row: 1, col: 1 },
    ]);
  });

  it("picks up absolute references", () => {
    assert.deepEqual(extractCellReferences("=$A$1+$B2+C$3"), [
      { row: 0, col: 0 },
      { row: 1, col: 1 },
      { row: 2, col: 2 },
    ]);
  });

  it("works with common function syntax", () => {
    assert.deepEqual(extractCellReferences("=SUM(A1, B2, C3)"), [
      { row: 0, col: 0 },
      { row: 1, col: 1 },
      { row: 2, col: 2 },
    ]);
  });
});

describe("extractCellReferences — range handling", () => {
  it("expands a SUM(A1:B2) range into 4 cells", () => {
    assert.deepEqual(extractCellReferences("=SUM(A1:B2)"), [
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 1, col: 0 },
      { row: 1, col: 1 },
    ]);
  });

  it("does NOT emit the range endpoints as standalone cells", () => {
    // The original code strips matched ranges before running the
    // cell regex — regression pin so a future refactor doesn't
    // accidentally double-count A1 and B2.
    const refs = extractCellReferences("=A1:B2");
    // Should be exactly 4 cells from the range expansion, not 6
    // (4 range + 2 endpoints).
    assert.equal(refs.length, 4);
  });

  it("combines a range with standalone cells", () => {
    assert.deepEqual(extractCellReferences("=SUM(A1:A2)+C5"), [
      { row: 0, col: 0 },
      { row: 1, col: 0 },
      { row: 4, col: 2 },
    ]);
  });

  it("expands multiple ranges in one formula", () => {
    const refs = extractCellReferences("=SUM(A1:A2)+SUM(C1:C2)");
    assert.equal(refs.length, 4);
    assert.deepEqual(refs.slice().sort(cmpCoord), [
      { row: 0, col: 0 },
      { row: 0, col: 2 },
      { row: 1, col: 0 },
      { row: 1, col: 2 },
    ]);
  });

  it("handles absolute-reference ranges", () => {
    assert.deepEqual(extractCellReferences("=SUM($A$1:$B$2)"), [
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 1, col: 0 },
      { row: 1, col: 1 },
    ]);
  });
});

describe("extractCellReferences — deduplication", () => {
  it("drops duplicate standalone cells", () => {
    assert.deepEqual(extractCellReferences("=A1+A1+A1"), [{ row: 0, col: 0 }]);
  });

  it("drops duplicate cells across absolute / relative forms", () => {
    // A1 and $A$1 refer to the same cell; the scanner normalises by
    // stripping $, so only one entry appears.
    assert.deepEqual(extractCellReferences("=A1+$A$1"), [{ row: 0, col: 0 }]);
  });

  it("drops cells already covered by a range", () => {
    const refs = extractCellReferences("=SUM(A1:B2)+A1+B2");
    // Range contributes 4 cells; A1 and B2 are already among them.
    assert.equal(refs.length, 4);
  });

  it("preserves first-occurrence order of unique cells", () => {
    assert.deepEqual(extractCellReferences("=C3+A1+B2+C3+A1"), [
      { row: 2, col: 2 },
      { row: 0, col: 0 },
      { row: 1, col: 1 },
    ]);
  });
});

describe("extractCellReferences — malformed / edge input", () => {
  it("ignores lowercase (regex is case-sensitive, matching Excel)", () => {
    assert.deepEqual(extractCellReferences("=a1+b2"), []);
  });

  it("ignores partial tokens", () => {
    // `A` alone isn't a ref, neither is `1`; no digits adjacent
    // to letters means no match.
    assert.deepEqual(extractCellReferences("=A + 1"), []);
  });

  it("doesn't match numbers embedded in text without letters", () => {
    assert.deepEqual(extractCellReferences("=(100/4)"), []);
  });

  it("handles a formula of only an = sign", () => {
    assert.deepEqual(extractCellReferences("="), []);
  });

  it("picks up cells inside parentheses and operators", () => {
    assert.deepEqual(extractCellReferences("=((A1+B2)*C3)"), [
      { row: 0, col: 0 },
      { row: 1, col: 1 },
      { row: 2, col: 2 },
    ]);
  });
});

describe("extractCellReferences — boundary / precision", () => {
  it("handles triple-letter columns (AAA1 = col 702)", () => {
    // A=0, Z=25, AA=26, AZ=51, BA=52, ZZ=701, AAA=702
    assert.deepEqual(extractCellReferences("=AAA1"), [{ row: 0, col: 702 }]);
  });

  it("handles row numbers near Excel's 2^20 limit", () => {
    // Excel's max row is 1048576. Our parser doesn't enforce that
    // cap (and shouldn't — it's a pure scanner) but it should
    // still produce a valid integer.
    const refs = extractCellReferences("=A1048576");
    assert.equal(refs.length, 1);
    assert.equal(refs[0].row, 1048575);
    assert.equal(refs[0].col, 0);
  });
});

// --- helpers ---

function cmpCoord(coordA: { row: number; col: number }, coordB: { row: number; col: number }): number {
  if (coordA.row !== coordB.row) return coordA.row - coordB.row;
  return coordA.col - coordB.col;
}
