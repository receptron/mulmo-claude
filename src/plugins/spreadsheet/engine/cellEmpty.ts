/**
 * Telling a genuinely empty cell apart from one that holds the number 0.
 *
 * The calculator reads a blank cell as 0 for arithmetic (`=A1+1` on a blank A1
 * is 1, as in Excel). But an aggregate must not: `AVERAGE` divides by the count
 * of real values, and `COUNT` counts numbers — a blank that reads as 0 inflates
 * the denominator and the count. So range collection needs to skip the blanks,
 * which means distinguishing them from a stored 0, which this does.
 */

import { isObj } from "../../../utils/types";

/** True when a cell holds no value at all — absent, null, or an empty/whitespace
 *  string, in either the bare or the `{ v }` form. A cell containing the number
 *  0, `false`, or any non-empty text is NOT empty. */
export function isEmptyCell(cell: unknown): boolean {
  if (cell === null || cell === undefined) return true;
  if (typeof cell === "string") return cell.trim() === "";
  if (isObj(cell)) {
    if (!("v" in cell)) return true;
    const value = (cell as { v: unknown }).v;
    if (value === null || value === undefined) return true;
    return typeof value === "string" && value.trim() === "";
  }
  return false;
}
