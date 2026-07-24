/**
 * Mathematical Functions
 */

import { functionRegistry, toNumber, type FunctionHandler } from "../registry";
import {
  roundTo,
  roundUpTo,
  roundDownTo,
  floorToSignificance,
  ceilingToSignificance,
  modulo,
  power,
  safeLog,
  safeLog10,
  safeSqrt,
  logWithBase,
} from "../math-ops";
import { toScalarNumber } from "../numericCoercion";
import { isSpreadsheetErrorValue } from "../spreadsheet-errors";

const roundHandler: FunctionHandler = (args, context) => {
  const number = toNumber(context.evaluateFormula(args[0]));
  const digits = toNumber(context.evaluateFormula(args[1]));
  return roundTo(number, digits);
};

const roundupHandler: FunctionHandler = (args, context) => {
  const number = toNumber(context.evaluateFormula(args[0]));
  const digits = toNumber(context.evaluateFormula(args[1]));
  return roundUpTo(number, digits);
};

const rounddownHandler: FunctionHandler = (args, context) => {
  const number = toNumber(context.evaluateFormula(args[0]));
  const digits = toNumber(context.evaluateFormula(args[1]));
  return roundDownTo(number, digits);
};

const floorHandler: FunctionHandler = (args, context) => {
  const number = toNumber(context.evaluateFormula(args[0]));
  const significance = toNumber(context.evaluateFormula(args[1]));
  return floorToSignificance(number, significance);
};

const ceilingHandler: FunctionHandler = (args, context) => {
  const number = toNumber(context.evaluateFormula(args[0]));
  const significance = toNumber(context.evaluateFormula(args[1]));
  return ceilingToSignificance(number, significance);
};

const absHandler: FunctionHandler = (args, context) => {
  const number = toScalarNumber(context.evaluateFormula(args[0]));
  return isSpreadsheetErrorValue(number) ? number : Math.abs(number);
};

const powerHandler: FunctionHandler = (args, context) => {
  const base = toNumber(context.evaluateFormula(args[0]));
  const exponent = toNumber(context.evaluateFormula(args[1]));
  return power(base, exponent);
};

const sqrtHandler: FunctionHandler = (args, context) => {
  const number = toNumber(context.evaluateFormula(args[0]));
  return safeSqrt(number);
};

const modHandler: FunctionHandler = (args, context) => {
  const number = toNumber(context.evaluateFormula(args[0]));
  const divisor = toNumber(context.evaluateFormula(args[1]));
  return modulo(number, divisor);
};

const intHandler: FunctionHandler = (args, context) => {
  const number = toNumber(context.evaluateFormula(args[0]));
  return Math.floor(number);
};

const truncHandler: FunctionHandler = (args, context) => {
  const number = toNumber(context.evaluateFormula(args[0]));
  const digits = args.length === 2 ? toNumber(context.evaluateFormula(args[1])) : 0;
  const multiplier = Math.pow(10, digits);
  return Math.trunc(number * multiplier) / multiplier;
};

const signHandler: FunctionHandler = (args, context) => {
  const number = toScalarNumber(context.evaluateFormula(args[0]));
  return isSpreadsheetErrorValue(number) ? number : Math.sign(number);
};

const piHandler: FunctionHandler = () => Math.PI;

const expHandler: FunctionHandler = (args, context) => {
  const number = toNumber(context.evaluateFormula(args[0]));
  return Math.exp(number);
};

const lnHandler: FunctionHandler = (args, context) => {
  const number = toNumber(context.evaluateFormula(args[0]));
  return safeLog(number);
};

const logHandler: FunctionHandler = (args, context) => {
  const number = toNumber(context.evaluateFormula(args[0]));
  const base = args.length === 2 ? toNumber(context.evaluateFormula(args[1])) : 10;
  return logWithBase(number, base);
};

const log10Handler: FunctionHandler = (args, context) => {
  const number = toNumber(context.evaluateFormula(args[0]));
  return safeLog10(number);
};

// Register all mathematical functions
functionRegistry.register({
  name: "ROUND",
  handler: roundHandler,
  minArgs: 2,
  maxArgs: 2,
  description: "Rounds a number to a specified number of digits",
  examples: ["ROUND(3.14159, 2)", "ROUND(A1, 0)"],
  category: "Mathematical",
});

