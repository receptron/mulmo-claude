/**
 * Formula errors as a distinct VALUE type.
 *
 * A `#NUM!` produced by `SQRT(-1)` and the text `"#NUM!"` produced by
 * `CONCAT("#N","UM!")` used to be the same string, so IFERROR could not tell a
 * real error from text that merely spells one (#2451). An error is now its own
 * value carrying the code, which is what the error-aware functions check; the
 * display pass renders it back to `#NUM!` so cells look unchanged.
 */

export const SPREADSHEET_ERRORS = ["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A", "#ERROR!"] as const;

export type SpreadsheetErrorCode = (typeof SPREADSHEET_ERRORS)[number];

/** A formula error, distinct from any string. `toString` yields the code so the
 *  value renders as `#NUM!` wherever the engine coerces a cell value to text. */
export class SpreadsheetError {
  constructor(readonly code: SpreadsheetErrorCode) {}

  toString(): string {
    return this.code;
  }

  toJSON(): string {
    return this.code;
  }
}

export const NULL_ERROR = new SpreadsheetError("#NULL!");
export const DIV_ZERO_ERROR = new SpreadsheetError("#DIV/0!");
export const VALUE_ERROR = new SpreadsheetError("#VALUE!");
export const REF_ERROR = new SpreadsheetError("#REF!");
export const NAME_ERROR = new SpreadsheetError("#NAME?");
export const NUM_ERROR = new SpreadsheetError("#NUM!");
export const NA_ERROR = new SpreadsheetError("#N/A");
export const UNKNOWN_ERROR = new SpreadsheetError("#ERROR!");

// One instance per code: two errors of the same kind compare equal, which is how
// error strings behaved and what the condition/comparison paths still rely on.
const ERROR_VALUES: Record<SpreadsheetErrorCode, SpreadsheetError> = {
  "#NULL!": NULL_ERROR,
  "#DIV/0!": DIV_ZERO_ERROR,
  "#VALUE!": VALUE_ERROR,
  "#REF!": REF_ERROR,
  "#NAME?": NAME_ERROR,
  "#NUM!": NUM_ERROR,
  "#N/A": NA_ERROR,
  "#ERROR!": UNKNOWN_ERROR,
};

/** The error value for a code. */
export const spreadsheetError = (code: SpreadsheetErrorCode): SpreadsheetError => ERROR_VALUES[code];

const errorSet: ReadonlySet<string> = new Set(SPREADSHEET_ERRORS);

/** Whether a value is one of the error CODES as a plain string. Text that spells
 *  an error is not an error value — see `isSpreadsheetErrorValue`. */
export function isSpreadsheetError(value: unknown): value is SpreadsheetErrorCode {
  return typeof value === "string" && errorSet.has(value);
}

/** Whether a value IS a formula error, as opposed to text that spells one. */
export function isSpreadsheetErrorValue(value: unknown): value is SpreadsheetError {
  return value instanceof SpreadsheetError;
}

/** The code behind a value: an error value's own code, or the code a plain
 *  string spells. Used where a literal `#REF!` written into a cell must still
 *  poison the arithmetic that reads it, provenance aside. */
export function errorCodeOf(value: unknown): SpreadsheetErrorCode | null {
  if (isSpreadsheetErrorValue(value)) return value.code;
  return isSpreadsheetError(value) ? value : null;
}

/** Whether an evaluated result should be treated as an error: a formula error
 *  VALUE, a NaN / infinite number, or a missing value. This is what IFERROR
 *  catches — deliberately NOT a look-alike string, which is ordinary text. */
export function isErrorResult(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "number") return Number.isNaN(value) || !Number.isFinite(value);
  return isSpreadsheetErrorValue(value);
}
