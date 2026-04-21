/**
 * Logical Functions
 */

import { functionRegistry, type FunctionHandler } from "../registry";

const ifHandler: FunctionHandler = (args, context) => {
  if (args.length !== 3) throw new Error("IF requires 3 arguments");

  const condition = args[0];
  const trueValue = args[1];
  const falseValue = args[2];

  // Evaluate condition - use evaluateFormula to handle nested functions like MONTH()
  const conditionValue = context.evaluateFormula(condition);

  // Convert to boolean
  let conditionResult = false;
  if (typeof conditionValue === "boolean") {
    conditionResult = conditionValue;
  } else if (typeof conditionValue === "number") {
    conditionResult = conditionValue !== 0;
  } else if (typeof conditionValue === "string") {
    conditionResult = conditionValue.toLowerCase() === "true" || conditionValue !== "";
  } else {
    conditionResult = !!conditionValue;
  }

  // Return the appropriate value based on condition
  const resultValue = conditionResult ? trueValue : falseValue;

  // If result is a quoted string, return the string without quotes
  if (/^["'](.*)["']$/.test(resultValue)) {
    return resultValue.slice(1, -1);
  }

  // If result is a nested formula, evaluate it recursively
  if (/^(SUM|AVERAGE|MAX|MIN|COUNT|IF|AND|OR|NOT)\(/i.test(resultValue)) {
    return context.evaluateFormula(resultValue);
  }

  // Otherwise evaluate as expression
  let expr = resultValue;

  const refs = resultValue.match(/(?:'[^']+'|[^'!\s]+)![A-Z]+\d+|\$?[A-Z]+\$?\d+/g);
  if (refs) {
    for (const ref of refs) {
      const value = context.getCellValue(ref);
      const escapedRef = ref.replace(/\$/g, "\\$").replace(/'/g, "\\'");
      expr = expr.replace(new RegExp(escapedRef.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), String(value));
    }
  }

  const numResult = parseFloat(expr);
  return isNaN(numResult) ? expr : numResult;
};

const andHandler: FunctionHandler = (args, context) => {
  if (args.length === 0) throw new Error("AND requires at least 1 argument");

  for (const arg of args) {
    const value = context.evaluateFormula(arg.trim());
    // Check if value is falsy (0, false, empty string, etc.)
    // Note: !value already covers false, so we check for 0 and "0" explicitly
    if (!value || value === 0 || value === "0") {
      return false;
    }
  }
  return true;
};

const orHandler: FunctionHandler = (args, context) => {
  if (args.length === 0) throw new Error("OR requires at least 1 argument");

  for (const arg of args) {
    const value = context.evaluateFormula(arg.trim());
    // Check if value is truthy (non-zero, non-empty)
    if (value && value !== 0 && value !== "0") {
      return true;
    }
  }
  return false;
};

const notHandler: FunctionHandler = (args, context) => {
  if (args.length !== 1) throw new Error("NOT requires 1 argument");

  const value = context.evaluateFormula(args[0]);
  // Note: !value already covers false
  return !value || value === 0 || value === "0";
};

const iferrorHandler: FunctionHandler = (args, context) => {
  if (args.length !== 2) throw new Error("IFERROR requires 2 arguments");

  try {
    const result = context.evaluateFormula(args[0]);
    // Check if result is an error (NaN, Infinity, etc.)
    if (result === null || result === undefined || (typeof result === "number" && (isNaN(result) || !isFinite(result)))) {
      return context.evaluateFormula(args[1]);
    }
    return result;
  } catch {
    // If evaluation throws an error, return the fallback value
    return context.evaluateFormula(args[1]);
  }
};

const ifnaHandler: FunctionHandler = (args, context) => {
  if (args.length !== 2) throw new Error("IFNA requires 2 arguments");

  const result = context.evaluateFormula(args[0]);
  // Check if result is N/A (could be represented as specific error value)
  if (result === null || result === undefined || result === "#N/A") {
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

    // Evaluate condition
    let condExpr = condition;

    const cellRefs = condition.match(/(?:'[^']+'|[^'!\s]+)![A-Z]+\d+|\$?[A-Z]+\$?\d+/g);
    if (cellRefs) {
      for (const ref of cellRefs) {
        const cellValue = context.getCellValue(ref);
        const escapedRef = ref.replace(/\$/g, "\\$").replace(/'/g, "\\'");
        condExpr = condExpr.replace(new RegExp(escapedRef.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), String(cellValue));
      }
    }

    // Evaluate the condition
    let conditionResult = false;

    if (/>=|<=|>|<|==|!=/.test(condExpr)) {
      conditionResult = eval(condExpr);
    } else {
      conditionResult = !!eval(condExpr);
    }

    if (conditionResult) {
      // If result is a quoted string, return without quotes

      if (/^["'](.*)["']$/.test(value)) {
        return value.slice(1, -1);
      }
      // Otherwise evaluate as formula or expression
      return context.evaluateFormula(value);
    }
  }

  // If no conditions match, return error
  return "#N/A";
};

const trueHandler: FunctionHandler = (args) => {
  if (args.length !== 0) throw new Error("TRUE requires 0 arguments");
  return true;
};

const falseHandler: FunctionHandler = (args) => {
  if (args.length !== 0) throw new Error("FALSE requires 0 arguments");
  return false;
};

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
