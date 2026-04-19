/**
 * Lookup and Reference Functions
 */

import {
  functionRegistry,
  toNumber,
  parseCriteria,
  type FunctionHandler,
} from "../registry";
import type { CellValue } from "../types";

// Helper to convert Excel column letters to 0-based index (A=0, Z=25, AA=26, etc.)
const colToIndex = (col: string): number => {
  let result = 0;
  for (let i = 0; i < col.length; i++) {
    result = result * 26 + (col.charCodeAt(i) - 64);
  }
  return result - 1;
};

// Helper to convert 0-based index to Excel column letters (0=A, 25=Z, 26=AA, etc.)
const indexToCol = (index: number): string => {
  let col = "";
  let num = index + 1;
  while (num > 0) {
    const remainder = (num - 1) % 26;
    col = String.fromCharCode(65 + remainder) + col;
    num = Math.floor((num - 1) / 26);
  }
  return col;
};

// Helper to find match index
const findMatchIndex = (
  lookupValue: CellValue,
  lookupArray: CellValue[],
  matchType: number = 1, // 1 = less than (sorted asc), 0 = exact, -1 = greater than (sorted desc)
  searchMode: number = 1, // 1 = first to last, -1 = last to first (for XLOOKUP)
): number => {
  const compare = (a: CellValue, b: CellValue) => {
    if (typeof a === "number" && typeof b === "number") return a - b;
    return String(a).localeCompare(String(b));
  };

  // Exact match
  if (matchType === 0) {
    // Handle wildcards for strings if it's an exact match request
    if (
      typeof lookupValue === "string" &&
      (lookupValue.includes("*") || lookupValue.includes("?"))
    ) {
      const criteriaFn = parseCriteria(lookupValue);

      if (searchMode === 1) {
        return lookupArray.findIndex((item) => criteriaFn(item));
      } else {
        for (let i = lookupArray.length - 1; i >= 0; i--) {
          if (criteriaFn(lookupArray[i])) return i;
        }
        return -1;
      }
    }

    if (searchMode === 1) {
      return lookupArray.findIndex((item) => item == lookupValue); // Loose equality for "10" == 10
    } else {
      for (let i = lookupArray.length - 1; i >= 0; i--) {
        if (lookupArray[i] == lookupValue) return i;
      }
      return -1;
    }
  }

  // Approximate match (requires sorted array)
  // We'll assume the user knows what they are doing regarding sorting, as per Excel behavior

  if (matchType === 1) {
    // Less than or equal to
    // Array must be sorted ascending
    let bestIdx = -1;
    for (let i = 0; i < lookupArray.length; i++) {
      const item = lookupArray[i];
      if (compare(item, lookupValue) <= 0) {
        bestIdx = i;
      } else {
        // Since it's sorted ascending, once we exceed, we can stop
        break;
      }
    }
    return bestIdx;
  }

  if (matchType === -1) {
    // Greater than or equal to
    // Array must be sorted descending
    let bestIdx = -1;
    for (let i = 0; i < lookupArray.length; i++) {
      const item = lookupArray[i];
      if (compare(item, lookupValue) >= 0) {
        bestIdx = i;
      } else {
        break;
      }
    }
    return bestIdx;
  }

  return -1;
};

const vlookupHandler: FunctionHandler = (args, context) => {
  if (args.length < 3 || args.length > 4) {
    throw new Error("VLOOKUP requires 3 or 4 arguments");
  }

  const lookupValue = context.evaluateFormula(args[0]);
  const tableArrayRange = args[1];
  const colIndexNum = toNumber(context.evaluateFormula(args[2]));
  const rangeLookup =
    args.length === 4 ? context.evaluateFormula(args[3]) : true;

  // Convert rangeLookup to boolean/number logic
  // TRUE/1/omitted = approximate match (default)
  // FALSE/0 = exact match
  const isApprox =
    rangeLookup === true || rangeLookup === 1 || rangeLookup === "1";
  const matchType = isApprox ? 1 : 0;

  // Get the full table data
  // We need to parse the range string to get dimensions
  const match = tableArrayRange.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  if (!match) throw new Error("Invalid table array range");

  // We need to get the first column for looking up
  // And the specific column for the result
  // This is a bit tricky with the current getRangeValues which flattens everything
  // We need to manually reconstruct the table structure or request specific cells

  // Let's parse the range to get start/end col/row
  // Note: This relies on the context.getCellValue implementation details or we need to implement
  // a smarter way to get 2D data.
  // For now, we will iterate row by row.

  // Parse range manually to get boundaries
  // We can't easily use context.getRangeValues because it flattens 2D arrays to 1D
  // So we will iterate through the rows of the first column

  // Extract sheet name if present
  let sheetName = "";
  let rangePart = tableArrayRange;
  if (tableArrayRange.includes("!")) {
    const parts = tableArrayRange.split("!");
    sheetName = parts[0] + "!";
    rangePart = parts[1];
  }

  const rangeMatch = rangePart.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  if (!rangeMatch) throw new Error("Invalid range format");

  const startColStr = rangeMatch[1];
  const startRow = parseInt(rangeMatch[2]);
  const endRow = parseInt(rangeMatch[4]);

  const startColIdx = colToIndex(startColStr);
  const resultColIdx = startColIdx + colIndexNum - 1;
  const resultColStr = indexToCol(resultColIdx);

  // Build lookup array (first column)
  const lookupArray: CellValue[] = [];
  for (let r = startRow; r <= endRow; r++) {
    const cellRef = `${sheetName}${startColStr}${r}`;
    lookupArray.push(context.getCellValue(cellRef));
  }

  const matchIdx = findMatchIndex(lookupValue, lookupArray, matchType);

  if (matchIdx === -1) return "#N/A";

  // Get result
  const resultRow = startRow + matchIdx;
  const resultRef = `${sheetName}${resultColStr}${resultRow}`;

  return context.getCellValue(resultRef);
};