functionRegistry.register({
  name: "ROUNDUP",
  handler: roundupHandler,
  minArgs: 2,
  maxArgs: 2,
  description: "Rounds a number up, away from zero",
  examples: ["ROUNDUP(3.14159, 2)", "ROUNDUP(A1, 0)"],
  category: "Mathematical",
});

functionRegistry.register({
  name: "ROUNDDOWN",
  handler: rounddownHandler,
  minArgs: 2,
  maxArgs: 2,
  description: "Rounds a number down, toward zero",
  examples: ["ROUNDDOWN(3.14159, 2)", "ROUNDDOWN(A1, 0)"],
  category: "Mathematical",
});

functionRegistry.register({
  name: "FLOOR",
  handler: floorHandler,
  minArgs: 2,
  maxArgs: 2,
  description: "Rounds a number down to the nearest multiple of significance",
  examples: ["FLOOR(3.7, 1)", "FLOOR(24, 5)"],
  category: "Mathematical",
});

functionRegistry.register({
  name: "CEILING",
  handler: ceilingHandler,
  minArgs: 2,
  maxArgs: 2,
  description: "Rounds a number up to the nearest multiple of significance",
  examples: ["CEILING(3.2, 1)", "CEILING(24, 5)"],
  category: "Mathematical",
});

functionRegistry.register({
  name: "ABS",
  handler: absHandler,
  minArgs: 1,
  maxArgs: 1,
  description: "Returns the absolute value of a number",
  examples: ["ABS(-5)", "ABS(A1)"],
  category: "Mathematical",
});

functionRegistry.register({
  name: "POWER",
  handler: powerHandler,
  minArgs: 2,
  maxArgs: 2,
  description: "Returns the result of a number raised to a power",
  examples: ["POWER(2, 3)", "POWER(A1, 2)"],
  category: "Mathematical",
});

functionRegistry.register({
  name: "SQRT",
  handler: sqrtHandler,
  minArgs: 1,
  maxArgs: 1,
  description: "Returns the square root of a number",
  examples: ["SQRT(16)", "SQRT(A1)"],
  category: "Mathematical",
});

functionRegistry.register({
  name: "MOD",
  handler: modHandler,
  minArgs: 2,
  maxArgs: 2,
  description: "Returns the remainder after division",
  examples: ["MOD(10, 3)", "MOD(A1, 2)"],
  category: "Mathematical",
});

functionRegistry.register({
  name: "INT",
  handler: intHandler,
  minArgs: 1,
  maxArgs: 1,
  description: "Rounds a number down to the nearest integer",
  examples: ["INT(3.7)", "INT(A1)"],
  category: "Mathematical",
});

functionRegistry.register({
  name: "TRUNC",
  handler: truncHandler,
  minArgs: 1,
  maxArgs: 2,
  description: "Truncates a number to a specified number of decimal places",
  examples: ["TRUNC(3.14159, 2)", "TRUNC(A1)"],
  category: "Mathematical",
});

functionRegistry.register({
  name: "SIGN",
  handler: signHandler,
  minArgs: 1,
  maxArgs: 1,
  description: "Returns the sign of a number (1, 0, or -1)",
  examples: ["SIGN(-5)", "SIGN(A1)"],
  category: "Mathematical",
});

functionRegistry.register({
  name: "PI",
  handler: piHandler,
  minArgs: 0,
  maxArgs: 0,
  description: "Returns the value of pi (3.14159...)",
  examples: ["PI()", "PI()*2"],
  category: "Mathematical",
});

functionRegistry.register({
  name: "EXP",
  handler: expHandler,
  minArgs: 1,
  maxArgs: 1,
  description: "Returns e raised to the power of a number",
  examples: ["EXP(1)", "EXP(A1)"],
  category: "Mathematical",
});

functionRegistry.register({
  name: "LN",
  handler: lnHandler,
  minArgs: 1,
  maxArgs: 1,
  description: "Returns the natural logarithm of a number",
  examples: ["LN(10)", "LN(A1)"],
  category: "Mathematical",
});

functionRegistry.register({
  name: "LOG",
  handler: logHandler,
  minArgs: 1,
  maxArgs: 2,
  description: "Returns the logarithm of a number to a specified base",
  examples: ["LOG(100)", "LOG(8, 2)"],
  category: "Mathematical",
});

functionRegistry.register({
  name: "LOG10",
  handler: log10Handler,
  minArgs: 1,
  maxArgs: 1,
  description: "Returns the base-10 logarithm of a number",
  examples: ["LOG10(100)", "LOG10(A1)"],
  category: "Mathematical",
});
