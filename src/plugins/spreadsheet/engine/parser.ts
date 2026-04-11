/**
 * Cell and Range Reference Parsing
 *
 * Handles Excel A1 notation parsing and conversion
 */

import type { CellRef, RangeRef } from "./types";

/**
 * Convert Excel column letters to 0-based index
 * A=0, B=1, ..., Z=25, AA=26, etc.
 *
 * @param col - Column letters (e.g., "A", "Z", "AA")
 * @returns 0-based column index
 */
export function columnToIndex(col: string): number {
  let result = 0;
  for (let i = 0; i < col.length; i++) {
    result = result * 26 + (col.charCodeAt(i) - 64); // A=1, B=2, etc.
  }
  return result - 1; // Convert to 0-based
}

/**
 * Convert 0-based index to Excel column letters
 * 0=A, 1=B, ..., 25=Z, 26=AA, etc.
 *
 * @param index - 0-based column index
 * @returns Column letters (e.g., "A", "Z", "AA")
 */
export function indexToColumn(index: number): string {
  let col = "";
  let num = index + 1; // Convert to 1-based
  while (num > 0) {
    const remainder = (num - 1) % 26;
    col = String.fromCharCode(65 + remainder) + col;
    num = Math.floor((num - 1) / 26);
  }
  return col;
}

/**
 * Parse a cell reference to its components
 * Supports: A1, $A$1, $A1, A$1, Sheet1!A1, 'My Sheet'!A1
 *
 * @param ref - Cell reference string
 * @returns Parsed cell reference object
 */
export function parseCellRef(ref: string): CellRef {
  let cellRef = ref;
  let sheetName: string | undefined;

  // Check for cross-sheet reference (e.g., 'Sheet Name'!B2 or Sheet1!B2)
  const sheetMatch = ref.match(/^(?:'([^']+)'|([^!]+))!(.+)$/);
  if (sheetMatch) {
    sheetName = sheetMatch[1] || sheetMatch[2]; // Quoted or unquoted sheet name
    cellRef = sheetMatch[3]; // Cell reference part
  }

  // Parse absolute references ($A$1)
  const absoluteRow = cellRef.includes("$") && cellRef.match(/\$\d+/);
  const absoluteCol = cellRef.includes("$") && cellRef.match(/\$[A-Z]+/);

  // Remove $ symbols
  const cleanRef = cellRef.replace(/\$/g, "");
  const match = cleanRef.match(/^([A-Z]+)(\d+)$/);

  if (!match) {
    throw new Error(`Invalid cell reference: ${ref}`);
  }

  const col = columnToIndex(match[1]);
  const row = parseInt(match[2]) - 1; // 1-indexed to 0-indexed

  const result: CellRef = { row, col };

  if (sheetName) {
    result.sheet = sheetName;
  }

  if (absoluteRow || absoluteCol) {
    result.absolute = {
      row: !!absoluteRow,
      col: !!absoluteCol,
    };
  }

  return result;
}

/**
 * Parse a range reference to its components
 * Supports: A1:B10, $A$1:$B$10, Sheet1!A1:B10
 *
 * @param range - Range reference string
 * @returns Parsed range reference object
 */
export function parseRangeRef(range: string): RangeRef {
  // Use non-greedy match to improve performance
  const colonIndex = range.lastIndexOf(":");
  if (colonIndex === -1) {
    throw new Error(`Invalid range reference: ${range}`);
  }

  const start = parseCellRef(range.substring(0, colonIndex));
  const end = parseCellRef(range.substring(colonIndex + 1));

  return { start, end };
}

/**
 * Convert a cell reference object back to A1 notation
 *
 * @param ref - Cell reference object
 * @returns A1 notation string
 */
export function cellRefToA1(ref: CellRef): string {
  const col = indexToColumn(ref.col);
  const row = ref.row + 1; // 0-based to 1-based

  let result = "";

  if (ref.absolute?.col) {
    result += "$";
  }
  result += col;

  if (ref.absolute?.row) {
    result += "$";
  }
  result += row;

  if (ref.sheet) {
    // Quote sheet name if it contains spaces
    if (ref.sheet.includes(" ")) {
      result = `'${ref.sheet}'!${result}`;
    } else {
      result = `${ref.sheet}!${result}`;
    }
  }

  return result;
}
