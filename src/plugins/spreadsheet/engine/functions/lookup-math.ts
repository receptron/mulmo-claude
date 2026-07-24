/**
 * Pure lookup rules, separated from the range-reading handlers so they can be
 * unit-tested directly.
 */

import type { CellValue } from "../types";
import { isSpreadsheetErrorValue } from "../spreadsheet-errors";

/**
 * Interpret VLOOKUP/HLOOKUP's 4th argument (range_lookup): TRUE (or omitted) =
 * approximate match, FALSE = exact.
 *
 * The literal `TRUE` reaches the handler as the STRING `"TRUE"` — the evaluator
 * leaves bare words unquoted — so an accept-only-`true | 1 | "1"` check silently
 * fell back to exact match and returned `#N/A` for a valid approximate lookup
 * (#2360). Read it the way Excel coerces a logical instead: a boolean as-is, a
 * non-zero number as TRUE, and the words `TRUE` / `FALSE` (case-insensitive)
 * and `"1"` / `"0"` as their logical value. Anything else (blank, stray text)
 * is treated as FALSE, matching Excel's coercion of a blank range_lookup — and
 * so is a formula error, which is neither of the two logicals.
 */
export function isApproximateMatch(rangeLookup: CellValue): boolean {
  if (typeof rangeLookup === "boolean") return rangeLookup;
  if (typeof rangeLookup === "number") return rangeLookup !== 0;
  if (isSpreadsheetErrorValue(rangeLookup)) return false;
  const normalized = rangeLookup.trim().toUpperCase();
  return normalized === "TRUE" || normalized === "1";
}
