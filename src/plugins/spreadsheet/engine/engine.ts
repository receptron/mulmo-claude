/**
 * SpreadsheetEngine - Main API
 *
 * High-level interface for spreadsheet calculations
 */

import { calculateSheet, calculateWorkbook } from "./calculator";
import type {
  SheetData,
  CalculatedSheet,
  EngineOptions,
  SpreadsheetCell,
} from "./types";

/**
 * SpreadsheetEngine - Main calculation engine class
 *
 * Provides a clean API for calculating spreadsheet formulas with support for:
 * - Formula evaluation (SUM, AVERAGE, IF, etc.)
 * - Cell references (A1, $B$2, Sheet1!C3)
 * - Cross-sheet references
 * - Number formatting ($#,##0.00, 0.00%, etc.)
 * - Circular reference detection
 *
 * @example
 * ```typescript
 * const engine = new SpreadsheetEngine();
 * const sheet = {
 *   name: 'Sales',
 *   data: [
 *     [{v: 'Product'}, {v: 'Price'}, {v: 'Qty'}, {v: 'Total'}],
 *     [{v: 'Widget'}, {v: 10}, {v: 100}, {v: '=B2*C2'}],
 *   ]
 * };
 * const result = engine.calculate(sheet);
 * console.log(result.data); // [['Product', 'Price', 'Qty', 'Total'], ['Widget', 10, 100, 1000]]
 * ```
 */
export class SpreadsheetEngine {
  private options: Required<EngineOptions>;

  /**
   * Create a new SpreadsheetEngine
   *
   * @param options - Configuration options
   */
  constructor(options: EngineOptions = {}) {
    this.options = {
      maxIterations: options.maxIterations ?? 100,
      enableCrossSheetRefs: options.enableCrossSheetRefs ?? true,
      strictMode: options.strictMode ?? false,
    };
  }

  /**
   * Calculate a single sheet
   *
   * Evaluates all formulas in the sheet and applies number formatting.
   * Returns calculated values with formula metadata and any errors.
   *
   * @param sheet - Sheet data with formulas
   * @param allSheets - Optional array of all sheets for cross-sheet references
   * @returns Calculated sheet with evaluated formulas
   *
   * @example
   * ```typescript
   * const result = engine.calculate({
   *   name: 'Budget',
   *   data: [
   *     [{v: 'Item'}, {v: 'Amount'}],
   *     [{v: 'Revenue'}, {v: 1000}],
   *     [{v: 'Expenses'}, {v: 600}],
   *     [{v: 'Profit'}, {v: '=B2-B3'}],
   *   ]
   * });
   * console.log(result.data[3][1]); // 400
   * ```
   */
  calculate(sheet: SheetData, allSheets?: SheetData[]): CalculatedSheet {
    return calculateSheet(sheet, allSheets);
  }

  /**
   * Calculate all sheets in a workbook
   *
   * Evaluates formulas across multiple sheets with support for
   * cross-sheet references (e.g., Sheet1!A1).
   *
   * @param sheets - Array of sheets to calculate
   * @returns Array of calculated sheets
   *
   * @example
   * ```typescript
   * const results = engine.calculateWorkbook([
   *   { name: 'Data', data: [[{v: 100}]] },
   *   { name: 'Summary', data: [[{v: '=Data!A1*2'}]] }
   * ]);
   * console.log(results[1].data[0][0]); // 200
   * ```
   */
  calculateWorkbook(sheets: SheetData[]): CalculatedSheet[] {
    return calculateWorkbook(sheets);
  }

  /**
   * Get current engine options
   *
   * @returns Current configuration options
   */
  getOptions(): Required<EngineOptions> {
    return { ...this.options };
  }

  /**
   * Update engine options
   *
   * @param options - Options to update
   *
   * @example
   * ```typescript
   * engine.setOptions({ strictMode: true });
   * ```
   */
  setOptions(options: Partial<EngineOptions>): void {
    this.options = {
      ...this.options,
      ...options,
    };
  }

  /**
   * Create a simple sheet from array data
   *
   * Helper method to create a SheetData object from simple arrays.
   * Automatically converts values to SpreadsheetCell format.
   *
   * @param name - Sheet name
   * @param data - Array of arrays (rows and cells)
   * @returns SheetData object
   *
   * @example
   * ```typescript
   * const sheet = engine.createSheet('Sales', [
   *   ['Product', 'Price', 'Qty', 'Total'],
   *   ['Widget', 10, 100, '=B2*C2'],
   * ]);
   * ```
   */
  createSheet(
    name: string,
    data: Array<Array<SpreadsheetCell | string | number>>,
  ): SheetData {
    return {
      name,
      data: data.map((row) =>
        row.map((cell) => {
          if (typeof cell === "object" && cell !== null && "v" in cell) {
            return cell as SpreadsheetCell;
          }
          return { v: cell };
        }),
      ),
    };
  }

  /**
   * Convert calculated sheet data to string array
   *
   * Helper method for testing and output formatting.
   *
   * @param calculated - Calculated sheet
   * @returns 2D array of strings
   *
   * @example
   * ```typescript
   * const result = engine.calculate(sheet);
   * const stringArray = engine.toStringArray(result);
   * ```
   */
  toStringArray(calculated: CalculatedSheet): string[][] {
    return calculated.data.map((row) => row.map((cell) => String(cell ?? "")));
  }
}
