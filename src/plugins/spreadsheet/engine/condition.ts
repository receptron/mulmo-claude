/**
 * Evaluating a spreadsheet condition without running it as code.
 *
 * A condition is one comparison, or a bare value tested for truthiness. That is
 * the whole grammar — small enough to read directly, which is the point: the
 * previous implementation handed the substituted text to `eval`, so a cell
 * containing `globalThis.x = 1` executed when any IFS referenced it.
 */

import type { CellValue } from "./types";
import { isSpreadsheetErrorValue } from "./spreadsheet-errors";

export type ComparisonOperator = ">=" | "<=" | "<>" | "!=" | "==" | "=" | ">" | "<";

// Longest first: `>=` must win over `>`, and `<>` / `<=` over `<`.
const OPERATORS: readonly ComparisonOperator[] = [">=", "<=", "<>", "!=", "==", "=", ">", "<"];

export interface Comparison {
  left: string;
  operator: ComparisonOperator;
  right: string;
}

/** Remove parentheses that wrap the WHOLE expression, repeatedly. `(1>0)` is
 *  the same condition as `1>0`, but `(A)=(B)` is not `A)=(B` — the leading `(`
 *  closes before the end, so it wraps only its own operand and must stay.
 *  Unbalanced input is left untouched rather than guessed at. */
export function stripOuterParens(condition: string): string {
  let text = condition.trim();
  while (text.startsWith("(") && text.endsWith(")")) {
    let depth = 0;
    let quote: string | null = null;
    let wrapsAll = true;
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      if (quote !== null) {
        if (char === "\\")
          index++; // skip the escaped character
        else if (char === quote) quote = null;
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (char === "(") depth++;
      else if (char === ")") {
        depth--;
        // Back to zero before the end means this `(` closed early.
        if (depth === 0 && index < text.length - 1) {
          wrapsAll = false;
          break;
        }
        if (depth < 0) return text; // unbalanced
      }
    }
    if (!wrapsAll || depth !== 0) return text;
    text = text.slice(1, -1).trim();
  }
  return text;
}

/** Split a condition into its two sides, or null when it holds no comparison.
 *  Only the FIRST top-level operator counts — `a>b>c` is not a chain here, and
 *  treating it as one is what let `1=1=1` reach a JS parser before.
 *
 *  "Top-level" means outside quotes: a cell holding `a>b` substitutes into the
 *  condition as `"a>b"`, and splitting on that `>` would compare two fragments
 *  of one string literal. */
export function splitComparison(condition: string): Comparison | null {
  const text = stripOuterParens(condition);
  let quote: string | null = null;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quote !== null) {
      if (char === "\\")
        index++; // skip the escaped character
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    for (const operator of OPERATORS) {
      if (!text.startsWith(operator, index)) continue;
      return { left: text.slice(0, index).trim(), operator, right: text.slice(index + operator.length).trim() };
    }
  }
  return null;
}

/** Strip one matching pair of surrounding quotes, and undo the `\"` / `\\`
 *  escaping that `renderConditionOperand` applies when it quotes a cell value. */
function unquote(text: string): { value: string; quoted: boolean } {
  const isQuoted = text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")));
  if (!isQuoted) return { value: text, quoted: false };
  const inner = text.slice(1, -1).replace(/\\(["'\\])/g, "$1");
  return { value: inner, quoted: true };
}

/** Read an operand as the value it denotes: a quoted string stays text, a
 *  numeric literal becomes a number, `TRUE`/`FALSE` become booleans, and
 *  anything else stays the text it already is. */
export function readOperand(raw: string): CellValue {
  const { value, quoted } = unquote(raw.trim());
  if (quoted) return value;
  if (value === "") return "";
  const upper = value.toUpperCase();
  if (upper === "TRUE") return true;
  if (upper === "FALSE") return false;
  // `Number` rather than `parseFloat`: it rejects trailing garbage, so "12abc"
  // stays text instead of becoming 12.
  const numeric = Number(value);
  return Number.isNaN(numeric) ? value : numeric;
}

function compareValues(left: CellValue, right: CellValue): number | null {
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "boolean" || typeof right === "boolean") return null;
  return String(left).localeCompare(String(right));
}

function applyOperator(operator: ComparisonOperator, left: CellValue, right: CellValue): boolean {
  // Equality does not need an ordering, so it works for every type pair —
  // including the boolean combinations `compareValues` refuses to order.
  if (operator === "=" || operator === "==") return left === right;
  if (operator === "<>" || operator === "!=") return left !== right;
  const ordering = compareValues(left, right);
  if (ordering === null) return false;
  if (operator === ">") return ordering > 0;
  if (operator === ">=") return ordering >= 0;
  if (operator === "<") return ordering < 0;
  return ordering <= 0;
}

/** Whether a resolved condition value counts as satisfied. Mirrors the
 *  spreadsheet convention rather than JavaScript's: 0 and an empty string are
 *  false, every other value is true. */
function valueIsTruthy(value: CellValue): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return value !== "";
}

/** True when a bare (non-comparison) condition counts as satisfied. */
export function isTruthyCondition(raw: string): boolean {
  return valueIsTruthy(readOperand(stripOuterParens(raw)));
}

/** Evaluate a condition — one comparison, or a value tested for truthiness.
 *  Never executes its input. */
export function evaluateCondition(condition: string): boolean {
  const comparison = splitComparison(condition);
  if (!comparison) return isTruthyCondition(condition);
  return applyOperator(comparison.operator, readOperand(comparison.left), readOperand(comparison.right));
}

/** Like `evaluateCondition`, but each operand is resolved by `evaluate` — so a
 *  caller holding the engine can compute arithmetic and sub-expressions
 *  (`5+1>10`) instead of reading each side as a bare string. It still never runs
 *  the condition as code: it only splits on the top-level comparison and
 *  compares the two resolved values. */
export function evaluateConditionValues(condition: string, evaluate: (operand: string) => CellValue): boolean {
  const comparison = splitComparison(condition);
  if (!comparison) return valueIsTruthy(evaluate(stripOuterParens(condition)));
  return applyOperator(comparison.operator, evaluate(comparison.left), evaluate(comparison.right));
}

/** Render a cell's value as an operand for a condition string. A string is
 *  quoted, with its own quotes and backslashes escaped, so its contents cannot
 *  be re-parsed as operators — `evaluateCondition` then unquotes it back to the
 *  original text. A missing value becomes an empty string; numbers and booleans
 *  render as themselves. */
export function renderConditionOperand(value: CellValue | null | undefined): string {
  if (value === null || value === undefined) return '""';
  // A formula error renders as its quoted code, so a condition compares it as
  // the text a cell shows rather than as a bare `#NUM!` token.
  const text = isSpreadsheetErrorValue(value) ? value.code : value;
  if (typeof text === "string") return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return text.toString();
}
