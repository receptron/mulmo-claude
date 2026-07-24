/**
 * Numeric coercion helpers for the spreadsheet engine.
 *
 * Two intentionally different reads share one string parser (`parseNumericString`):
 *  - `registry.toNumber` — lenient, for range aggregation (SUM / AVERAGE / …):
 *    anything unreadable becomes 0. PINNED (booleans are 0, not Excel's 1/0).
 *  - `toScalarNumber` — strict, for single-value math functions (ABS / SIGN):
 *    booleans are 1/0 and non-numeric text is `#VALUE!`, matching Excel.
 */

import type { CellValue } from "./types";
import { VALUE_ERROR, type SpreadsheetError } from "./spreadsheet-errors";

const numberOrNull = (num: number): number | null => (isNaN(num) ? null : num);

/**
 * Parse a spreadsheet string as a number, or `null` when it holds no number.
 *
 * Mirrors the engine's long-standing lenient read: a percentage, a currency
 * amount, or a thousands-separated value, else a bare `parseFloat` (which reads a
 * leading number out of "12abc"). The branch order is load-bearing — each strips
 * only its own characters, so a string mixing "%" and "$" fails in the first.
 */
export function parseNumericString(value: string): number | null {
  if (value.includes("%")) {
    const num = numberOrNull(parseFloat(value.replace("%", "").trim()));
    return num === null ? null : num / 100;
  }
  if (value.includes("$")) return numberOrNull(parseFloat(value.replace(/[$,]/g, "").trim()));
  if (value.includes(",")) return numberOrNull(parseFloat(value.replace(/,/g, "").trim()));
  return numberOrNull(parseFloat(value));
}

/**
 * Strict scalar coercion for single-value math functions (ABS, SIGN). Follows
 * Excel's scalar rules: a boolean is 1 / 0 and genuinely non-numeric text is
 * `#VALUE!` rather than a silent 0. A partly-numeric string still yields its
 * leading number, matching the engine's other numeric reads.
 */
export function toScalarNumber(value: CellValue): number | SpreadsheetError {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value !== "string") return value;
  return parseNumericString(value) ?? VALUE_ERROR;
}
