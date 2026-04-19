/**
 * Spreadsheet Calculator
 *
 * Core calculation engine with circular reference detection and cross-sheet support
 */

import { formatNumber } from "./formatter";
import { columnToIndex } from "./parser";
import { evaluateFormula as evaluateFormulaFn } from "./evaluator";
import { parseDate, getDefaultDateFormat } from "./date-parser";
import type {
  SheetData,
  CellValue,
  CalculatedSheet,
  CalculationError,
  FormulaInfo,
  SpreadsheetCell,
} from "./types";

/**
 * Normalize malformed data structures
 * Some models generate flat arrays instead of 2D arrays - fix them
 *
 * @param data - Potentially malformed sheet data
 * @returns Normalized 2D array
 */
function normalizeData(data: any): SpreadsheetCell[][] {
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
  if (typeof data[0] === "object" && data[0] !== null) {
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
function preprocessDates(data: SpreadsheetCell[][]): SpreadsheetCell[][] {
  return data.map((row) =>
    row.map((cell) => {
      // Skip if not a cell object or if it has a formula
      if (!cell || typeof cell !== "object" || !("v" in cell)) {
        return cell;
      }

      const value = cell.v;

      // Only parse strings that aren't formulas
      if (typeof value === "string" && !value.startsWith("=")) {
        const dateSerial = parseDate(value);

        if (dateSerial !== null) {
          // It's a date! Convert to serial number
          return {
            v: dateSerial,
            f: cell.f || getDefaultDateFormat(value), // Use existing format or detect from input
          };
        }
      }

      // Not a date, return as-is
      return cell;
    }),
  );
}

/**
 * Calculate formulas in a single sheet
 *
 * @param sheet - Sheet data to calculate
 * @param allSheets - All sheets for cross-sheet references
 * @returns Calculated sheet with formulas evaluated
 */
export function calculateSheet(
  sheet: SheetData,
  allSheets?: SheetData[],
): CalculatedSheet {
  // Normalize malformed data structures first
  const normalizedData = normalizeData(sheet.data);

  // Pre-process dates before calculation
  const processedData = preprocessDates(normalizedData);

  // Also preprocess all sheets if provided
  const processedAllSheets = allSheets?.map((s) => ({
    ...s,
    data: preprocessDates(normalizeData(s.data)),
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

  // Helper to extract raw value from cell with recursive formula evaluation
  const getRawValue = (cell: any, row?: number, col?: number): CellValue => {
    // Handle null/undefined cells - treat as 0
    if (cell === null || cell === undefined) return 0;

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
    if (typeof cell === "object" && cell !== null && "v" in cell) {
      const value = cell.v;
      // If value is a string starting with "=", it's a formula
      if (typeof value === "string" && value.startsWith("=")) {
        // Check if we have row/col info to evaluate recursively
        if (row !== undefined && col !== undefined) {
          const cellKey = `${row},${col}`;

          // Check for circular reference
          if (calculating.has(cellKey)) {
            console.warn(
              `Circular reference detected at row ${row}, col ${col}`,
            );
            errors.push({
              cell: { row, col },
              formula: value,
              error: "Circular reference detected",
              type: "circular",
            });
            return 0;
          }

          // Check if already calculated (result is cached as a number)
          const calculatedCell = calculated[row][col];
          if (typeof calculatedCell === "number") {
            return calculatedCell;
          }

          // Recursively evaluate the formula
          calculating.add(cellKey);
          try {
            const formula = value.substring(1); // Remove "=" prefix
            const result = evaluateFormula(formula);
            calculating.delete(cellKey);

            // Cache the calculated result (preserve strings and numbers)
            calculated[row][col] = result;

            return result;
          } catch (error) {
            calculating.delete(cellKey);
            console.error(
              `Error evaluating formula at row ${row}, col ${col}:`,
              error,
            );
            errors.push({
              cell: { row, col },
              formula: value,
              error: error instanceof Error ? error.message : String(error),
              type: "unknown",
            });
            return 0;
          }
        }
        return 0; // No position info, can't evaluate
      }
      // Try to parse as number, but preserve strings
      const num = parseFloat(value);
      return isNaN(num) ? value : num;
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
        const targetSheet = processedAllSheets?.find(
          (s) => s.name === targetSheetName,
        );
        if (targetSheet && targetSheet.data) {
          // Calculate formulas for the target sheet with cache
          const targetCalculated = targetSheet.data.map((row) => [...row]);
          sheetsCache.set(targetSheetName, targetCalculated);

          // Recursively calculate the target sheet
          const targetResult = calculateSheet(targetSheet, processedAllSheets);
          sheetsCache.set(targetSheetName, targetResult.data);
          sheetData = targetResult.data as any[][];
        } else {
          return 0; // Sheet not found
        }
      }
    }

    // Remove $ symbols for absolute references
    const cleanRef = cellRef.replace(/\$/g, "");
    const match = cleanRef.match(/^([A-Z]+)(\d+)$/);
    if (!match) return 0;

    const col = columnToIndex(match[1]); // A=0, B=1, ..., Z=25, AA=26, etc.
    const row = parseInt(match[2]) - 1; // 1-indexed to 0-indexed

    if (
      row < 0 ||
      row >= sheetData.length ||
      col < 0 ||
      col >= sheetData[row].length
    ) {
      return 0;
    }

    const cell = sheetData[row][col];
    // Pass row/col only if this is the current sheet (for recursive evaluation)
    return getRawValue(
      cell,
      isCurrentSheet ? row : undefined,
      isCurrentSheet ? col : undefined,
    );
  };

  const collectRangeValues = (
    range: string,
    options: { numericOnly: boolean },
  ): CellValue[] => {
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
        const targetSheet = processedAllSheets?.find(
          (s) => s.name === targetSheetName,
        );
        if (targetSheet && targetSheet.data) {
          const targetCalculated = targetSheet.data.map((row) => [...row]);
          sheetsCache.set(targetSheetName, targetCalculated);

          // Recursively calculate the target sheet
          const targetResult = calculateSheet(targetSheet, processedAllSheets);
          sheetsCache.set(targetSheetName, targetResult.data);
          sheetData = targetResult.data as any[][];
        } else {
          return [];
        }
      }
    }

    const match = rangeRef.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
    if (!match) return [];

    const startCol = columnToIndex(match[1]);
    const startRow = parseInt(match[2]) - 1;
    const endCol = columnToIndex(match[3]);
    const endRow = parseInt(match[4]) - 1;

    const values: CellValue[] = [];
    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        if (
          row >= 0 &&
          row < sheetData.length &&
          col >= 0 &&
          col < sheetData[row].length
        ) {
          const cell = sheetData[row][col];
          // Pass row/col only if current sheet (for recursive evaluation)
          const rawValue = getRawValue(
            cell,
            isCurrentSheet ? row : undefined,
            isCurrentSheet ? col : undefined,
          );

          if (options.numericOnly) {
            if (!isNaN(rawValue as number)) {
              values.push(rawValue);
            }
          } else {
            values.push(rawValue);
          }
        }
      }
    }
    return values;
  };

  // Helper to get numeric-only range values (legacy behavior)
  const getRangeValues = (range: string): CellValue[] =>
    collectRangeValues(range, { numericOnly: true });

  // Helper to get raw range values including text
  const getRangeValuesRaw = (range: string): CellValue[] =>
    collectRangeValues(range, { numericOnly: false });

  // Evaluate a formula with context
  const evaluateFormula = (formula: string): CellValue => {
    return evaluateFormulaFn(formula, {
      getCellValue,
      getRangeValues,
      getRangeValuesRaw,
      evaluateFormula,
    });
  };

  // Process all cells and calculate formulas
  for (let rowIdx = 0; rowIdx < data.length; rowIdx++) {
    for (let colIdx = 0; colIdx < data[rowIdx].length; colIdx++) {
      const originalCell = data[rowIdx][colIdx];
      const calculatedCell = calculated[rowIdx][colIdx];

      // Skip if cell was already calculated recursively
      if (
        typeof calculatedCell === "number" &&
        originalCell &&
        typeof originalCell === "object" &&
        "f" in originalCell
      ) {
        // Cell was already evaluated - keep it as number for now
        // Formatting will be applied at the end
        continue;
      }

      // Handle cell format {v, f}
      if (
        originalCell &&
        typeof originalCell === "object" &&
        "v" in originalCell
      ) {
        const value = originalCell.v;

        // Check if value is a formula (string starting with "=")
        if (typeof value === "string" && value.startsWith("=")) {
          // Remove the "=" prefix and evaluate the formula
          const formula = value.substring(1);

          // Track formula info
          formulas.push({
            cell: { row: rowIdx, col: colIdx },
            formula: value,
            dependencies: [], // TODO: Extract dependencies from formula
            result: 0, // Will be updated below
          });

          const result = evaluateFormula(formula);

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

  // Final formatting pass: apply formatting to all cells with format codes
  for (let rowIdx = 0; rowIdx < data.length; rowIdx++) {
    for (let colIdx = 0; colIdx < data[rowIdx].length; colIdx++) {
      const originalCell = data[rowIdx][colIdx];
      const calculatedValue = calculated[rowIdx][colIdx];

      if (
        originalCell &&
        typeof originalCell === "object" &&
        "v" in originalCell
      ) {
        const isFormula =
          typeof originalCell.v === "string" && originalCell.v.startsWith("=");

        // Apply formatting if cell has a format code and calculated value is a number
        if (
          "f" in originalCell &&
          originalCell.f &&
          typeof calculatedValue === "number"
        ) {
          calculated[rowIdx][colIdx] = formatNumber(
            calculatedValue,
            originalCell.f,
          );
        }
        // Auto-format date serial numbers from formulas without explicit format
        else if (
          isFormula &&
          typeof calculatedValue === "number" &&
          calculatedValue >= 36000 &&
          calculatedValue <= 63499 &&
          Number.isInteger(calculatedValue) &&
          (!("f" in originalCell) || !originalCell.f)
        ) {
          // Check if this looks like a date serial number
          // 36000 = Jul 1998, 63499 = Dec 2073
          // Must be integer (dates without time component)
          // Avoids formatting calculated averages/sums as dates
          // Apply default date format
          calculated[rowIdx][colIdx] = formatNumber(
            calculatedValue,
            "MM/DD/YYYY",
          );
        }
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
export function calculateWorkbook(sheets: SheetData[]): CalculatedSheet[] {
  return sheets.map((sheet) => calculateSheet(sheet, sheets));
}