const hlookupHandler: FunctionHandler = (args, context) => {
  if (args.length < 3 || args.length > 4) {
    throw new Error("HLOOKUP requires 3 or 4 arguments");
  }

  const lookupValue = context.evaluateFormula(args[0]);
  const tableArrayRange = args[1];
  const rowIndexNum = toNumber(context.evaluateFormula(args[2]));
  const rangeLookup =
    args.length === 4 ? context.evaluateFormula(args[3]) : true;

  const isApprox =
    rangeLookup === true || rangeLookup === 1 || rangeLookup === "1";
  const matchType = isApprox ? 1 : 0;

  // Extract sheet name if present
  let sheetName = "";
  let rangePart = tableArrayRange;
  if (tableArrayRange.includes("!")) {
    const parts = tableArrayRange.split("!");
    sheetName = parts[0] + "!";
    rangePart = parts[1];
  }

  const rangeMatch = rangePart.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  if (!rangeMatch) throw new Error("Invalid range format");

  const startColStr = rangeMatch[1];
  const endColStr = rangeMatch[3];
  const startRow = parseInt(rangeMatch[2]);

  const startColIdx = colToIndex(startColStr);
  const endColIdx = colToIndex(endColStr);

  // Build lookup array (first row)
  const lookupArray: CellValue[] = [];
  for (let c = startColIdx; c <= endColIdx; c++) {
    const colStr = indexToCol(c);
    const cellRef = `${sheetName}${colStr}${startRow}`;
    lookupArray.push(context.getCellValue(cellRef));
  }

  const matchIdx = findMatchIndex(lookupValue, lookupArray, matchType);

  if (matchIdx === -1) return "#N/A";

  // Get result
  const resultColIdx = startColIdx + matchIdx;
  const resultColStr = indexToCol(resultColIdx);
  const resultRow = startRow + rowIndexNum - 1;
  const resultRef = `${sheetName}${resultColStr}${resultRow}`;

  return context.getCellValue(resultRef);
};

const matchHandler: FunctionHandler = (args, context) => {
  if (args.length < 2 || args.length > 3) {
    throw new Error("MATCH requires 2 or 3 arguments");
  }

  const lookupValue = context.evaluateFormula(args[0]);
  const lookupArrayRange = args[1];
  const matchType =
    args.length === 3 ? toNumber(context.evaluateFormula(args[2])) : 1;

  const lookupArray = context.getRangeValues(lookupArrayRange);

  const index = findMatchIndex(lookupValue, lookupArray, matchType);

  return index === -1 ? "#N/A" : index + 1; // 1-based index
};

const indexHandler: FunctionHandler = (args, context) => {
  if (args.length < 2 || args.length > 4) {
    throw new Error("INDEX requires 2 to 4 arguments");
  }

  const arrayRange = args[0];
  const rowNum = toNumber(context.evaluateFormula(args[1]));
  const colNum =
    args.length >= 3 ? toNumber(context.evaluateFormula(args[2])) : 1; // Default to 1 if omitted (for 1D arrays)

  // Parse range to find the specific cell
  let sheetName = "";
  let rangePart = arrayRange;
  if (arrayRange.includes("!")) {
    const parts = arrayRange.split("!");
    sheetName = parts[0] + "!";
    rangePart = parts[1];
  }

  const rangeMatch = rangePart.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  if (!rangeMatch) throw new Error("Invalid range format");

  const startColStr = rangeMatch[1];
  const startRow = parseInt(rangeMatch[2]);

  const startColIdx = colToIndex(startColStr);

  // Calculate target cell
  // rowNum and colNum are 1-based relative to the range
  const targetRow = startRow + rowNum - 1;
  const targetColIdx = startColIdx + colNum - 1;
  const targetColStr = indexToCol(targetColIdx);

  const ref = `${sheetName}${targetColStr}${targetRow}`;
  return context.getCellValue(ref);
};

