/**
 * DOM helpers for the mini-editor cell-highlight pass. Extracted from
 * the post-flush watch in `src/plugins/spreadsheet/View.vue`, which
 * had a cognitive complexity of 30 driven by four levels of nested
 * optional chaining + loops.
 *
 * These helpers are side-effectful by nature (they add/remove CSS
 * classes on DOM nodes) but each one is small enough that its
 * behaviour is obvious. Unit-testable with a minimal mock DOM; see
 * `test/plugins/spreadsheet/test_cellHighlights.ts`.
 */

/** Minimal DOM surface the helpers need. Defined here so tests can
 *  pass plain objects without pulling in jsdom. */
export interface HighlightableElement {
  classList: { add: (cls: string) => void; remove: (cls: string) => void };
}

export interface HighlightableRow {
  querySelectorAll: (selector: string) => ArrayLike<HighlightableElement>;
}

export interface HighlightableTable {
  querySelectorAll: (selector: string) => ArrayLike<HighlightableRow>;
}

export interface HighlightableContainer {
  // Overload: the spreadsheet root container is known to return a
  // table when asked for the table id, so callers can keep the
  // result strongly typed without casting.
  querySelector(selector: "#spreadsheet-table"): HighlightableTable | null;
  querySelector(selector: string): HighlightableElement | null;
  querySelectorAll(
    selector: string,
  ): ArrayLike<HighlightableElement> & Iterable<HighlightableElement>;
}

export interface CellCoord {
  row: number;
  col: number;
}

const CELL_EDITING = "cell-editing";
const CELL_REFERENCED = "cell-referenced";

/** Remove both kinds of highlight classes from the container. */
export function clearCellHighlights(
  container: HighlightableContainer | null | undefined,
): void {
  if (!container) return;
  container.querySelector(`.${CELL_EDITING}`)?.classList.remove(CELL_EDITING);
  for (const cell of container.querySelectorAll(`.${CELL_REFERENCED}`)) {
    cell.classList.remove(CELL_REFERENCED);
  }
}

/** Add `className` to the <td> at (row, col) of the given table.
 *  No-op if the row or cell doesn't exist. */
export function highlightCell(
  table: HighlightableTable | null | undefined,
  coord: CellCoord,
  className: string,
): void {
  if (!table) return;
  const rows = table.querySelectorAll("tr");
  const row = rows[coord.row];
  if (!row) return;
  const cells = row.querySelectorAll("td");
  const cell = cells[coord.col];
  if (!cell) return;
  cell.classList.add(className);
}

/** Apply the editing cell + referenced cells highlights. Looks up
 *  the #spreadsheet-table inside the container and no-ops if the
 *  table hasn't rendered yet. */
export function applyCellHighlights(
  container: HighlightableContainer | null | undefined,
  editingCell: CellCoord | null,
  references: readonly CellCoord[],
): void {
  if (!container) return;
  const table = container.querySelector("#spreadsheet-table");
  if (!table) return;
  if (editingCell) highlightCell(table, editingCell, CELL_EDITING);
  for (const ref of references) highlightCell(table, ref, CELL_REFERENCED);
}
