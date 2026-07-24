/**
 * Spreadsheet Engine Type Definitions
 */

import type { SpreadsheetError } from "./spreadsheet-errors";

/** A value as it is STORED in a cell and serialized to the workbook JSON. A
 *  formula error is never stored — it only exists as a computed result. */
export type StoredCellValue = number | string | boolean;

/** A value as the engine COMPUTES it: a stored value, or a formula error. */
export type CellValue = StoredCellValue | SpreadsheetError;

export interface SpreadsheetCell {
  v: StoredCellValue; // Value or formula (formulas start with "=")
  f?: string; // Format code (e.g., "$#,##0.00")
}

export interface SheetData {
  name: string;
  data: SpreadsheetCell[][];
}

export interface CalculatedSheet {
  name: string;
  data: CellValue[][]; // Calculated values
  formulas: FormulaInfo[]; // Formula metadata
  errors: CalculationError[]; // Any errors encountered
}

export interface CellRef {
  row: number;
  col: number;
  sheet?: string; // For cross-sheet refs
  absolute?: {
    // For $A$1 style
    row: boolean;
    col: boolean;
  };
}

export interface RangeRef {
  start: CellRef;
  end: CellRef;
}

export interface EvaluationContext {
  currentSheet: string;
  sheets: Map<string, SpreadsheetCell[][]>;
  calculatedValues?: Map<string, CellValue>; // Cache
}

export interface FormulaInfo {
  cell: CellRef;
  formula: string;
  dependencies: CellRef[];
  result: CellValue;
}

export interface CalculationError {
  cell: CellRef;
  formula: string;
  error: string;
  type: "circular" | "invalid_ref" | "div_zero" | "syntax" | "unknown";
}

/** Per-calculation settings that change how cell CONTENT is read, as opposed
 *  to how the engine runs. Passed down explicitly so the engine stays pure —
 *  no ambient locale, no import-time state. */
export interface CalculateOptions {
  /** Read an ambiguous `A/B/YYYY` date as day-first. Only affects dates whose
   *  two leading numbers are both 12 or under; anything else decides itself.
   *  See engine/date-locale.ts for how a locale maps onto this. */
  preferDDMMYYYY?: boolean;
}

export interface EngineOptions extends CalculateOptions {
  maxIterations?: number; // For circular reference detection
  enableCrossSheetRefs?: boolean; // Default: true
  strictMode?: boolean; // Throw on errors vs. return 0
}