const xlookupHandler: FunctionHandler = (args, context) => {
  if (args.length < 3 || args.length > 6) {
    throw new Error("XLOOKUP requires 3 to 6 arguments");
  }

  const lookupValue = context.evaluateFormula(args[0]);
  const lookupArrayRange = args[1];
  const returnArrayRange = args[2];
  const ifNotFound =
    args.length >= 4 ? context.evaluateFormula(args[3]) : "#N/A";
  const matchMode =
    args.length >= 5 ? toNumber(context.evaluateFormula(args[4])) : 0;
  const searchMode =
    args.length >= 6 ? toNumber(context.evaluateFormula(args[5])) : 1;

  const lookupArray = context.getRangeValues(lookupArrayRange);
  const returnArray = context.getRangeValues(returnArrayRange);

  // XLOOKUP match modes:
  // 0 = Exact match (default)
  // -1 = Exact match or next smaller
  // 1 = Exact match or next larger
  // 2 = Wildcard match

  // Map XLOOKUP modes to our internal findMatchIndex modes
  // Our internal: 0=exact, 1=less than (sorted), -1=greater than (sorted)
  // XLOOKUP is more complex because it doesn't require sorted arrays for next smaller/larger
  // For now, we'll implement exact (0) and wildcard (2 -> handled by exact with wildcard logic in findMatchIndex)
  // For -1 and 1, we'll do a linear search for best match if not sorted

  let matchIdx = -1;

  if (matchMode === 0 || matchMode === 2) {
    matchIdx = findMatchIndex(lookupValue, lookupArray, 0, searchMode);
  } else {
    // Implement exact or next smaller/larger for unsorted arrays
    // This is O(N)
    let bestDiff = Infinity;

    for (let i = 0; i < lookupArray.length; i++) {
      const idx = searchMode === 1 ? i : lookupArray.length - 1 - i;
      const item = lookupArray[idx];

      if (item == lookupValue) {
        matchIdx = idx;
        break;
      }

      if (typeof item === "number" && typeof lookupValue === "number") {
        const diff = item - lookupValue;
        if (matchMode === -1 && diff < 0 && Math.abs(diff) < bestDiff) {
          // Next smaller (closest negative difference)
          bestDiff = Math.abs(diff);
          matchIdx = idx;
        } else if (matchMode === 1 && diff > 0 && diff < bestDiff) {
          // Next larger (closest positive difference)
          bestDiff = diff;
          matchIdx = idx;
        }
      }
    }
  }

  if (matchIdx === -1) return ifNotFound;

  if (matchIdx >= 0 && matchIdx < returnArray.length) {
    return returnArray[matchIdx];
  }

  return "#N/A";
};

// Register functions
functionRegistry.register({
  name: "VLOOKUP",
  handler: vlookupHandler,
  minArgs: 3,
  maxArgs: 4,
  description:
    "Looks for a value in the leftmost column of a table, and then returns a value in the same row from a column you specify",
  examples: ["VLOOKUP(105, A2:C10, 2)", 'VLOOKUP("Smith", A2:E10, 5, FALSE)'],
  category: "Lookup & Reference",
});

functionRegistry.register({
  name: "HLOOKUP",
  handler: hlookupHandler,
  minArgs: 3,
  maxArgs: 4,
  description:
    "Looks for a value in the top row of a table, and then returns a value in the same column from a row you specify",
  examples: ['HLOOKUP("Axles", A1:C10, 2, TRUE)'],
  category: "Lookup & Reference",
});

functionRegistry.register({
  name: "MATCH",
  handler: matchHandler,
  minArgs: 2,
  maxArgs: 3,
  description:
    "Returns the relative position of an item in an array that matches a specified value",
  examples: ["MATCH(25, A1:A10, 0)", 'MATCH("b", A1:A5, 0)'],
  category: "Lookup & Reference",
});

functionRegistry.register({
  name: "INDEX",
  handler: indexHandler,
  minArgs: 2,
  maxArgs: 4,
  description:
    "Returns the value of an element in a table or an array, selected by the row and column number indexes",
  examples: ["INDEX(A1:B5, 2, 2)", "INDEX(A1:A10, 5)"],
  category: "Lookup & Reference",
});

functionRegistry.register({
  name: "XLOOKUP",
  handler: xlookupHandler,
  minArgs: 3,
  maxArgs: 6,
  description:
    "Searches a range or an array, and returns an item corresponding to the first match it finds",
  examples: [
    "XLOOKUP(A1, B1:B10, C1:C10)",
    'XLOOKUP("USA", Countries, Populations)',
  ],
  category: "Lookup & Reference",
});
