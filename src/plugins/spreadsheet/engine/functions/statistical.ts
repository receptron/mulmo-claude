/**
 * Statistical Functions
 */

import {
  functionRegistry,
  toNumber,
  parseCriteria,
  type FunctionContext,
  type FunctionHandler,
} from "../registry";

const isLetter = (char: string): boolean => /[A-Z]/i.test(char);

const isCellReference = (segment: string): boolean => {
  if (!segment) return false;
  let index = 0;
  if (segment[index] === "$") index++;
  const colStart = index;
  while (index < segment.length && isLetter(segment[index])) {
    index++;
  }
  if (index === colStart) return false; // Require at least one column letter
  if (segment[index] === "$") index++;
  if (index >= segment.length) return false; // Require row digits
  for (; index < segment.length; index++) {
    const char = segment[index];
    if (char < "0" || char > "9") {
      return false;
    }
  }
  return true;
};

const isRangeReference = (value: string): boolean => {
  if (!value) return false;
  const rangePart = value.includes("!") ? value.split("!").slice(-1)[0] : value;
  const [start, end] = rangePart.split(":");
  if (!start || !end) return false;
  return isCellReference(start) && isCellReference(end);
};

const collectNumericValues = (
  args: string[],
  context: FunctionContext,
): number[] => {
  const values: number[] = [];

  for (const rawArg of args) {
    const arg = rawArg?.trim();
    if (!arg) continue;

    if (isRangeReference(arg)) {
      const rangeValues = context.getRangeValues(arg).map(toNumber);
      values.push(...rangeValues);
    } else {
      const evaluated = context.evaluateFormula(arg);
      values.push(toNumber(evaluated));
    }
  }

  return values;
};

const sumHandler: FunctionHandler = (args, context) => {
  if (args.length !== 1) throw new Error("SUM requires 1 argument");
  const values = context.getRangeValues(args[0]);
  return values.reduce((sum: number, val) => sum + toNumber(val), 0);
};

const averageHandler: FunctionHandler = (args, context) => {
  if (args.length !== 1) throw new Error("AVERAGE requires 1 argument");
  const values = context.getRangeValues(args[0]);
  if (values.length === 0) return 0;
  const sum = values.reduce((acc: number, val) => acc + toNumber(val), 0);
  return sum / values.length;
};

const maxHandler: FunctionHandler = (args, context) => {
  if (args.length === 0) {
    throw new Error("MAX requires at least 1 argument");
  }
  const values = collectNumericValues(args, context);
  return values.length > 0 ? Math.max(...values) : 0;
};

const minHandler: FunctionHandler = (args, context) => {
  if (args.length === 0) {
    throw new Error("MIN requires at least 1 argument");
  }
  const values = collectNumericValues(args, context);
  return values.length > 0 ? Math.min(...values) : 0;
};

const countHandler: FunctionHandler = (args, context) => {
  if (args.length !== 1) throw new Error("COUNT requires 1 argument");
  const values = context.getRangeValues(args[0]);
  return values.length;
};

const medianHandler: FunctionHandler = (args, context) => {
  if (args.length !== 1) throw new Error("MEDIAN requires 1 argument");
  const values = context
    .getRangeValues(args[0])
    .map(toNumber)
    .sort((a, b) => a - b);

  if (values.length === 0) return 0;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 === 0
    ? (values[mid - 1] + values[mid]) / 2
    : values[mid];
};

const modeHandler: FunctionHandler = (args, context) => {
  if (args.length !== 1) throw new Error("MODE requires 1 argument");
  const values = context.getRangeValues(args[0]).map(toNumber);

  if (values.length === 0) return 0;

  // Count frequency of each value
  const frequency = new Map<number, number>();
  for (const val of values) {
    frequency.set(val, (frequency.get(val) || 0) + 1);
  }

  // Find the value with highest frequency
  let maxFreq = 0;
  let mode = values[0];
  for (const [val, freq] of frequency.entries()) {
    if (freq > maxFreq) {
      maxFreq = freq;
      mode = val;
    }
  }

  return mode;
};

const stdevHandler: FunctionHandler = (args, context) => {
  if (args.length !== 1) throw new Error("STDEV requires 1 argument");
  const values = context.getRangeValues(args[0]).map(toNumber);

  if (values.length === 0) return 0;

  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  const squaredDiffs = values.map((val) => Math.pow(val - mean, 2));
  const variance =
    squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
  return Math.sqrt(variance);
};

const varHandler: FunctionHandler = (args, context) => {
  if (args.length !== 1) throw new Error("VAR requires 1 argument");
  const values = context.getRangeValues(args[0]).map(toNumber);

  if (values.length === 0) return 0;

  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  const squaredDiffs = values.map((val) => Math.pow(val - mean, 2));
  return squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
};

const countaHandler: FunctionHandler = (args, context) => {
  if (args.length !== 1) throw new Error("COUNTA requires 1 argument");
  const values =
    context.getRangeValuesRaw?.(args[0]) ?? context.getRangeValues(args[0]);
  // Count non-empty cells
  return values.filter((v) => v !== null && v !== undefined && v !== "").length;
};

const countifHandler: FunctionHandler = (args, context) => {
  if (args.length !== 2) throw new Error("COUNTIF requires 2 arguments");
  const values =
    context.getRangeValuesRaw?.(args[0]) ?? context.getRangeValues(args[0]);
  const criteria = args[1].trim();
  const compareFn = parseCriteria(criteria);
  return values.filter(compareFn).length;
};

