/**
 * Formula Evaluator
 *
 * Evaluates spreadsheet formulas including functions, cell references, and arithmetic
 */

import { functionRegistry } from "./registry";
import type { CellValue } from "./types";
import { parseDate } from "./date-parser";
import { caretToPow, replaceConcatOperator, rewriteComparisonEq, isSafeArithmetic, isSafeComparison } from "./translateFormula";
import { divZeroError, unknownError, nameError, propagatedError } from "./formulaError";
import { errorCodeOf, isSpreadsheetErrorValue } from "./spreadsheet-errors";

/**
 * Evaluation context for formulas
 */
export interface EvaluatorContext {
  getCellValue: (ref: string) => CellValue;
  getRangeValues: (range: string) => CellValue[];
  getRangeValuesRaw?: (range: string) => CellValue[];
  evaluateFormula: (formula: string) => CellValue;
  /** Reading order for an ambiguous slash date; see engine/date-locale.ts. */
  preferDDMMYYYY?: boolean;
}

/** Render a cell's value as the text that stands in for it inside an
 *  expression. Strings are quoted so they cannot be read as identifiers or
 *  operators, and their own quotes and backslashes are escaped so the literal
 *  cannot be closed early. A missing value becomes 0, matching how blanks are
 *  treated everywhere else in the engine. */
export function renderOperand(value: CellValue | null | undefined): string {
  if (value === null || value === undefined) return "0";
  const text = isSpreadsheetErrorValue(value) ? value.code : value;
  if (typeof text === "string") return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return text.toString();
}

/** Replace every quoted string literal with an empty pair of quotes, honouring
 *  `\` escapes so an escaped quote does not end the literal early. Used to
 *  validate the STRUCTURE of a concat/arithmetic expression without letting the
 *  arbitrary CONTENT of a string decide whether the whole thing looks safe. */
