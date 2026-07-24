/**
 * Spreadsheet Calculator
 *
 * Core calculation engine with circular reference detection and cross-sheet support
 */

import { formatCellForDisplay } from "./cellFormatting";
import { columnToIndex } from "./parser";
import { evaluateFormula as evaluateFormulaFn } from "./evaluator";
import { expandRangeOrCell } from "./formulaRefs";
import { parseDate, getDefaultDateFormat } from "./date-parser";
import type { SheetData, CellValue, CalculatedSheet, CalculationError, FormulaInfo, SpreadsheetCell, CalculateOptions } from "./types";
import { isObj } from "../../../utils/types";
import { isEmptyCell } from "./cellEmpty";
import { errorMessage } from "../../../utils/errors";
import { classifyThrownError, invalidRefError } from "./formulaError";
import { isSpreadsheetErrorValue, spreadsheetError } from "./spreadsheet-errors";

/**
 * Normalize malformed data structures
 * Some models generate flat arrays instead of 2D arrays - fix them
 *
 * @param data - Potentially malformed sheet data
 * @returns Normalized 2D array
 */
export function normalizeData(data: any): SpreadsheetCell[][] {
  // Handle null/undefined
  if (!data) {
    return [];
  }

  // If not an array, wrap in array
  if (!Array.isArray(data)) {
    return [];
  }

  // Empty array
  if (data.length === 0) {
    return [];
  }

  // If data is already a 2D array, return as-is
  if (Array.isArray(data[0])) {
    return data as SpreadsheetCell[][];
  }

  // If data is a flat array of cell objects, convert to 2D by pairing cells
  // Pattern: [cell1, cell2, cell3, cell4] -> [[cell1, cell2], [cell3, cell4]]
  // This handles the case where models output flat arrays instead of rows
  if (isObj(data[0])) {
    const rows: SpreadsheetCell[][] = [];
    for (let i = 0; i < data.length; i += 2) {
      const row = [data[i]];
      if (i + 1 < data.length) {
        row.push(data[i + 1]);
      }
      rows.push(row);
    }
    return rows;
  }

  // Unknown structure - return empty
  console.warn("Unknown data structure in spreadsheet, returning empty:", data);
  return [];
}

/**
 * Pre-process sheet data to parse date strings into serial numbers
 *
 * @param data - Raw sheet data
 * @returns Processed data with dates converted to serial numbers
 */
function preprocessDates(data: SpreadsheetCell[][], preferDDMMYYYY: boolean): SpreadsheetCell[][] {
  return data.map((row) =>
    row.map((cell) => {
      // Skip if not a cell object or if it has a formula
      if (!isObj(cell) || !("v" in cell)) {
        return cell;
      }

      const value = cell.v;

      // Only parse strings that aren't formulas
      if (typeof value === "string" && !value.startsWith("=")) {
        const dateSerial = parseDate(value, preferDDMMYYYY);

        if (dateSerial !== null) {
          // It's a date! Convert to serial number
          return {
            v: dateSerial,
            f: cell.f || getDefaultDateFormat(value, preferDDMMYYYY), // Use existing format or detect from input
          };
        }
      }

      // Not a date, return as-is
      return cell;
    }),
  );
}

// `skipFormatting` is internal, not a public knob: a cross-sheet reference
// computes its target sheet only to READ values, so the display-formatting pass
// is skipped there — a date must stay a serial, not become "03/04/2025" that a
// downstream parseFloat reads as 3 (issue #2332).
type SheetCalculateOptions = CalculateOptions & { skipFormatting?: boolean };

/**
 * Calculate formulas in a single sheet
 *
 * @param sheet - Sheet data to calculate
 * @param allSheets - All sheets for cross-sheet references
 * @returns Calculated sheet with formulas evaluated
 */
