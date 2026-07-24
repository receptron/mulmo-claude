import type { CellValue } from "./types";
import { isSpreadsheetErrorValue } from "./spreadsheet-errors";

/** Excel-style truthiness, shared by IF and AND/OR/NOT so the same value cannot
 *  read as true in one function and false in another. A number is false only
 *  when 0; blank and empty text are false; the words `true`/`false` are their
 *  logical values (case-insensitively); a numeric string follows its number
 *  (`"0"` → false); any other non-empty text is true. */
export function coerceToBoolean(value: CellValue | null | undefined): boolean {
  if (typeof value === "boolean") return value;
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return value !== 0;
  // Pinned: an error reads as non-empty text, i.e. true — the same answer the
  // error strings gave before they became values.
  if (isSpreadsheetErrorValue(value)) return true;

  const text = value.trim();
  if (text === "") return false;

  const lowered = text.toLowerCase();
  if (lowered === "true") return true;
  if (lowered === "false") return false;

  const asNumber = Number(text);
  return Number.isNaN(asNumber) ? true : asNumber !== 0;
}
