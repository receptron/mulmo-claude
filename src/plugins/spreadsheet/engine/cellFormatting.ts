/**
 * Cell display formatting
 *
 * Turns a cell's raw calculated value into its display value (currency,
 * percentage, date, ...). Pure — no engine state — so cross-sheet reference
 * resolution can deliberately SKIP it and keep raw serial numbers, while the
 * final output pass applies it for presentation.
 */

import { formatNumber } from "./formatter";
import { isRecord } from "../../../utils/types";
import { isSpreadsheetErrorValue } from "./spreadsheet-errors";
import type { CellValue, SpreadsheetCell, StoredCellValue } from "./types";

// Integer serials the engine is willing to auto-format as dates without an
// explicit format code: ~Jul 1998 (36000) through ~Dec 2073 (63499). Narrow on
// purpose so ordinary sums/averages are not mistaken for dates.
const DATE_SERIAL_MIN = 36000;
const DATE_SERIAL_MAX = 63499;

const isSpreadsheetCell = (value: unknown): value is SpreadsheetCell => isRecord(value) && "v" in value;

/** An integer within the date-serial window — a calculated number the engine
 *  should display as a date when the cell carries no explicit format. */
export const isLikelyDateSerial = (value: CellValue): boolean =>
  typeof value === "number" && Number.isInteger(value) && value >= DATE_SERIAL_MIN && value <= DATE_SERIAL_MAX;

/**
 * Resolve the display value of one cell from its original definition and its
 * calculated value.
 *
 * - A formula error renders as its code, so the cell still reads `#NUM!`.
 * - Explicit format code wins (currency, percentage, date, ...).
 * - A formula that produced a date serial auto-formats as a date.
 * - Everything else (text, plain numbers, empty) passes through unchanged.
 *
 * The result is always a STORED value: this is the boundary where a computed
 * error becomes the text a cell shows and a workbook serializes.
 */
export const formatCellForDisplay = (originalCell: unknown, calculatedValue: CellValue, preferDDMMYYYY: boolean): StoredCellValue => {
  if (isSpreadsheetErrorValue(calculatedValue)) {
    return calculatedValue.code;
  }
  if (!isSpreadsheetCell(originalCell) || typeof calculatedValue !== "number") {
    return calculatedValue;
  }

  const explicitFormat = typeof originalCell.f === "string" ? originalCell.f : "";
  if (explicitFormat) {
    return formatNumber(calculatedValue, explicitFormat);
  }

  const isFormula = typeof originalCell.v === "string" && originalCell.v.startsWith("=");
  if (isFormula && isLikelyDateSerial(calculatedValue)) {
    return formatNumber(calculatedValue, preferDDMMYYYY ? "DD/MM/YYYY" : "MM/DD/YYYY");
  }

  return calculatedValue;
};
