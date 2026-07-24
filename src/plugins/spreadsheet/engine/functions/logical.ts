/**
 * Logical Functions
 */

import { evaluateConditionValues, readOperand, renderConditionOperand } from "../condition";
import { findCellRefs } from "../evaluator";
import { functionRegistry, type FunctionHandler } from "../registry";
import { isErrorResult, isSpreadsheetErrorValue, NA_ERROR } from "../spreadsheet-errors";
import { coerceToBoolean } from "../coerce-boolean";
import type { CellValue } from "../types";

const ifHandler: FunctionHandler = (args, context) => {
  const condition = args[0];
  const trueValue = args[1];
  const falseValue = args[2];

  // Evaluate condition - use evaluateFormula to handle nested functions like MONTH()
  const conditionValue = context.evaluateFormula(condition);
  const conditionResult = coerceToBoolean(conditionValue);

  // Return the appropriate value based on condition
  const resultValue = conditionResult ? trueValue : falseValue;

  // If result is a quoted string, return the string without quotes
  if (/^["'](.*)["']$/.test(resultValue)) {
    return resultValue.slice(1, -1);
  }

  // Everything else — a nested call, an arithmetic expression, a reference — is
  // evaluated by the engine. Hand-rolling it here silently returned a plausible
  // wrong value twice over: a hard-coded list of nine function names sent
  // `ROUND(A1,1)` back as its own text, and the fallback read `A1+1` through
  // `parseFloat("3+1")`, yielding 3.
  return context.evaluateFormula(resultValue);
};

const andHandler: FunctionHandler = (args, context) => {
  for (const arg of args) {
    if (!coerceToBoolean(context.evaluateFormula(arg.trim()))) {
      return false;
    }
  }
  return true;
};

const orHandler: FunctionHandler = (args, context) => {
  for (const arg of args) {
    if (coerceToBoolean(context.evaluateFormula(arg.trim()))) {
      return true;
    }
  }
  return false;
};

const notHandler: FunctionHandler = (args, context) => {
  return !coerceToBoolean(context.evaluateFormula(args[0]));
};

const iferrorHandler: FunctionHandler = (args, context) => {
  try {
    const result = context.evaluateFormula(args[0]);
    // Catches NaN/∞ and the formula error VALUES functions return (a math domain
    // miss like SQRT(-1) → #NUM!), so IFERROR(SQRT(-1), 0) is 0. Text that
    // merely spells an error is not an error value, so it passes through
    // whether it was written as a literal (IFERROR("#NUM!", 42)) or computed
    // (IFERROR(CONCAT("#N","UM!"), 42)) — the computed case is why errors carry
    // provenance at all (#2451).
    if (isErrorResult(result)) {
      return context.evaluateFormula(args[1]);
    }
    return result;
  } catch {
    // If evaluation throws an error, return the fallback value
    return context.evaluateFormula(args[1]);
  }
};

const ifnaHandler: FunctionHandler = (args, context) => {
  const result = context.evaluateFormula(args[0]);
  const isNotAvailable = isSpreadsheetErrorValue(result) && result.code === NA_ERROR.code;
  if (result === null || result === undefined || isNotAvailable) {
    return context.evaluateFormula(args[1]);
  }
  return result;
};

const ifsHandler: FunctionHandler = (args, context) => {
  if (args.length < 2 || args.length % 2 !== 0) {
    throw new Error("IFS requires an even number of arguments (condition-value pairs)");
  }

  // Iterate through condition-value pairs
  for (let i = 0; i < args.length; i += 2) {
    const condition = args[i];
    const value = args[i + 1];

    // Substitute references by POSITION (back to front), skipping any that sit
    // inside a quoted string literal: `IFS(A1="B2", …)` must compare A1 to the
    // TEXT "B2", not to cell B2's value (Codex review). findCellRefs already
    // skips literals and matches absolute / sheet-qualified refs, so this also
    // avoids the earlier regex double-escaping. renderConditionOperand quotes a
    // text cell so its own operators are not re-parsed as comparisons.
    let condExpr = condition;
    const cellRefs = findCellRefs(condition);
    for (let index = cellRefs.length - 1; index >= 0; index--) {
      const { ref, start } = cellRefs[index];
      const rendered = renderConditionOperand(context.getCellValue(ref));
      condExpr = condExpr.slice(0, start) + rendered + condExpr.slice(start + ref.length);
    }

    // Parsed, not executed. This used to call `eval` on `condExpr`, which is
    // the substituted text — so a cell containing `globalThis.x = 1` ran as
    // code whenever an IFS referenced it, and so did anything written into the
    // formula itself. `readOperand` resolves the simple operands (TRUE/FALSE ->
    // boolean, quoted text, numbers); an arithmetic expression it leaves as raw
    // text is handed to the engine's safe evaluator so `A1+1>10` is computed.
    // Only the top-level comparison is applied — the condition is never run.
    const evaluateOperand = (operand: string): CellValue => {
      const parsed = readOperand(operand);
      return typeof parsed === "string" && parsed === operand.trim() ? context.evaluateFormula(operand) : parsed;
    };
    if (evaluateConditionValues(condExpr, evaluateOperand)) {
      // If result is a quoted string, return without quotes

      if (/^["'](.*)["']$/.test(value)) {
        return value.slice(1, -1);
      }
      // Otherwise evaluate as formula or expression
      return context.evaluateFormula(value);
    }
  }

  // If no conditions match, return error
  return NA_ERROR;
};

const trueHandler: FunctionHandler = () => true;

const falseHandler: FunctionHandler = () => false;

// Register all logical functions
functionRegistry.register({
  name: "IF",
  handler: ifHandler,
  minArgs: 3,
  maxArgs: 3,
  description: "Returns one value if a condition is true and another if false",
  examples: ['IF(A1>10, "High", "Low")', "IF(B2>=5, SUM(C1:C10), 0)"],
  category: "Logical",
});

functionRegistry.register({
  name: "AND",
  handler: andHandler,
  minArgs: 1,
  description: "Returns TRUE if all arguments are true",
  examples: ["AND(A1>5, B1<10)", "AND(A1>0, B1>0, C1>0)"],
  category: "Logical",
});

functionRegistry.register({
  name: "OR",
  handler: orHandler,
  minArgs: 1,
  description: "Returns TRUE if any argument is true",
  examples: ["OR(A1>5, B1<10)", "OR(A1>0, B1>0)"],
  category: "Logical",
});

functionRegistry.register({
  name: "NOT",
  handler: notHandler,
  minArgs: 1,
  maxArgs: 1,
  description: "Reverses the logical value of its argument",
  examples: ["NOT(A1>5)", "NOT(B1)"],
  category: "Logical",
});

functionRegistry.register({
  name: "IFERROR",
  handler: iferrorHandler,
  minArgs: 2,
  maxArgs: 2,
  description: "Returns a value if expression is an error, otherwise returns the expression",
  examples: ["IFERROR(A1/B1, 0)", 'IFERROR(VLOOKUP(A1, B1:C10, 2), "Not found")'],
  category: "Logical",
});

functionRegistry.register({
  name: "IFNA",
  handler: ifnaHandler,
  minArgs: 2,
  maxArgs: 2,
  description: "Returns a value if expression is #N/A, otherwise returns the expression",
  examples: ['IFNA(A1, "N/A")', "IFNA(MATCH(A1, B1:B10), 0)"],
  category: "Logical",
});

functionRegistry.register({
  name: "IFS",
  handler: ifsHandler,
  minArgs: 2,
  description: "Checks multiple conditions and returns the first true result",
  examples: ['IFS(A1>90, "A", A1>80, "B", A1>70, "C")', 'IFS(B1="Yes", 1, B1="No", 0)'],
  category: "Logical",
});

functionRegistry.register({
  name: "TRUE",
  handler: trueHandler,
  minArgs: 0,
  maxArgs: 0,
  description: "Returns the logical value TRUE",
  examples: ["TRUE()", "IF(A1>0, TRUE(), FALSE())"],
  category: "Logical",
});

functionRegistry.register({
  name: "FALSE",
  handler: falseHandler,
  minArgs: 0,
  maxArgs: 0,
  description: "Returns the logical value FALSE",
  examples: ["FALSE()", "IF(A1>0, TRUE(), FALSE())"],
  category: "Logical",
});