export function maskStringLiterals(expr: string): string {
  let out = "";
  let quote: string | null = null;
  for (let index = 0; index < expr.length; index++) {
    const char = expr[index];
    if (quote !== null) {
      if (char === "\\") {
        index++; // skip the escaped character — it is part of the literal
        continue;
      }
      if (char === quote) {
        quote = null;
        out += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      out += char;
      continue;
    }
    out += char;
  }
  return out;
}

/** Whether a `&`-to-`+` concatenation expression is safe to evaluate. Checks the
 *  structure with string CONTENT masked out — a string literal may hold any
 *  character (a `!`, a `\`), and validating those against a character allowlist
 *  rejected valid formulas like `=A1&"!"` and every escaped operand. Once the
 *  literals are masked, only the joining structure remains to validate. */
export function isSafeConcatExpression(expr: string): boolean {
  // A boolean cell renders as a bare `true` / `false` here (renderOperand) —
  // the only non-literal identifier the substitution can emit. Drop those words
  // before validating so a boolean operand (`=A1&"!"` with A1 = true) still
  // evaluates, while any other identifier keeps the structure from matching and
  // never reaches `new Function`.
  const structure = maskStringLiterals(expr).replace(/\b(?:true|false)\b/g, "");
  return /^[\d+\-*/(). "']*$/.test(structure);
}

/** Index just past the string literal that opens at `start` (a quote char),
 *  honouring `\` escapes so an escaped quote does not close it early. Returns
 *  `expr.length` when the literal is never closed. */
export function endOfStringLiteral(expr: string, start: number): number {
  const quote = expr[start];
  let index = start + 1;
  while (index < expr.length) {
    if (expr[index] === "\\") {
      index += 2; // skip the escaped character — it is part of the literal
      continue;
    }
    if (expr[index] === quote) return index + 1;
    index++;
  }
  return expr.length;
}

/** A `'Sheet Name'!A1` reference beginning at `start` (a `'`), or null when the
 *  quotes open a plain string literal rather than a sheet-qualified reference. */
function matchQuotedSheetRef(expr: string, start: number): string | null {
  const endQuote = expr.indexOf("'", start + 1);
  if (endQuote === -1 || expr[endQuote + 1] !== "!") return null;
  const cellPart = expr.substring(endQuote + 2).match(/^(\$?[A-Z]+\$?\d+)/);
  if (!cellPart) return null;
  return expr.substring(start, endQuote + 2 + cellPart[0].length);
}

/** A `Sheet!A1` or bare `A1` / `$A$1` reference beginning at `start`, or null. */
function matchUnquotedRef(expr: string, start: number): string | null {
  const rest = expr.substring(start);
  const sheetMatch = rest.match(/^([A-Z][A-Z0-9]*)!/i);
  if (sheetMatch) {
    const cellPart = rest.substring(sheetMatch[0].length).match(/^(\$?[A-Z]+\$?\d+)/);
    if (cellPart) return sheetMatch[0] + cellPart[0];
  }
  const cellMatch = rest.match(/^(\$?[A-Z]+\$?\d+)/);
  return cellMatch ? cellMatch[0] : null;
}

/** Every cell reference in an expression, as `{ref, start}` spans in source
 *  order. Quoted string literals are skipped whole: a `"A1"` in the text is a
 *  constant, not a reference, and substituting it would turn `="A1"&"!"` into
 *  A1's value. A `'` opens either a `'Sheet'!A1` reference or a string literal —
 *  only the former is a reference; the latter is skipped like a `"` literal. */
export function findCellRefs(expr: string): { ref: string; start: number }[] {
  const cellRefs: { ref: string; start: number }[] = [];
  let i = 0;
  while (i < expr.length) {
    const char = expr[i];
    if (char === '"') {
      i = endOfStringLiteral(expr, i);
      continue;
    }
    if (char === "'") {
      const sheetRef = matchQuotedSheetRef(expr, i);
      if (sheetRef) {
        cellRefs.push({ ref: sheetRef, start: i });
        i += sheetRef.length;
      } else {
        i = endOfStringLiteral(expr, i);
      }
      continue;
    }
    const ref = matchUnquotedRef(expr, i);
    if (ref) {
      cellRefs.push({ ref, start: i });
      i += ref.length;
      continue;
    }
    i++;
  }
  return cellRefs;
}

/**
 * Parse function arguments, handling nested functions and quoted strings
 *
 * @param argsStr - String containing function arguments
 * @returns Array of argument strings
 */
export function parseFunctionArgs(argsStr: string): string[] {
  const args: string[] = [];
  let currentArg = "";
  let depth = 0;
  let inString = false;
  let stringChar = "";

  for (let i = 0; i < argsStr.length; i++) {
    const char = argsStr[i];
    const prevChar = i > 0 ? argsStr[i - 1] : "";

    // Handle string boundaries
    if ((char === '"' || char === "'") && prevChar !== "\\") {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
        stringChar = "";
      }
      currentArg += char;
      continue;
    }

    // Track parentheses depth (for nested functions)
    if (!inString) {
      if (char === "(") depth++;
      if (char === ")") depth--;

      // Split on comma only at depth 0 and not in string
      if (char === "," && depth === 0) {
        args.push(currentArg.trim());
        currentArg = "";
        continue;
      }
    }

    currentArg += char;
  }

  if (currentArg.trim()) {
    args.push(currentArg.trim());
  }

  return args;
}

/** Run `new Function` on an expression the callers have already gated with a
 *  character allowlist. A JS parse/eval failure becomes #ERROR! — a genuinely
 *  broken formula that used to be swallowed into a bare string (#2359). A
 *  non-finite NUMBER result is only reachable by dividing by zero (comparisons
 *  yield booleans, concatenation yields strings), so it becomes #DIV/0!. */
function evalValidatedExpression(jsExpr: string): CellValue {
  let result: unknown;
  try {
    // eslint-disable -- sonarjs/code-eval
    result = new Function(`return (${jsExpr})`)();
  } catch {
    throw unknownError();
  }
  if (typeof result === "number") {
    if (!Number.isFinite(result)) throw divZeroError();
    return result;
  }
  if (typeof result === "string" || typeof result === "boolean") return result;
  throw unknownError();
}

/**
 * Evaluate a formula string
 *
 * Supports:
 * - Function calls: SUM(A1:A10), ROUND(B2, 2)
 * - Cell references: A1, B2, Sheet1!A1
 * - Arithmetic: 2+3, A1*B1, (A1+B1)/2
 * - Nested expressions: ROUND(SUM(A1:A10)/COUNT(A1:A10), 2)
 *
 * A genuine failure THROWS (a typed FormulaError or any handler error) rather
 * than returning the raw formula text; the calculator classifies it into
 * errors[] and shows the Excel error value in the cell (#2359).
 *
 * @param formula - Formula string (without leading =)
 * @param context - Evaluation context with cell/range accessors
 * @returns Evaluated result (number or string)
 */
export function evaluateFormula(formula: string, context: EvaluatorContext): CellValue {
  // Handle string literals - remove surrounding quotes
  // But NOT string concatenations (which contain & operators)
  const trimmed = formula.trim();
  if (
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) &&
    !trimmed.includes("&") // Exclude string concatenations
  ) {
    const stringValue = trimmed.slice(1, -1); // Remove first and last character (quotes)

    // Auto-parse date strings to serial numbers for compatibility with date arithmetic
    // This allows formulas like =HLOOKUP("6/1/2024", ...) to work with parsed date cells
    const dateSerial = parseDate(stringValue, context.preferDDMMYYYY);
    if (dateSerial !== null) {
      return dateSerial;
    }

    return stringValue;
  }

  // Check if it's a SIMPLE function call (not a complex expression)
  // We need to ensure the formula is JUST a function, not "FUNC(...) + something"
  const funcMatch = formula.match(/^([A-Z]+)\((.*)\)$/i);
  if (funcMatch) {
    const [, funcName, argsStr] = funcMatch;

    // Check that the closing paren is actually the end of the function
    // by counting parentheses in argsStr
    let parenDepth = 0;
    let isValidFunction = true;
    for (const char of argsStr) {
      if (char === "(") parenDepth++;
      else if (char === ")") {
        parenDepth--;
        if (parenDepth < 0) {
          // More closing parens than opening - this means we matched too much
          isValidFunction = false;
          break;
        }
      }
    }

    // Normalize function name to uppercase for registry lookup
    const normalizedFuncName = funcName.toUpperCase();
    const func = functionRegistry.get(normalizedFuncName);

    if (func && isValidFunction) {
      const args = parseFunctionArgs(argsStr);

      // Validate argument count
      if (func.minArgs !== undefined && args.length < func.minArgs) {
        throw new Error(`${normalizedFuncName} requires at least ${func.minArgs} argument${func.minArgs !== 1 ? "s" : ""}`);
      }
      if (func.maxArgs !== undefined && args.length > func.maxArgs) {
        throw new Error(`${normalizedFuncName} accepts at most ${func.maxArgs} argument${func.maxArgs !== 1 ? "s" : ""}`);
      }

      // Execute function with context
      return func.handler(args, {
        getCellValue: context.getCellValue,
        getRangeValues: context.getRangeValues,
        getRangeValuesRaw: context.getRangeValuesRaw,
        evaluateFormula: context.evaluateFormula,
      });
    }

    // A balanced `NAME(...)` spanning the whole formula whose NAME is not a
    // registered function is an unrecognized name — Excel's #NAME?. Surfacing
    // it here also stops the arithmetic path below from recursing on it forever
    // and leaving the literal text in the cell (#2359).
    if (isValidFunction && !func) {
      throw nameError(normalizedFuncName);
    }
  }

  // Handle simple arithmetic expressions with cell references
  // First, replace any function calls within the expression
  let expr = formula;

  // Find and evaluate function calls (e.g., TODAY(), SUM(A1:A10), LOWER(A1), etc.)
  // Use a simpler approach: find function names followed by parentheses
  // and manually parse the matching closing parenthesis
  let searchIndex = 0;
  const maxIterations = 100; // Prevent infinite loops
  let iterations = 0;

  while (searchIndex < expr.length && iterations < maxIterations) {
    iterations++;
    const funcNameMatch = expr.substring(searchIndex).match(/^([A-Z]+)\(/i);
    if (!funcNameMatch) {
      // No more functions found, move to next character
      searchIndex++;
      if (searchIndex >= expr.length) break;
      continue;
    }

    const funcStartIndex = searchIndex;
    const funcName = funcNameMatch[1];
    const argsStartIndex = searchIndex + funcName.length + 1;

    // Find matching closing parenthesis
    let depth = 1;
    let argsEndIndex = argsStartIndex;
    let inString = false;
    let stringChar = "";

    while (argsEndIndex < expr.length && depth > 0) {
      const char = expr[argsEndIndex];
      const prevChar = argsEndIndex > 0 ? expr[argsEndIndex - 1] : "";

      // Track string boundaries
      if ((char === '"' || char === "'") && prevChar !== "\\") {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          inString = false;
          stringChar = "";
        }
      }

      // Only count parens outside of strings
      if (!inString) {
        if (char === "(") depth++;
        else if (char === ")") depth--;
      }
      argsEndIndex++;
    }

    if (depth === 0) {
      const fullMatch = expr.substring(funcStartIndex, argsEndIndex);
      const result = context.evaluateFormula(fullMatch);
      // A nested call that errored poisons the expression the same way an
      // errored reference does — substituting it produced `"#NUM!"+1` text.
      // Only the error VALUE counts: text that merely spells an error (CONCAT)
      // is an ordinary operand.
      if (isSpreadsheetErrorValue(result)) throw propagatedError(result.code);
      // For string results, wrap in quotes; for numbers, wrap in parentheses
      const replacement = typeof result === "string" ? `"${result}"` : `(${result})`;
      expr = expr.substring(0, funcStartIndex) + replacement + expr.substring(argsEndIndex);
      // Continue from after the replacement
      searchIndex = funcStartIndex + replacement.length;
    } else {
      searchIndex++;
    }
  }

  // Then replace cell references with their values. Detection skips quoted
  // string literals so a `"A1"` constant is not read as a reference.
  const cellRefs = findCellRefs(expr);

  // A formula that is nothing but one reference returns that cell's value
  // directly. Rendering it into an expression first would mean escaping the
  // text, and the escapes would survive into the result — `=A1` on a cell
  // holding `say "hi"` would come back `say \"hi\"`. Surrounding whitespace
  // (`= A1`, `=A1 `) is part of "nothing but one reference", so compare the
  // span against the trimmed expression rather than the raw one.
  if (cellRefs.length === 1) {
    const { ref, start } = cellRefs[0];
    const before = expr.slice(0, start);
    const after = expr.slice(start + ref.length);
    if (before.trim() === "" && after.trim() === "") {
      return context.getCellValue(ref);
    }
  }

  // Substitute by POSITION, back to front. A global string replace rewrote
  // every occurrence of the shorter reference first, so `=A1+A10` had its
  // `A10` broken into `<A1's value>0` and produced a plausible wrong number
  // (#2357). Walking backwards keeps the earlier spans valid as we go.
  for (let index = cellRefs.length - 1; index >= 0; index--) {
    const { ref, start } = cellRefs[index];
    const value = context.getCellValue(ref);
    // A referenced cell holding an error poisons the whole expression:
    // rendering it would produce `"#DIV/0!"+1` garbage, so propagate the error
    // instead of substituting it (#2359, Excel behaviour). A cell whose stored
    // TEXT spells an error counts here too — Excel stores a typed error literal
    // as an error, and arithmetic over it is never meaningful.
    const referencedErrorCode = errorCodeOf(value);
    if (referencedErrorCode !== null) throw propagatedError(referencedErrorCode);
    expr = expr.slice(0, start) + renderOperand(value) + expr.slice(start + ref.length);
  }

  // Parse date strings in arithmetic expressions (e.g., "06/01/2025" → serial number)
  // This allows formulas like =B3-"06/01/2025" to work correctly
  expr = expr.replace(/"([^"]+)"/g, (match, dateStr) => {
    const dateSerial = parseDate(dateStr, context.preferDDMMYYYY);
    if (dateSerial !== null) {
      return dateSerial.toString();
    }
    return match; // Keep original if not a date
  });

  // Replace ^ with ** for exponentiation
  expr = caretToPow(expr);

  // Check if this is a string concatenation expression (contains & and quoted strings)
  const hasStringConcat = expr.includes("&");
  const hasQuotedStrings = /["']/.test(expr);

  // If it contains string concatenation, handle it specially. Convert & to +
  // for JS concatenation (leaving any & inside a literal untouched), then
  // validate the STRUCTURE with literals masked — a literal may hold any
  // character, so masking is what lets `=A1&"!"` and escaped operands through
  // while still rejecting a genuinely unsafe expression. A non-safe structure
  // falls through to the paths below rather than erroring.
  if (hasStringConcat && hasQuotedStrings) {
    const result = replaceConcatOperator(expr);
    if (isSafeConcatExpression(result)) {
      return evalValidatedExpression(result);
    }
  }

  // Safely evaluate comparison expressions (e.g., 5=6, (5)>(6)). The allowlist
  // (numbers, `= != < > <= >=`, parens, whitespace) gates the evaluation. It is
  // a superset of the arithmetic allowlist, so a plain `1/0` is handled here —
  // evalValidatedExpression turns its Infinity into #DIV/0! (#2359).
  if (isSafeComparison(expr)) {
    return evalValidatedExpression(rewriteComparisonEq(expr));
  }

  // Safely evaluate arithmetic expressions (numbers, operators, parens,
  // whitespace, decimal points).
  if (isSafeArithmetic(expr)) {
    return evalValidatedExpression(expr);
  }

  // If the final expression is a quoted string literal, unwrap it
  const trimmedExpr = expr.trim();
  if ((trimmedExpr.startsWith('"') && trimmedExpr.endsWith('"')) || (trimmedExpr.startsWith("'") && trimmedExpr.endsWith("'"))) {
    return trimmedExpr.slice(1, -1); // Remove quotes
  }

  return expr; // Return processed expression (with cell refs replaced, etc.)
}
