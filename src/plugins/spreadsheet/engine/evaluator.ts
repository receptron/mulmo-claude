/**
 * Formula Evaluator
 *
 * Evaluates spreadsheet formulas including functions, cell references, and arithmetic
 */

import { functionRegistry } from "./registry";
import type { CellValue } from "./types";
import { parseDate } from "./date-parser";

/**
 * Evaluation context for formulas
 */
export interface EvaluatorContext {
  getCellValue: (ref: string) => CellValue;
  getRangeValues: (range: string) => CellValue[];
  getRangeValuesRaw?: (range: string) => CellValue[];
  evaluateFormula: (formula: string) => CellValue;
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

/**
 * Evaluate a formula string
 *
 * Supports:
 * - Function calls: SUM(A1:A10), ROUND(B2, 2)
 * - Cell references: A1, B2, Sheet1!A1
 * - Arithmetic: 2+3, A1*B1, (A1+B1)/2
 * - Nested expressions: ROUND(SUM(A1:A10)/COUNT(A1:A10), 2)
 *
 * @param formula - Formula string (without leading =)
 * @param context - Evaluation context with cell/range accessors
 * @returns Evaluated result (number or string)
 */
export function evaluateFormula(
  formula: string,
  context: EvaluatorContext,
): CellValue {
  try {
    // Handle string literals - remove surrounding quotes
    // But NOT string concatenations (which contain & operators)
    const trimmed = formula.trim();
    if (
      ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) &&
      !trimmed.includes("&") // Exclude string concatenations
    ) {
      const stringValue = trimmed.slice(1, -1); // Remove first and last character (quotes)

      // Auto-parse date strings to serial numbers for compatibility with date arithmetic
      // This allows formulas like =HLOOKUP("6/1/2024", ...) to work with parsed date cells
      const dateSerial = parseDate(stringValue);
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
          throw new Error(
            `${normalizedFuncName} requires at least ${func.minArgs} argument${func.minArgs !== 1 ? "s" : ""}`,
          );
        }
        if (func.maxArgs !== undefined && args.length > func.maxArgs) {
          throw new Error(
            `${normalizedFuncName} accepts at most ${func.maxArgs} argument${func.maxArgs !== 1 ? "s" : ""}`,
          );
        }

        // Execute function with context
        return func.handler(args, {
          getCellValue: context.getCellValue,
          getRangeValues: context.getRangeValues,
          getRangeValuesRaw: context.getRangeValuesRaw,
          evaluateFormula: context.evaluateFormula,
        });
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
        // For string results, wrap in quotes; for numbers, wrap in parentheses
        const replacement =
          typeof result === "string" ? `"${result}"` : `(${result})`;
        expr =
          expr.substring(0, funcStartIndex) +
          replacement +
          expr.substring(argsEndIndex);
        // Continue from after the replacement
        searchIndex = funcStartIndex + replacement.length;
      } else {
        searchIndex++;
      }
    }

    // Then replace cell references with their values
    // Match cell references manually to avoid complex regex
    const cellRefs: string[] = [];
    let i = 0;
    while (i < expr.length) {
      // Check for cross-sheet reference (quoted or unquoted)
      let ref = "";
      if (expr[i] === "'") {
        // Quoted sheet name
        const endQuote = expr.indexOf("'", i + 1);
        if (endQuote !== -1 && expr[endQuote + 1] === "!") {
          const cellPart = expr
            .substring(endQuote + 2)
            .match(/^(\$?[A-Z]+\$?\d+)/);
          if (cellPart) {
            ref = expr.substring(i, endQuote + 2 + cellPart[0].length);
            cellRefs.push(ref);
            i += ref.length;
            continue;
          }
        }
      } else {
        // Unquoted sheet name or simple cell ref
        const sheetMatch = expr.substring(i).match(/^([A-Z][A-Z0-9]*)!/i);
        if (sheetMatch) {
          const cellPart = expr
            .substring(i + sheetMatch[0].length)
            .match(/^(\$?[A-Z]+\$?\d+)/);
          if (cellPart) {
            ref = sheetMatch[0] + cellPart[0];
            cellRefs.push(ref);
            i += ref.length;
            continue;
          }
        }
        // Simple cell reference
        const cellMatch = expr.substring(i).match(/^(\$?[A-Z]+\$?\d+)/);
        if (cellMatch) {
          ref = cellMatch[0];
          cellRefs.push(ref);
          i += ref.length;
          continue;
        }
      }
      i++;
    }

    if (cellRefs.length > 0) {
      for (const ref of cellRefs) {
        const value = context.getCellValue(ref);
        // Escape special regex characters
        const escapedRef = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // Wrap string values in quotes for proper evaluation
        // Handle null/undefined values by treating them as 0
        let replacement: string;
        if (value === null || value === undefined) {
          replacement = "0";
        } else if (typeof value === "string") {
          replacement = `"${value}"`;
        } else {
          replacement = value.toString();
        }
        expr = expr.replace(new RegExp(escapedRef, "g"), replacement);
      }
    }

    // Parse date strings in arithmetic expressions (e.g., "06/01/2025" → serial number)
    // This allows formulas like =B3-"06/01/2025" to work correctly
    expr = expr.replace(/"([^"]+)"/g, (match, dateStr) => {
      const dateSerial = parseDate(dateStr);
      if (dateSerial !== null) {
        return dateSerial.toString();
      }
      return match; // Keep original if not a date
    });

    // Replace ^ with ** for exponentiation
    expr = expr.replace(/\^/g, "**");

    // Check if this is a string concatenation expression (contains & and quoted strings)
    const hasStringConcat = expr.includes("&");
    const hasQuotedStrings = /["']/.test(expr);

    // If it contains string concatenation, handle it specially
    if (hasStringConcat && hasQuotedStrings) {
      try {
        // Convert & to + for JavaScript string concatenation
        // We need to be careful to only replace & that are not inside strings
        let inString = false;
        let stringChar = "";
        let result = "";

        for (let index = 0; index < expr.length; index++) {
          const char = expr[index];
          const prevChar = index > 0 ? expr[index - 1] : "";

          // Handle string boundaries
          if ((char === '"' || char === "'") && prevChar !== "\\") {
            if (!inString) {
              inString = true;
              stringChar = char;
            } else if (char === stringChar) {
              inString = false;
              stringChar = "";
            }
          }

          // Replace & with + when not in a string
          if (char === "&" && !inString) {
            result += "+";
          } else {
            result += char;
          }
        }

        // Validate the expression contains only safe characters
        // Allow: numbers, letters, strings (with quotes), operators, parentheses, whitespace, @, ., comma
        if (/^[a-zA-Z0-9+\-*/(). "'@,]+$/.test(result)) {
          // eslint-disable -- sonarjs/code-eval
          const evalResult = new Function(`return (${result})`)();
          return evalResult;
        }
      } catch (error) {
        console.error(
          `Failed to evaluate string concatenation: ${expr}`,
          error,
        );
        return formula;
      }
    }

    // Safely evaluate comparison expressions (e.g., 5=6, (5)>(6))
    // Allow numbers, comparison operators (=, !=, <, >, <=, >=), parentheses, whitespace
    if (/^[\d+\-*/(). <>!=]+$/.test(expr)) {
      try {
        // Replace = with == for JavaScript comparison (but not <= or >=)
        const jsExpr = expr.replace(/([^<>!])=([^=])/g, "$1==$2");

        // Use Function constructor which is safer than eval
        // eslint-disable -- sonarjs/code-eval
        const result = new Function(`return (${jsExpr})`)();
        return result;
      } catch {
        return formula;
      }
    }

    // Safely evaluate arithmetic expressions using Function constructor instead of eval
    // Allow numbers, operators, parentheses, whitespace, and decimal points
    if (/^[\d+\-*/(). ]+$/.test(expr)) {
      try {
        // Use Function constructor which is safer than eval because:
        // 1. The expression is strictly validated (only numbers and math operators)
        // 2. No access to local scope variables
        // 3. No this binding issues
        // This is safe because we validate the expression first
        // eslint-disable -- sonarjs/code-eval
        const result = new Function(`return (${expr})`)();
        return result;
      } catch {
        return formula;
      }
    }

    // If the final expression is a quoted string literal, unwrap it
    const trimmedExpr = expr.trim();
    if (
      (trimmedExpr.startsWith('"') && trimmedExpr.endsWith('"')) ||
      (trimmedExpr.startsWith("'") && trimmedExpr.endsWith("'"))
    ) {
      return trimmedExpr.slice(1, -1); // Remove quotes
    }

    return expr; // Return processed expression (with cell refs replaced, etc.)
  } catch (error) {
    console.error(`Failed to evaluate formula: ${formula}`, error);
    return formula;
  }
}
