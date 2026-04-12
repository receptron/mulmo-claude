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