export function calculateSheet(sheet: SheetData, allSheets?: SheetData[], options: SheetCalculateOptions = {}): CalculatedSheet {
  const preferDDMMYYYY = options.preferDDMMYYYY ?? false;
  const skipFormatting = options.skipFormatting ?? false;
  // Normalize malformed data structures first
  const normalizedData = normalizeData(sheet.data);

  // Pre-process dates before calculation
  const processedData = preprocessDates(normalizedData, preferDDMMYYYY);

  // Also preprocess all sheets if provided
  const processedAllSheets = allSheets?.map((s) => ({
    ...s,
    data: preprocessDates(normalizeData(s.data), preferDDMMYYYY),
  }));

  const data = processedData;
  const sheetName = sheet.name;
  // Cache stores either SpreadsheetCell[][] (before calculation) or CellValue[][] (after)
  const sheetsCache = new Map<string, (SpreadsheetCell | CellValue)[][]>();
  const errors: CalculationError[] = [];
  const formulas: FormulaInfo[] = [];

  // Create a copy of the data with calculated values
  const calculated: any[][] = data.map((row) => [...row]);

  // Add current sheet to cache to prevent infinite loops
  sheetsCache.set(sheetName, calculated);

  // Track cells being calculated to detect circular references
  const calculating = new Set<string>();
  // Cells whose result is already stored in `calculated`, of ANY type. A number
  // check alone missed string/error results, so a cell referenced before the
  // top loop reached it was re-evaluated (and, once formulas can throw, would
  // re-emit its error). Membership here means "read the cached value, do not
  // re-run".
  const evaluated = new Set<string>();

  // Evaluate one formula cell, guarding circular references, caching the result,
  // and turning a thrown failure into a typed errors[] entry plus the Excel
  // error value in the cell — never a swallowed bare string/number (#2359).
  const resolveFormulaCell = (formulaText: string, row: number, col: number): CellValue => {
    const cellKey = `${row},${col}`;
    if (calculating.has(cellKey)) {
      errors.push({ cell: { row, col }, formula: formulaText, error: "Circular reference detected", type: "circular" });
      return 0;
    }
    if (evaluated.has(cellKey)) return calculated[row][col];
    calculating.add(cellKey);
    try {
      const result = evaluateFormula(formulaText.substring(1)); // drop leading "="
      calculated[row][col] = result;
      return result;
    } catch (error) {
      const { type, display } = classifyThrownError(error);
      errors.push({ cell: { row, col }, formula: formulaText, error: errorMessage(error), type });
      // The error VALUE, not its text: a cell that reads this one must see a
      // real error, and the display pass renders it back to `#DIV/0!`.
      const errorValue = spreadsheetError(display);
      calculated[row][col] = errorValue;
      return errorValue;
    } finally {
      calculating.delete(cellKey);
      evaluated.add(cellKey);
    }
  };

  // Helper to extract raw value from cell with recursive formula evaluation
  const getRawValue = (cell: any, row?: number, col?: number): CellValue => {
    // Handle null/undefined cells - treat as 0
    if (cell === null || cell === undefined) return 0;

    // An already-calculated cell can hold a formula error; it stays an error.
    if (isSpreadsheetErrorValue(cell)) return cell;

    if (typeof cell === "number") return cell;

    // Handle string values (for legacy or calculated cells)
    if (typeof cell === "string") {
      // Handle empty strings as 0
      if (cell.trim() === "") return 0;

      // Handle percentage strings like "5%" or "0.4167%"
      if (cell.includes("%")) {
        const numericPart = cell.replace("%", "").trim();
        const value = parseFloat(numericPart);
        return isNaN(value) ? 0 : value / 100;
      }
      // Handle currency strings like "$1,000" or "$1,000.00"
      if (cell.includes("$")) {
        const numericPart = cell.replace(/[$,]/g, "").trim();
        const value = parseFloat(numericPart);
        return isNaN(value) ? 0 : value;
      }
      // Handle comma-separated numbers like "1,000"
      if (cell.includes(",")) {
        const numericPart = cell.replace(/,/g, "").trim();
        const value = parseFloat(numericPart);
        return isNaN(value) ? 0 : value;
      }
      // Handle regular numeric strings, but preserve non-numeric strings
      const num = parseFloat(cell);
      return isNaN(num) ? cell : num;
    }

    // Handle new cell format {v, f}
    if (isObj(cell) && "v" in cell) {
      const value = cell.v;
      // If value is a string starting with "=", it's a formula
      if (typeof value === "string" && value.startsWith("=")) {
        // Only evaluatable when we know the cell's position (for recursion +
        // circular tracking); otherwise treat as 0.
        if (row !== undefined && col !== undefined) {
          return resolveFormulaCell(value, row, col);
        }
        return 0; // No position info, can't evaluate
      }
      // Try to parse as number, but preserve original type on failure
      if (typeof value === "number") return value;
      if (typeof value === "boolean") return value;
      if (typeof value === "string") {
        const num = parseFloat(value);
        return isNaN(num) ? value : num;
      }
      return String(value);
    }

    // Try to parse cell as number, but preserve strings
    const num = parseFloat(cell);
    return isNaN(num) ? cell : num;
  };

  // Helper to get cell value by reference (e.g., "B2", "$B$2", or "'Sheet1'!B2")
  const getCellValue = (ref: string): CellValue => {
    let sheetData: any[][] = calculated;
    let cellRef = ref;
    let isCurrentSheet = true;

    // Check for cross-sheet reference (e.g., 'Sheet Name'!B2 or Sheet1!B2)
    const sheetMatch = ref.match(/^(?:'([^']+)'|([^!]+))!(.+)$/);
    if (sheetMatch) {
      const targetSheetName = sheetMatch[1] || sheetMatch[2]; // Quoted or unquoted sheet name
      cellRef = sheetMatch[3]; // Cell reference part
      isCurrentSheet = false;

      // Check cache first to prevent infinite loops
      if (sheetsCache.has(targetSheetName)) {
        sheetData = sheetsCache.get(targetSheetName)!;
      } else {
        // Find the sheet in all sheets
        const targetSheet = processedAllSheets?.find((s) => s.name === targetSheetName);
        if (targetSheet && targetSheet.data) {
          // Calculate formulas for the target sheet with cache
          const targetCalculated = targetSheet.data.map((row) => [...row]);
          sheetsCache.set(targetSheetName, targetCalculated);

          // Resolve cross-sheet values RAW (skip display formatting) so a date
          // cell reads as its serial, not the presentation string "03/04/2025".
          const targetResult = calculateSheet(targetSheet, processedAllSheets, { preferDDMMYYYY, skipFormatting: true });
          sheetsCache.set(targetSheetName, targetResult.data);
          sheetData = targetResult.data as any[][];
        } else {
          throw invalidRefError(ref); // Sheet not found → #REF!
        }
      }
    }

    // Remove $ symbols for absolute references
    const cleanRef = cellRef.replace(/\$/g, "");
    const match = cleanRef.match(/^([A-Z]+)(\d+)$/);
    if (!match) return 0;

    const col = columnToIndex(match[1]); // A=0, B=1, ..., Z=25, AA=26, etc.
    const row = parseInt(match[2]) - 1; // 1-indexed to 0-indexed

    if (row < 0 || row >= sheetData.length || col < 0 || col >= sheetData[row].length) {
      return 0;
    }

    const cell = sheetData[row][col];
    // Pass row/col only if this is the current sheet (for recursive evaluation)
    return getRawValue(cell, isCurrentSheet ? row : undefined, isCurrentSheet ? col : undefined);
  };

  const collectRangeValues = (range: string, options: { numericOnly: boolean }): CellValue[] => {
    let sheetData: any[][] = calculated;
    let rangeRef = range;
    let isCurrentSheet = true;

    // Check for cross-sheet reference
    const sheetMatch = range.match(/^(?:'([^']+)'|([^!]+))!(.+)$/);
    if (sheetMatch) {
      const targetSheetName = sheetMatch[1] || sheetMatch[2];
      rangeRef = sheetMatch[3];
      isCurrentSheet = false;

      // Check cache first
      if (sheetsCache.has(targetSheetName)) {
        sheetData = sheetsCache.get(targetSheetName)!;
      } else {
        // Find and calculate the target sheet
        const targetSheet = processedAllSheets?.find((s) => s.name === targetSheetName);
        if (targetSheet && targetSheet.data) {
          const targetCalculated = targetSheet.data.map((row) => [...row]);
          sheetsCache.set(targetSheetName, targetCalculated);

          // Resolve cross-sheet values RAW (skip display formatting) so a date
          // cell reads as its serial, not the presentation string "03/04/2025".
          const targetResult = calculateSheet(targetSheet, processedAllSheets, { preferDDMMYYYY, skipFormatting: true });
          sheetsCache.set(targetSheetName, targetResult.data);
          sheetData = targetResult.data as any[][];
        } else {
          return [];
        }
      }
    }

    const coords = expandRangeOrCell(rangeRef);
    if (!coords) return [];

    const values: CellValue[] = [];
    for (const { row, col } of coords) {
      if (row >= 0 && row < sheetData.length && col >= 0 && col < sheetData[row].length) {
        const cell = sheetData[row][col];
        // Pass row/col only if current sheet (for recursive evaluation)
        const rawValue = getRawValue(cell, isCurrentSheet ? row : undefined, isCurrentSheet ? col : undefined);

        if (options.numericOnly) {
          // A blank cell is not a value. Dropping it from the NUMERIC list keeps
          // SUM unchanged (a blank read as 0) while stopping it from inflating
          // AVERAGE's denominator and COUNT's tally (#2358). The raw list keeps
          // every cell so SUMIF/AVERAGEIF's criteria and value ranges stay
          // row-aligned; dropping there would shift indexes and aggregate the
          // wrong rows (Codex review).
          if (!isEmptyCell(cell) && !isNaN(rawValue as number)) {
            values.push(rawValue);
          }
        } else {
          values.push(rawValue);
        }
      }
    }
    return values;
  };

  // Helper to get numeric-only range values (legacy behavior)
  const getRangeValues = (range: string): CellValue[] => collectRangeValues(range, { numericOnly: true });

  // Helper to get raw range values including text
  const getRangeValuesRaw = (range: string): CellValue[] => collectRangeValues(range, { numericOnly: false });

  // Evaluate a formula with context
  const evaluateFormula = (formula: string): CellValue => {
    return evaluateFormulaFn(formula, {
      getCellValue,
      getRangeValues,
      getRangeValuesRaw,
      evaluateFormula,
      preferDDMMYYYY,
    });
  };

  // Process all cells and calculate formulas
  for (let rowIdx = 0; rowIdx < data.length; rowIdx++) {
    for (let colIdx = 0; colIdx < data[rowIdx].length; colIdx++) {
      const originalCell = data[rowIdx][colIdx];
      const calculatedCell = calculated[rowIdx][colIdx];

      // Skip if cell was already calculated recursively
      if (typeof calculatedCell === "number" && isObj(originalCell) && "f" in originalCell) {
        // Cell was already evaluated - keep it as number for now
        // Formatting will be applied at the end
        continue;
      }

      // Handle cell format {v, f}
      if (isObj(originalCell) && "v" in originalCell) {
        const value = originalCell.v;

        // Check if value is a formula (string starting with "=")
        if (typeof value === "string" && value.startsWith("=")) {
          // Track formula info
          formulas.push({
            cell: { row: rowIdx, col: colIdx },
            formula: value,
            dependencies: [], // TODO: Extract dependencies from formula
            result: 0, // Will be updated below
          });

          // Route through the protected path so a thrown failure is classified
          // into errors[] instead of escaping this loop, and a cell already
          // resolved via another formula's recursion is read from cache (#2359).
          const result = resolveFormulaCell(value, rowIdx, colIdx);

          // Update formula result
          formulas[formulas.length - 1].result = result;

          // Store result as-is (formatting will be applied at the end)
          calculated[rowIdx][colIdx] = result;
        } else {
          // Regular value cell (not a formula)
          // Convert to plain value (important for range evaluation)
          calculated[rowIdx][colIdx] = value;
        }
      }
      // If cell is not in {v, f} format, leave it as-is (already a plain value)
    }
  }

  // Final display-formatting pass: turn raw serials into presentation strings.
  // Skipped when this sheet is computed only to resolve a cross-sheet reference,
  // so the referencing cell reads the underlying value, not a display string.
  if (!skipFormatting) {
    for (let rowIdx = 0; rowIdx < data.length; rowIdx++) {
      for (let colIdx = 0; colIdx < data[rowIdx].length; colIdx++) {
        calculated[rowIdx][colIdx] = formatCellForDisplay(data[rowIdx][colIdx], calculated[rowIdx][colIdx], preferDDMMYYYY);
      }
    }
  }

  return {
    name: sheetName,
    data: calculated,
    formulas,
    errors,
  };
}

/**
 * Calculate all sheets in a workbook
 *
 * @param sheets - Array of sheets to calculate
 * @returns Array of calculated sheets
 */
export function calculateWorkbook(sheets: SheetData[], options: CalculateOptions = {}): CalculatedSheet[] {
  return sheets.map((sheet) => calculateSheet(sheet, sheets, options));
}
