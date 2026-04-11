/**
 * Text Functions
 */

import { functionRegistry, toString, type FunctionHandler } from "../registry";

const concatenateHandler: FunctionHandler = (args, context) => {
  if (args.length === 0)
    throw new Error("CONCATENATE requires at least 1 argument");

  return args
    .map((arg) => {
      const value = context.evaluateFormula(arg.trim());
      return toString(value);
    })
    .join("");
};

const concatHandler: FunctionHandler = concatenateHandler; // Alias

const leftHandler: FunctionHandler = (args, context) => {
  if (args.length < 1 || args.length > 2) {
    throw new Error("LEFT requires 1 or 2 arguments");
  }

  const text = toString(context.evaluateFormula(args[0]));
  const numChars =
    args.length === 2 ? Number(context.evaluateFormula(args[1])) : 1;

  return text.substring(0, numChars);
};

const rightHandler: FunctionHandler = (args, context) => {
  if (args.length < 1 || args.length > 2) {
    throw new Error("RIGHT requires 1 or 2 arguments");
  }

  const text = toString(context.evaluateFormula(args[0]));
  const numChars =
    args.length === 2 ? Number(context.evaluateFormula(args[1])) : 1;

  return text.substring(text.length - numChars);
};

const midHandler: FunctionHandler = (args, context) => {
  if (args.length !== 3) throw new Error("MID requires 3 arguments");

  const text = toString(context.evaluateFormula(args[0]));
  const start = Number(context.evaluateFormula(args[1])) - 1; // 1-indexed to 0-indexed
  const numChars = Number(context.evaluateFormula(args[2]));

  return text.substring(start, start + numChars);
};

const lenHandler: FunctionHandler = (args, context) => {
  if (args.length !== 1) throw new Error("LEN requires 1 argument");

  const text = toString(context.evaluateFormula(args[0]));
  return text.length;
};

const upperHandler: FunctionHandler = (args, context) => {
  if (args.length !== 1) throw new Error("UPPER requires 1 argument");

  const text = toString(context.evaluateFormula(args[0]));
  return text.toUpperCase();
};

const lowerHandler: FunctionHandler = (args, context) => {
  if (args.length !== 1) throw new Error("LOWER requires 1 argument");

  const text = toString(context.evaluateFormula(args[0]));
  return text.toLowerCase();
};

const properHandler: FunctionHandler = (args, context) => {
  if (args.length !== 1) throw new Error("PROPER requires 1 argument");

  const text = toString(context.evaluateFormula(args[0]));
  return text
    .toLowerCase()
    .split(" ")
    .map((word) =>
      word.length > 0 ? word[0].toUpperCase() + word.slice(1) : "",
    )
    .join(" ");
};

const trimHandler: FunctionHandler = (args, context) => {
  if (args.length !== 1) throw new Error("TRIM requires 1 argument");

  const text = toString(context.evaluateFormula(args[0]));
  // Trim leading/trailing spaces and replace multiple spaces with single space
  return text.trim().replace(/\s+/g, " ");
};

const substituteHandler: FunctionHandler = (args, context) => {
  if (args.length < 3 || args.length > 4) {
    throw new Error("SUBSTITUTE requires 3 or 4 arguments");
  }

  const text = toString(context.evaluateFormula(args[0]));
  const oldText = toString(context.evaluateFormula(args[1]));
  const newText = toString(context.evaluateFormula(args[2]));

  if (args.length === 4) {
    // Replace specific instance
    const instance = Number(context.evaluateFormula(args[3]));
    let count = 0;
    let index = 0;

    while (index < text.length) {
      const pos = text.indexOf(oldText, index);
      if (pos === -1) break;

      count++;
      if (count === instance) {
        return (
          text.substring(0, pos) +
          newText +
          text.substring(pos + oldText.length)
        );
      }
      index = pos + 1;
    }
    return text; // Instance not found
  } else {
    // Replace all instances
    return text.split(oldText).join(newText);
  }
};

const replaceHandler: FunctionHandler = (args, context) => {
  if (args.length !== 4) throw new Error("REPLACE requires 4 arguments");

  const oldText = toString(context.evaluateFormula(args[0]));
  const startPos = Number(context.evaluateFormula(args[1])) - 1; // 1-indexed to 0-indexed
  const numChars = Number(context.evaluateFormula(args[2]));
  const newText = toString(context.evaluateFormula(args[3]));

  return (
    oldText.substring(0, startPos) +
    newText +
    oldText.substring(startPos + numChars)
  );
};

