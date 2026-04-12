/**
 * Locate the start offset of a specific cell value inside a
 * pretty-printed JSON spreadsheet document. Extracted from
 * `handleTableClick` in `src/plugins/spreadsheet/View.vue` where the
 * inline scanner pushed cognitive complexity to 163.
 *
 * The scanner walks the raw editor text character-by-character,
 * tracking string boundaries, bracket depth, and object depth to
 * find the n-th cell of the m-th row within a named sheet's `data`
 * array. We deliberately do NOT parse the JSON — we need the
 * character offset inside the user's text buffer (which may not be
 * valid JSON mid-edit), so a positional scan is required.
 *
 * Pure — no refs, no DOM. Returns -1 if the cell can't be located.
 * Tested in `test/plugins/spreadsheet/engine/test_jsonCellLocator.ts`.
 */

// Advance `pos` through `text` until we reach the `rowIndex`-th
// opening `[` after `startPos` (counting from -1 so the first `[`
// encountered is index 0). Returns the position just after that
// opening bracket, or -1 if we ran off the end.
function findRowOpenBracket(
  text: string,
  startPos: number,
  rowIndex: number,
): number {
  let currentRow = -1;
  let inString = false;
  for (let i = startPos; i < text.length; i++) {
    const c = text[i];
    const prevChar = i > 0 ? text[i - 1] : "";
    // Track string literal boundaries so that a `[` inside a cell
    // value like `"has [bracket]"` doesn't get mistaken for a row
    // opener and throw off the row offset.
    if (c === '"' && prevChar !== "\\") {
      inString = !inString;
      continue;
    }
    if (!inString && c === "[") {
      currentRow++;
      if (currentRow === rowIndex) return i + 1;
    }
  }
  return -1;
}

// Starting just inside the row's `[`, scan for the start offset of
// the `colIndex`-th cell. Tracks string/object/bracket state so
// commas inside cell objects don't miscounted as cell separators.
// Returns -1 if the row ends before we reach colIndex.
function findCellStartWithinRow(
  text: string,
  rowStart: number,
  colIndex: number,
): number {
  let currentCol = 0;
  let inString = false;
  let inObject = 0;
  let bracketDepth = 1; // we already stepped past one `[`

  for (let i = rowStart; i < text.length; i++) {
    const c = text[i];
    const prevChar = i > 0 ? text[i - 1] : "";

    if (c === '"' && prevChar !== "\\") {
      inString = !inString;
    }

    if (!inString) {
      if (c === "[") bracketDepth++;
      if (c === "]") {
        bracketDepth--;
        if (bracketDepth === 0) return -1; // row ended before colIndex
      }
      if (c === "{") inObject++;
      if (c === "}") inObject--;
      if (c === "," && inObject === 0 && bracketDepth === 1) {
        currentCol++;
      }
    }

    // Once currentCol matches, skip any structural whitespace /
    // opening bracket / comma and return the first content char.
    if (currentCol === colIndex) {
      if (c !== " " && c !== "\n" && c !== "\t" && c !== "[" && c !== ",") {
        return i;
      }
    }
  }
  return -1;
}

/**
 * Given the pretty-printed JSON editor text, a sheet name, and
 * (rowIndex, colIndex), return the character offset of that cell's
 * JSON token. The returned offset can be fed into
 * `textarea.setSelectionRange(offset, offset + cellJsonLength)` to
 * highlight the cell.
 *
 * Returns -1 if the sheet isn't found or the (row, col) is out of
 * range. Never throws.
 */
export function findCellJsonPosition(
  editorText: string,
  sheetName: string,
  rowIndex: number,
  colIndex: number,
): number {
  // JSON.stringify escapes embedded quotes/backslashes so the marker
  // matches the way the sheet name actually appears in editorText.
  const sheetStartMarker = `"name": ${JSON.stringify(sheetName)}`;
  const dataStartMarker = `"data": [`;

  const sheetPos = editorText.indexOf(sheetStartMarker);
  if (sheetPos === -1) return -1;

  const dataPos = editorText.indexOf(dataStartMarker, sheetPos);
  if (dataPos === -1) return -1;

  const rowStart = findRowOpenBracket(
    editorText,
    dataPos + dataStartMarker.length,
    rowIndex,
  );
  if (rowStart === -1) return -1;

  return findCellStartWithinRow(editorText, rowStart, colIndex);
}
