/**
 * Extract the set of cells that a formula references.
 *
 * Extracted from `src/plugins/spreadsheet/View.vue` (was the body of
 * `extractCellReferences`, cognitive complexity 32). The original
 * function combined regex scanning, range expansion, single-cell
 * parsing, and deduplication all in one body; splitting each concern
 * into a named helper brings the top-level function well under the
 * sonarjs/cognitive-complexity threshold of 15 and makes the pure
 * logic unit-testable in isolation (see
 * `test/plugins/spreadsheet/engine/test_formulaRefs.ts`).
 *
 * Tracks #175. No behavioural change — the wrapper in View.vue
 * still returns exactly the same `{ row, col }` list as before.
 */

import { columnToIndex } from "./parser.js";

export interface CellCoord {
  row: number;
  col: number;
}

// `A1:B10`, `$A$1:$B$10`, `Sheet` refs are out of scope here — the
// caller only passes the formula body, and cross-sheet ranges never
// reached the original regex anyway. Keeping the patterns identical
// to the pre-refactor code preserves behaviour exactly.
const RANGE_REGEX = /\$?[A-Z]+\$?\d+:\$?[A-Z]+\$?\d+/g;
const CELL_REGEX = /\$?[A-Z]+\$?\d+/g;

// Excel formulas start with `=`. Strip it for uniform handling.
// Keeps any inner `=` intact (Excel does not allow them but the
// caller may pass partial text during live editing).
export function stripFormulaPrefix(formula: string): string {
  return formula.startsWith("=") ? formula.slice(1) : formula;
}

// Expand a single range token (`A1:B3`, `$A$1:$C$5`) into every
// coordinate the range covers. Returns an empty array for malformed
// input so callers never have to handle exceptions; the worst case
// is "we silently ignored a weird-looking substring," which matches
// the original inline behaviour.
export function expandRange(rangeStr: string): CellCoord[] {
  const cleanRange = rangeStr.replace(/\$/g, "");
  const match = cleanRange.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  if (!match) return [];
  const startCol = columnToIndex(match[1]);
  const startRow = parseInt(match[2], 10) - 1;
  const endCol = columnToIndex(match[3]);
  const endRow = parseInt(match[4], 10) - 1;
  const cells: CellCoord[] = [];
  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      cells.push({ row, col });
    }
  }
  return cells;
}

// Expand a range OR a single cell into coordinates, upcasing first so
// lowercase references (`a1:b2`, which spreadsheets accept) are not dropped,
// and falling back to a single cell when there is no colon. `collectRangeValues`
// in the calculator used a range-only, case-sensitive regex, so `A1`,
// `$A$1:$A$10` and `a1:a10` all silently produced no values (#2356). Ordering
// matches `expandRange`: top-to-bottom, left-to-right.
export function expandRangeOrCell(ref: string): CellCoord[] | null {
  const upper = ref.trim().toUpperCase();
  if (upper.includes(":")) {
    const cells = expandRange(upper);
    return cells.length > 0 ? cells : null;
  }
  const single = parseSingleCellRef(upper);
  return single ? [single] : null;
}

// Parse a single cell ref (`A1`, `$A$1`, `AA100`) into a coord.
// Returns null for malformed input rather than throwing — keeps the
// caller's loop flat (the engine-layer `parseCellRef` throws, which
// is fine for the evaluator but wrong for a best-effort scanner).
export function parseSingleCellRef(refStr: string): CellCoord | null {
  const cleanRef = refStr.replace(/\$/g, "");
  const match = cleanRef.match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  return {
    col: columnToIndex(match[1]),
    row: parseInt(match[2], 10) - 1,
  };
}

// Numeric bounds of a `A2:C10` range, with any `Sheet1!` / `'My Sheet'!`
// prefix kept verbatim so callers can rebuild sheet-qualified refs. Columns
// are 0-based (via `columnToIndex`); rows stay 1-based, matching A1 notation.
export interface RangeBounds {
  sheetPrefix: string;
  startCol: number;
  startRow: number;
  endCol: number;
  endRow: number;
}