const findHandler: FunctionHandler = (args, context) => {
  if (args.length < 2 || args.length > 3) {
    throw new Error("FIND requires 2 or 3 arguments");
  }

  const findText = toString(context.evaluateFormula(args[0]));
  const withinText = toString(context.evaluateFormula(args[1]));
  const startPos =
    args.length === 3 ? Number(context.evaluateFormula(args[2])) - 1 : 0;

  const index = withinText.indexOf(findText, startPos);
  return index === -1 ? "#VALUE!" : index + 1; // Return 1-indexed position
};

const searchHandler: FunctionHandler = (args, context) => {
  if (args.length < 2 || args.length > 3) {
    throw new Error("SEARCH requires 2 or 3 arguments");
  }

  const findText = toString(context.evaluateFormula(args[0]));
  const withinText = toString(context.evaluateFormula(args[1]));
  const startPos =
    args.length === 3 ? Number(context.evaluateFormula(args[2])) - 1 : 0;

  // SEARCH is case-insensitive
  const lowerFind = findText.toLowerCase();
  const lowerWithin = withinText.toLowerCase();

  const index = lowerWithin.indexOf(lowerFind, startPos);
  return index === -1 ? "#VALUE!" : index + 1; // Return 1-indexed position
};

const textHandler: FunctionHandler = (args, context) => {
  if (args.length !== 2) throw new Error("TEXT requires 2 arguments");

  const value = context.evaluateFormula(args[0]);
  const format = toString(context.evaluateFormula(args[1])).replace(
    // eslint-disable -- sonarjs/anchor-precedence
    /^["']|["']$/g,
    "",
  );

  // Simple format code handling
  if (typeof value === "number") {
    // Handle common format codes
    if (format.includes("$")) {
      const decimals = (format.match(/\.0+/) || [""])[0].length - 1;
      return "$" + value.toFixed(decimals >= 0 ? decimals : 2);
    }
    if (format.includes("%")) {
      const decimals = (format.match(/\.0+/) || [""])[0].length - 1;
      return (value * 100).toFixed(decimals >= 0 ? decimals : 2) + "%";
    }
    if (format.includes("0")) {
      const decimals = (format.match(/\.0+/) || [""])[0].length - 1;
      return value.toFixed(decimals >= 0 ? decimals : 0);
    }
  }

  return toString(value);
};

const valueHandler: FunctionHandler = (args, context) => {
  if (args.length !== 1) throw new Error("VALUE requires 1 argument");

  const text = toString(context.evaluateFormula(args[0]));

  // Remove currency symbols and commas
  const cleaned = text.replace(/[$,]/g, "").trim();

  // Handle percentages
  if (cleaned.includes("%")) {
    const num = parseFloat(cleaned.replace("%", ""));
    return isNaN(num) ? "#VALUE!" : num / 100;
  }

  const num = parseFloat(cleaned);
  return isNaN(num) ? "#VALUE!" : num;
};

const exactHandler: FunctionHandler = (args, context) => {
  if (args.length !== 2) throw new Error("EXACT requires 2 arguments");

  const text1 = toString(context.evaluateFormula(args[0]));
  const text2 = toString(context.evaluateFormula(args[1]));

  return text1 === text2;
};

// Register all text functions
functionRegistry.register({
  name: "CONCATENATE",
  handler: concatenateHandler,
  minArgs: 1,
  description: "Joins several text strings into one string",
  examples: ['CONCATENATE("Hello", " ", "World")', "CONCATENATE(A1, B1)"],
  category: "Text",
});

functionRegistry.register({
  name: "CONCAT",
  handler: concatHandler,
  minArgs: 1,
  description:
    "Joins several text strings into one string (same as CONCATENATE)",
  examples: ['CONCAT("Hello", " ", "World")', "CONCAT(A1, B1)"],
  category: "Text",
});

functionRegistry.register({
  name: "LEFT",
  handler: leftHandler,
  minArgs: 1,
  maxArgs: 2,
  description: "Returns the leftmost characters from a text string",
  examples: ['LEFT("Hello", 2)', "LEFT(A1, 3)"],
  category: "Text",
});

functionRegistry.register({
  name: "RIGHT",
  handler: rightHandler,
  minArgs: 1,
  maxArgs: 2,
  description: "Returns the rightmost characters from a text string",
  examples: ['RIGHT("Hello", 2)', "RIGHT(A1, 3)"],
  category: "Text",
});

functionRegistry.register({
  name: "MID",
  handler: midHandler,
  minArgs: 3,
  maxArgs: 3,
  description: "Returns characters from the middle of a text string",
  examples: ['MID("Hello", 2, 3)', "MID(A1, 1, 5)"],
  category: "Text",
});

functionRegistry.register({
  name: "LEN",
  handler: lenHandler,
  minArgs: 1,
  maxArgs: 1,
  description: "Returns the number of characters in a text string",
  examples: ['LEN("Hello")', "LEN(A1)"],
  category: "Text",
});

functionRegistry.register({
  name: "UPPER",
  handler: upperHandler,
  minArgs: 1,
  maxArgs: 1,
  description: "Converts text to uppercase",
  examples: ['UPPER("hello")', "UPPER(A1)"],
  category: "Text",
});

functionRegistry.register({
  name: "LOWER",
  handler: lowerHandler,
  minArgs: 1,
  maxArgs: 1,
  description: "Converts text to lowercase",
  examples: ['LOWER("HELLO")', "LOWER(A1)"],
  category: "Text",
});

functionRegistry.register({
  name: "PROPER",
  handler: properHandler,
  minArgs: 1,
  maxArgs: 1,
  description: "Capitalizes the first letter of each word",
  examples: ['PROPER("hello world")', "PROPER(A1)"],
  category: "Text",
});

functionRegistry.register({
  name: "TRIM",
  handler: trimHandler,
  minArgs: 1,
  maxArgs: 1,
  description: "Removes extra spaces from text",
  examples: ['TRIM("  hello  world  ")', "TRIM(A1)"],
  category: "Text",
});

functionRegistry.register({
  name: "SUBSTITUTE",
  handler: substituteHandler,
  minArgs: 3,
  maxArgs: 4,
  description: "Replaces old text with new text in a string",
  examples: [
    'SUBSTITUTE("Hello World", "World", "Earth")',
    'SUBSTITUTE(A1, "old", "new", 1)',
  ],
  category: "Text",
});

functionRegistry.register({
  name: "REPLACE",
  handler: replaceHandler,
  minArgs: 4,
  maxArgs: 4,
  description: "Replaces part of a text string with a different text string",
  examples: [
    'REPLACE("Hello World", 7, 5, "Earth")',
    'REPLACE(A1, 1, 3, "New")',
  ],
  category: "Text",
});

functionRegistry.register({
  name: "FIND",
  handler: findHandler,
  minArgs: 2,
  maxArgs: 3,
  description: "Finds one text string within another (case-sensitive)",
  examples: ['FIND("o", "Hello")', 'FIND("World", A1)'],
  category: "Text",
});

functionRegistry.register({
  name: "SEARCH",
  handler: searchHandler,
  minArgs: 2,
  maxArgs: 3,
  description: "Finds one text string within another (case-insensitive)",
  examples: ['SEARCH("O", "Hello")', 'SEARCH("world", A1)'],
  category: "Text",
});

functionRegistry.register({
  name: "TEXT",
  handler: textHandler,
  minArgs: 2,
  maxArgs: 2,
  description: "Formats a number and converts it to text",
  examples: ['TEXT(1234.5, "$#,##0.00")', 'TEXT(0.5, "0%")'],
  category: "Text",
});

functionRegistry.register({
  name: "VALUE",
  handler: valueHandler,
  minArgs: 1,
  maxArgs: 1,
  description: "Converts a text string to a number",
  examples: ['VALUE("123")', 'VALUE("$1,234.56")'],
  category: "Text",
});

functionRegistry.register({
  name: "EXACT",
  handler: exactHandler,
  minArgs: 2,
  maxArgs: 2,
  description: "Checks if two text strings are exactly the same",
  examples: ['EXACT("Hello", "hello")', "EXACT(A1, B1)"],
  category: "Text",
});
