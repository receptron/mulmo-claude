// Pure helpers behind the spreadsheet mini-editor's arrow-key
// navigation. Lifted out of View.vue so each rule can be unit-tested
// without spinning up Vue or a DOM.

export interface CellPosition {
  row: number;
  col: number;
}

// Sheet shape we actually rely on — the mini-editor only reads
// `data` as a 2D array, so the type is intentionally loose to match
// what arrives from `JSON.parse(editableData.value)`.
export interface SheetLike {
  data?: unknown[][];
}

export function getArrowKeyOffset(key: string, row: number, col: number): CellPosition | null {
  switch (key) {
    case "ArrowUp":
      return { row: Math.max(0, row - 1), col };
    case "ArrowDown":
      return { row: row + 1, col };
    case "ArrowLeft":
      return { row, col: Math.max(0, col - 1) };
    case "ArrowRight":
      return { row, col: col + 1 };
    default:
      return null;
  }
}

export function isWithinSheetBounds(sheet: SheetLike | null | undefined, row: number, col: number): boolean {
  if (!sheet?.data) return false;
  if (row < 0 || row >= sheet.data.length) return false;
  const rowData = sheet.data[row];
  if (!rowData) return false;
  return col >= 0 && col < rowData.length;
}
