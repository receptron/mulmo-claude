/**
 * Spreadsheet Engine Type Definitions
 */

export type CellValue = number | string | boolean;

export interface SpreadsheetCell {
  v: CellValue; // Value or formula (formulas start with "=")
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

export interface EngineOptions {
  maxIterations?: number; // For circular reference detection
  enableCrossSheetRefs?: boolean; // Default: true
  strictMode?: boolean; // Throw on errors vs. return 0
}
