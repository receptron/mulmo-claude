/**
 * Typed formula-evaluation errors
 *
 * A failed formula must surface as a typed error with an Excel-style error value
 * in the cell, never as a swallowed bare string (issue #2359). This module holds
 * the error taxonomy, the throwable carrier, and the pure helpers that classify a
 * thrown error and propagate an error value across cell references. No engine
 * state is captured — every export is input → output only.
 */

import type { CalculationError } from "./types";
import type { SpreadsheetErrorCode } from "./spreadsheet-errors";

/** The evaluator-facing error kinds: every `CalculationError["type"]` except
 *  `circular`, which the calculator raises directly (not via a thrown error). */
export type FormulaErrorType = Exclude<CalculationError["type"], "circular">;

/** The error code shown for each kind, matching Excel's error literals. */
export const FORMULA_ERROR_VALUES: Record<FormulaErrorType, SpreadsheetErrorCode> = {
  div_zero: "#DIV/0!",
  invalid_ref: "#REF!",
  syntax: "#NAME?",
  unknown: "#ERROR!",
};

/** Reverse map for propagation: an error code back to the kind it represents.
 *  Codes without a dedicated kind (`#N/A`, `#NUM!`, …) propagate as `unknown`. */
const ERROR_VALUE_TO_TYPE: Record<string, FormulaErrorType> = {
  [FORMULA_ERROR_VALUES.div_zero]: "div_zero",
  [FORMULA_ERROR_VALUES.invalid_ref]: "invalid_ref",
  [FORMULA_ERROR_VALUES.syntax]: "syntax",
};

/** A recoverable formula failure carrying the kind and the code to show. */
export class FormulaError extends Error {
  constructor(
    readonly errorType: FormulaErrorType,
    readonly display: SpreadsheetErrorCode,
    message?: string,
  ) {
    super(message ?? display);
    this.name = "FormulaError";
  }
}

export const isFormulaError = (error: unknown): error is FormulaError => error instanceof FormulaError;

export const divZeroError = (): FormulaError => new FormulaError("div_zero", FORMULA_ERROR_VALUES.div_zero, "Division by zero");

export const invalidRefError = (ref: string): FormulaError => new FormulaError("invalid_ref", FORMULA_ERROR_VALUES.invalid_ref, `Invalid reference: ${ref}`);

export const nameError = (funcName: string): FormulaError => new FormulaError("syntax", FORMULA_ERROR_VALUES.syntax, `Unknown function: ${funcName}`);

export const unknownError = (message?: string): FormulaError => new FormulaError("unknown", FORMULA_ERROR_VALUES.unknown, message);

/** The FormulaError that re-raises an error read from a referenced cell or a
 *  nested call, so `=A1+1` inherits A1's error instead of corrupting into
 *  `"#DIV/0!"+1`. */
export const propagatedError = (value: SpreadsheetErrorCode): FormulaError =>
  new FormulaError(ERROR_VALUE_TO_TYPE[value] ?? "unknown", value, `Propagated error: ${value}`);

/** Map any thrown value onto the typed entry the calculator records. A
 *  `FormulaError` keeps its own kind and display; anything else is `unknown`. */
export const classifyThrownError = (error: unknown): { type: FormulaErrorType; display: SpreadsheetErrorCode } => {
  if (isFormulaError(error)) return { type: error.errorType, display: error.display };
  return { type: "unknown", display: FORMULA_ERROR_VALUES.unknown };
};