// Split an optional sheet prefix from a range, then parse the `A2:C10` body.
// The prefix is everything up to and including the last `!`, so a quoted sheet
// name that itself contains no `!` (the common case) is preserved intact. The
// lookup functions each carried their own copy of this parse; one copy ran a
// sheet-unaware regex against the whole string and threw on `Sheet1!A2:C10`
// before the sheet-aware copy could run (#2390). Returns null for anything that
// is not a two-endpoint range so callers surface one "Invalid range" message.
export function parseRangeBounds(range: string): RangeBounds | null {
  const bang = range.lastIndexOf("!");
  const sheetPrefix = bang >= 0 ? range.slice(0, bang + 1) : "";
  const body = bang >= 0 ? range.slice(bang + 1) : range;
  const match = body.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  if (!match) return null;
  return {
    sheetPrefix,
    startCol: columnToIndex(match[1]),
    startRow: parseInt(match[2], 10),
    endCol: columnToIndex(match[3]),
    endRow: parseInt(match[4], 10),
  };
}

// Excel's `0` row/column index selects the entire row/column. This scalar engine
// returns a single cell, so `0` is representable only when that dimension is one
// line long; otherwise it is out of range.
const WHOLE_LINE_INDEX = 0;
const FIRST_INDEX = 1;

// Map a 1-based INDEX position onto a 0-based offset within a `size`-long line,
// truncating toward zero as Excel does. Returns null when the position falls
// outside the line — including a `0` (whole-line) request the scalar engine
// cannot collapse to one cell. Callers turn null into #REF!.
function lineOffset(position: number, size: number): number | null {
  const index = Math.trunc(position);
  if (!Number.isFinite(index)) return null;
  if (index === WHOLE_LINE_INDEX) return size === 1 ? 0 : null;
  if (index < FIRST_INDEX || index > size) return null;
  return index - FIRST_INDEX;
}

// Resolve INDEX(range, rowNum, colNum)'s 1-based position to an absolute cell
// within the range, or null (→ #REF!) when it falls outside. The former handler
// computed the target with no bounds check, so an out-of-range index silently
// read a cell outside the range (#2390: `INDEX(A1:A3,5)` read A5, `INDEX(A2:B5,
// 0,1)` read A1). Returned column is 0-based; row is 1-based (A1 notation).
export function resolveIndexTarget(bounds: RangeBounds, rowNum: number, colNum: number): { colIndex: number; row: number } | null {
  const rowOffset = lineOffset(rowNum, bounds.endRow - bounds.startRow + 1);
  const colOffset = lineOffset(colNum, bounds.endCol - bounds.startCol + 1);
  if (rowOffset === null || colOffset === null) return null;
  return { colIndex: bounds.startCol + colOffset, row: bounds.startRow + rowOffset };
}

// VLOOKUP's col_index_num / HLOOKUP's row_index_num as a 0-based offset inside
// the table, or null (→ #REF!) when it points outside. Excel rejects an index
// past the table's width; without the check the handler addressed a cell beyond
// the range and returned whatever lived there — usually a silent 0 (#2360).
export function resolveTableOffset(position: number, size: number): number | null {
  // Not `lineOffset`: INDEX reads a `0` position as "the whole line", which it
  // can collapse to one cell when the line is one long. A lookup index has no
  // such meaning — VLOOKUP's columns are numbered from 1 — so `0` is out of
  // range even for a single-column table (Codex review).
  const index = Math.trunc(position);
  if (!Number.isFinite(index)) return null;
  if (index < FIRST_INDEX || index > size) return null;
  return index - FIRST_INDEX;
}

// Top-level: scan the formula, expand any ranges, then pick up
// remaining single-cell refs, deduplicating as we go. Kept short
// (~15 lines) so the cognitive-complexity signal lands on the
// helpers if anything grows here.
export function extractCellReferences(formula: string): CellCoord[] {
  const clean = stripFormulaPrefix(formula);
  const refs: CellCoord[] = [];
  const seen = new Set<string>();
  const addUnique = (coord: CellCoord): void => {
    const key = `${coord.row},${coord.col}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(coord);
  };

  for (const range of clean.match(RANGE_REGEX) ?? []) {
    for (const coord of expandRange(range)) addUnique(coord);
  }
  // Strip matched ranges so the cell-regex doesn't re-emit their
  // endpoints as standalone refs (mirrors the original's second
  // `.replace(rangeRegex, "")` pass).
  const withoutRanges = clean.replace(RANGE_REGEX, "");
  for (const cellStr of withoutRanges.match(CELL_REGEX) ?? []) {
    const coord = parseSingleCellRef(cellStr);
    if (coord) addUnique(coord);
  }
  return refs;
}
