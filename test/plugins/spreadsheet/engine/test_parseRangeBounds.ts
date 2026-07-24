// `parseRangeBounds` is the single range parser the lookup functions now share
// (#2396). It carries the sheet-prefix split that one of the four former copies
// lacked — the copy that made cross-sheet VLOOKUP throw (#2390). Columns come
// back 0-based (A=0), rows stay 1-based (A1 notation).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseRangeBounds, resolveIndexTarget, type RangeBounds } from "../../../../src/plugins/spreadsheet/engine/formulaRefs.ts";

describe("parseRangeBounds — plain ranges", () => {
  it("parses A1:B10 (cols 0-based, rows 1-based)", () => {
    assert.deepEqual(parseRangeBounds("A1:B10"), { sheetPrefix: "", startCol: 0, startRow: 1, endCol: 1, endRow: 10 });
  });

  it("parses an offset range A2:C10", () => {
    assert.deepEqual(parseRangeBounds("A2:C10"), { sheetPrefix: "", startCol: 0, startRow: 2, endCol: 2, endRow: 10 });
  });

  // Column boundaries: A is Excel column 1 → index 0, Z is 26 → 25, AA is 27 → 26.
  it("parses the A / Z / AA column boundaries", () => {
    assert.equal(parseRangeBounds("A1:A1")?.startCol, 0);
    assert.equal(parseRangeBounds("Z1:Z1")?.startCol, 25);
    assert.equal(parseRangeBounds("AA1:AB2")?.startCol, 26);
    assert.equal(parseRangeBounds("AA1:AB2")?.endCol, 27);
  });

  it("keeps a single-cell-wide/tall range (start == end)", () => {
    assert.deepEqual(parseRangeBounds("B3:B3"), { sheetPrefix: "", startCol: 1, startRow: 3, endCol: 1, endRow: 3 });
  });
});

describe("parseRangeBounds — sheet-qualified ranges (the #2390 case)", () => {
  it("splits an unquoted sheet prefix", () => {
    assert.deepEqual(parseRangeBounds("Sheet1!A2:C10"), { sheetPrefix: "Sheet1!", startCol: 0, startRow: 2, endCol: 2, endRow: 10 });
  });

  it("splits a quoted sheet name containing a space", () => {
    assert.deepEqual(parseRangeBounds("'My Sheet'!A1:B2"), { sheetPrefix: "'My Sheet'!", startCol: 0, startRow: 1, endCol: 1, endRow: 2 });
  });
});

describe("parseRangeBounds — non-ranges return null", () => {
  it("rejects a single cell (no colon)", () => {
    assert.equal(parseRangeBounds("A1"), null);
    assert.equal(parseRangeBounds("Sheet1!A1"), null);
  });

  it("rejects malformed input", () => {
    assert.equal(parseRangeBounds("not-a-range"), null);
    assert.equal(parseRangeBounds(""), null);
  });

  // Deliberate limitation, pinned so it is not "fixed" by accident: the parser
  // matches uppercase `[A-Z]` with no `$`, exactly as the four former copies did.
  // The engine's own cell reader (calculator.getCellValue) is likewise
  // uppercase-only, so accepting these here would not make them resolve.
  it("rejects lowercase and $-absolute ranges (matches prior lookup behaviour)", () => {
    assert.equal(parseRangeBounds("a1:b2"), null);
    assert.equal(parseRangeBounds("$A$1:$B$2"), null);
  });
});

describe("resolveIndexTarget — INDEX bounds (#2390)", () => {
  // A2:B5 → cols 0..1, rows 2..5 (4 rows × 2 cols).
  const bounds: RangeBounds = { sheetPrefix: "", startCol: 0, startRow: 2, endCol: 1, endRow: 5 };

  it("resolves an in-range 1-based position to an absolute cell", () => {
    assert.deepEqual(resolveIndexTarget(bounds, 1, 1), { colIndex: 0, row: 2 }); // A2
    assert.deepEqual(resolveIndexTarget(bounds, 4, 2), { colIndex: 1, row: 5 }); // B5
  });

  it("returns null (→ #REF!) when the row is past the range", () => {
    const single: RangeBounds = { sheetPrefix: "", startCol: 0, startRow: 1, endCol: 0, endRow: 3 };
    assert.equal(resolveIndexTarget(single, 5, 1), null); // INDEX(A1:A3,5)
  });

  it("returns null for a row/col below 1", () => {
    assert.equal(resolveIndexTarget(bounds, -1, 1), null);
    assert.equal(resolveIndexTarget(bounds, 1, 3), null); // col past the 2-wide range
  });

  it("treats Excel's 0 (whole line) as out of range for a multi-line dimension", () => {
    assert.equal(resolveIndexTarget(bounds, 0, 1), null); // INDEX(A2:B5,0,1) — must NOT read A1
  });

  it("collapses 0 to the only line when that dimension is a single cell", () => {
    const oneRow: RangeBounds = { sheetPrefix: "", startCol: 0, startRow: 3, endCol: 2, endRow: 3 };
    assert.deepEqual(resolveIndexTarget(oneRow, 0, 2), { colIndex: 1, row: 3 }); // whole (single) row, col 2 → B3
  });

  it("truncates a fractional index toward zero, like Excel", () => {
    assert.deepEqual(resolveIndexTarget(bounds, 2.9, 1), { colIndex: 0, row: 3 }); // 2.9 → row 2 → A3
  });
});
