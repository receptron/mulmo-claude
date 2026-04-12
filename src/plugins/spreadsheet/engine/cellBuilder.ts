/**
 * Build a SpreadsheetCell from the raw input captured by the mini
 * editor (type + value / formula / format). Extracted from
 * `saveMiniEditor` in `src/plugins/spreadsheet/View.vue` where it
 * was inlined as ~30 lines of nested if/else that pushed the
 * surrounding function over the cognitive-complexity threshold.
 *
 * Pure — no refs, no DOM, no side effects. Given the same inputs
 * it always returns the same SpreadsheetCell. Tested in
 * `test/plugins/spreadsheet/engine/test_cellBuilder.ts`.
 */

import type { SpreadsheetCell } from "./types.js";

/** Inputs to the cell builder. Mirrors the mini editor refs in the
 *  View but as plain values so unit tests don't need a Vue runtime. */
export interface MiniEditorInput {
  /** "string" → value is stored as-is as a string.
   *  Anything else → the `formula` field is parsed (formula / number / raw string). */
  type: string;
  /** Used when type === "string". Coerced to string. */
  value: unknown;
  /** Used when type !== "string". Trimmed before classification. */
  formula?: string;
  /** Optional format code (e.g. "$#,##0.00"). */
  format?: string;
}

// Anchored at the start of the input (after optional unary +/-) so we
// only treat expressions that clearly begin with a function call as
// formulas. Unanchored would match "abc FOO(" inside ordinary text.
const FORMULA_FUNCTION_CALL = /^[-+]?\s*[A-Z]+\s*\(/i;

// `A1 + B2` style — cell reference next to an arithmetic operator.
const FORMULA_CELL_OP = /[A-Z]+\d+\s*[+\-*/^]/;

// `6/100`, `5 * 2` — arithmetic between two literal numbers.
const FORMULA_NUMERIC_OP = /\d+\s*[+\-*/^]\s*\d+/;

// Strict numeric literal. `parseFloat` accepts trailing junk
// ("42abc" → 42) which silently corrupts user input; this anchor
// ensures the ENTIRE trimmed string is a number.
const STRICT_NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

/**
 * Best-effort formula detection. The rules are conservative enough
 * that plain text like "hello world" stays as text, but any input
 * with arithmetic operators or function calls is treated as a
 * formula and gets the "=" prefix the engine expects.
 */
export function looksLikeFormula(input: string): boolean {
  return (
    FORMULA_FUNCTION_CALL.test(input) ||
    FORMULA_CELL_OP.test(input) ||
    FORMULA_NUMERIC_OP.test(input)
  );
}

/**
 * Parse the raw (non-string-type) editor input into a cell value.
 * Priority: formula > number > raw string > empty string.
 */
export function parseNonStringInput(raw: string): number | string {
  const input = raw.trim();
  if (input === "") return "";
  if (looksLikeFormula(input)) return `=${input}`;
  return STRICT_NUMBER.test(input) ? Number(input) : input;
}

/**
 * Build the full SpreadsheetCell from a mini editor input record.
 * String type short-circuits to `{ v: String(value) }`.
 * Everything else goes through parseNonStringInput for formula /
 * number / text classification, then optionally attaches `f`.
 */
export function buildCellFromInput(input: MiniEditorInput): SpreadsheetCell {
  if (input.type === "string") {
    return { v: String(input.value) };
  }
  const cell: SpreadsheetCell = { v: parseNonStringInput(input.formula ?? "") };
  if (input.format && input.format.length > 0) {
    cell.f = input.format;
  }
  return cell;
}