const sumifHandler: FunctionHandler = (args, context) => {
  if (args.length < 2 || args.length > 3) {
    throw new Error("SUMIF requires 2 or 3 arguments");
  }

  const criteriaRange =
    context.getRangeValuesRaw?.(args[0]) ?? context.getRangeValues(args[0]);
  const criteria = args[1].trim();
  const sumRange =
    args.length === 3
      ? context.getRangeValues(args[2])
      : context.getRangeValues(args[0]);

  const compareFn = parseCriteria(criteria);

  let sum = 0;
  for (let i = 0; i < criteriaRange.length; i++) {
    if (compareFn(criteriaRange[i])) {
      sum += toNumber(sumRange[i] ?? 0);
    }
  }

  return sum;
};

const averageifHandler: FunctionHandler = (args, context) => {
  if (args.length < 2 || args.length > 3) {
    throw new Error("AVERAGEIF requires 2 or 3 arguments");
  }

  const criteriaRange =
    context.getRangeValuesRaw?.(args[0]) ?? context.getRangeValues(args[0]);
  const criteria = args[1].trim();
  const avgRange =
    args.length === 3
      ? context.getRangeValues(args[2])
      : context.getRangeValues(args[0]);

  const compareFn = parseCriteria(criteria);

  let sum = 0;
  let count = 0;
  for (let i = 0; i < criteriaRange.length; i++) {
    if (compareFn(criteriaRange[i])) {
      sum += toNumber(avgRange[i] ?? 0);
      count++;
    }
  }

  return count > 0 ? sum / count : 0;
};

// Register all statistical functions
functionRegistry.register({
  name: "SUM",
  handler: sumHandler,
  minArgs: 1,
  maxArgs: 1,
  description: "Returns the sum of all numbers in a range",
  examples: ["SUM(A1:A10)", "SUM(B2:B20)"],
  category: "Statistical",
});

functionRegistry.register({
  name: "AVERAGE",
  handler: averageHandler,
  minArgs: 1,
  maxArgs: 1,
  description: "Returns the average (arithmetic mean) of numbers in a range",
  examples: ["AVERAGE(A1:A10)", "AVERAGE(B2:B20)"],
  category: "Statistical",
});

functionRegistry.register({
  name: "MAX",
  handler: maxHandler,
  minArgs: 1,
  description: "Returns the largest value in a range",
  examples: ["MAX(A1:A10)", "MAX(B2:B20)"],
  category: "Statistical",
});

functionRegistry.register({
  name: "MIN",
  handler: minHandler,
  minArgs: 1,
  description: "Returns the smallest value in a range",
  examples: ["MIN(A1:A10)", "MIN(B2:B20)"],
  category: "Statistical",
});

functionRegistry.register({
  name: "COUNT",
  handler: countHandler,
  minArgs: 1,
  maxArgs: 1,
  description: "Counts the number of cells in a range",
  examples: ["COUNT(A1:A10)", "COUNT(B2:B20)"],
  category: "Statistical",
});

functionRegistry.register({
  name: "MEDIAN",
  handler: medianHandler,
  minArgs: 1,
  maxArgs: 1,
  description: "Returns the median (middle) value in a range",
  examples: ["MEDIAN(A1:A10)", "MEDIAN(B2:B20)"],
  category: "Statistical",
});

functionRegistry.register({
  name: "MODE",
  handler: modeHandler,
  minArgs: 1,
  maxArgs: 1,
  description: "Returns the most frequently occurring value in a range",
  examples: ["MODE(A1:A10)", "MODE(B2:B20)"],
  category: "Statistical",
});

functionRegistry.register({
  name: "STDEV",
  handler: stdevHandler,
  minArgs: 1,
  maxArgs: 1,
  description: "Returns the standard deviation of numbers in a range",
  examples: ["STDEV(A1:A10)", "STDEV(B2:B20)"],
  category: "Statistical",
});

functionRegistry.register({
  name: "VAR",
  handler: varHandler,
  minArgs: 1,
  maxArgs: 1,
  description: "Returns the variance of numbers in a range",
  examples: ["VAR(A1:A10)", "VAR(B2:B20)"],
  category: "Statistical",
});

functionRegistry.register({
  name: "COUNTA",
  handler: countaHandler,
  minArgs: 1,
  maxArgs: 1,
  description: "Counts the number of non-empty cells in a range",
  examples: ["COUNTA(A1:A10)", "COUNTA(B2:B20)"],
  category: "Statistical",
});

functionRegistry.register({
  name: "COUNTIF",
  handler: countifHandler,
  minArgs: 2,
  maxArgs: 2,
  description: "Counts cells in a range that match a criteria",
  examples: ['COUNTIF(A1:A10, ">5")', 'COUNTIF(B1:B10, "Yes")'],
  category: "Statistical",
});

functionRegistry.register({
  name: "SUMIF",
  handler: sumifHandler,
  minArgs: 2,
  maxArgs: 3,
  description: "Sums cells in a range that match a criteria",
  examples: ['SUMIF(A1:A10, ">5")', 'SUMIF(A1:A10, ">5", B1:B10)'],
  category: "Statistical",
});

functionRegistry.register({
  name: "AVERAGEIF",
  handler: averageifHandler,
  minArgs: 2,
  maxArgs: 3,
  description: "Averages cells in a range that match a criteria",
  examples: ['AVERAGEIF(A1:A10, ">5")', 'AVERAGEIF(A1:A10, ">5", B1:B10)'],
  category: "Statistical",
});
