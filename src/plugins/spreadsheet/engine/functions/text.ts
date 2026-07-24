/**
 * Text Functions
 */

import { functionRegistry, toString, type FunctionHandler } from "../registry";
import { VALUE_ERROR, isSpreadsheetErrorValue, type SpreadsheetError } from "../spreadsheet-errors";
import { formatWithPattern } from "../textFormat";

// A letter or a combining mark. A decomposed accented letter (e + U+0301) is two
// code points; counting the mark as part of the word stops PROPER from treating
// the base letter that follows it as a new word (éclair → Éclair, not ÉClair).
const isWordCharacter = (char: string): boolean => /[\p{L}\p{M}]/u.test(char);

// Excel PROPER capitalises a letter at the start of the text or after any
// non-letter (space, punctuation, digit) and lowercases the rest — so word
// boundaries include "'" and "-", which a space-only split misses.
export const toProperCase = (text: string): string => {
  const chars = Array.from(text);
  const cased = chars.map((char, index) => (index === 0 || !isWordCharacter(chars[index - 1]) ? char.toUpperCase() : char.toLowerCase()));
  return cased.join("");
};

// Excel LEFT/RIGHT reject a negative count with #VALUE!; 0 and over-length
// counts keep substring's clamping.
// Excel truncates a fractional count toward zero and rejects a non-finite or
// negative one with #VALUE! (LEFT/RIGHT with "x" or -1). Normalising once keeps
// LEFT and RIGHT consistent instead of each feeding a raw Number() to substring.
const normalizeCharCount = (count: number): number | SpreadsheetError => {
  // Test the sign before truncating: Math.trunc(-0.5) is -0, which is not < 0.
  if (!Number.isFinite(count) || count < 0) return VALUE_ERROR;
  return Math.trunc(count);
};

export const takeLeft = (text: string, count: number): string | SpreadsheetError => {
  const chars = normalizeCharCount(count);
  return isSpreadsheetErrorValue(chars) ? chars : text.substring(0, chars);
};

export const takeRight = (text: string, count: number): string | SpreadsheetError => {
  const chars = normalizeCharCount(count);
  return isSpreadsheetErrorValue(chars) ? chars : text.substring(text.length - chars);
};

// Replace the nth (1-based) occurrence; split/join keeps matches non-overlapping,
// matching the replace-all path.
const replaceNthOccurrence = (text: string, oldText: string, newText: string, nth: number): string => {
  const parts = text.split(oldText);
  if (nth > parts.length - 1) return text;
  return parts.slice(0, nth).join(oldText) + newText + parts.slice(nth).join(oldText);
};

// Excel SUBSTITUTE: empty old_text returns the text unchanged (never inserts
// between characters); a supplied instance ≤ 0 or non-finite is a #VALUE! error.
export const substituteText = (text: string, oldText: string, newText: string, instance?: number): string | SpreadsheetError => {
  if (oldText === "") return text;
  if (instance === undefined) return text.split(oldText).join(newText);
  const nth = Math.trunc(instance);
  if (!Number.isFinite(nth) || nth <= 0) return VALUE_ERROR;
  return replaceNthOccurrence(text, oldText, newText, nth);
};

const concatenateHandler: FunctionHandler = (args, context) => {
  return args
    .map((arg) => {
      const value = context.evaluateFormula(arg.trim());
      return toString(value);
    })
    .join("");
};

const concatHandler: FunctionHandler = concatenateHandler; // Alias

const leftHandler: FunctionHandler = (args, context) => {
  const text = toString(context.evaluateFormula(args[0]));
  const numChars = args.length === 2 ? Number(context.evaluateFormula(args[1])) : 1;

  return takeLeft(text, numChars);
};

const rightHandler: FunctionHandler = (args, context) => {
  const text = toString(context.evaluateFormula(args[0]));
  const numChars = args.length === 2 ? Number(context.evaluateFormula(args[1])) : 1;

  return takeRight(text, numChars);
};

/** Excel MID: 1-based start, count of characters. `substring` SWAPS its bounds
 *  when they are reversed, so a negative count read backwards from `start` and
 *  returned earlier characters — `MID("Hello",3,-1)` gave "e" instead of an
 *  error. Both arguments are validated here instead. */
export const takeMid = (text: string, start: number, count: number): string | SpreadsheetError => {
  const chars = normalizeCharCount(count);
  if (isSpreadsheetErrorValue(chars)) return chars;
  if (!Number.isFinite(start) || start < 1) return VALUE_ERROR;
  const from = Math.trunc(start) - 1;
  return text.substring(from, from + chars);
};

const midHandler: FunctionHandler = (args, context) => {
  const text = toString(context.evaluateFormula(args[0]));
  const start = Number(context.evaluateFormula(args[1]));
  const numChars = Number(context.evaluateFormula(args[2]));

  return takeMid(text, start, numChars);
};

const lenHandler: FunctionHandler = (args, context) => {
  const text = toString(context.evaluateFormula(args[0]));
  return text.length;
};

const upperHandler: FunctionHandler = (args, context) => {
  const text = toString(context.evaluateFormula(args[0]));
  return text.toUpperCase();
};

const lowerHandler: FunctionHandler = (args, context) => {
  const text = toString(context.evaluateFormula(args[0]));
  return text.toLowerCase();
};

const properHandler: FunctionHandler = (args, context) => {
  const text = toString(context.evaluateFormula(args[0]));
  return toProperCase(text);
};

const trimHandler: FunctionHandler = (args, context) => {
  const text = toString(context.evaluateFormula(args[0]));
  // Trim leading/trailing spaces and replace multiple spaces with single space
  return text.trim().replace(/\s+/g, " ");
};

const substituteHandler: FunctionHandler = (args, context) => {
  const text = toString(context.evaluateFormula(args[0]));
  const oldText = toString(context.evaluateFormula(args[1]));
  const newText = toString(context.evaluateFormula(args[2]));
  const instance = args.length === 4 ? Number(context.evaluateFormula(args[3])) : undefined;

  return substituteText(text, oldText, newText, instance);
};

const replaceHandler: FunctionHandler = (args, context) => {
  const oldText = toString(context.evaluateFormula(args[0]));
  const startPos = Number(context.evaluateFormula(args[1])) - 1; // 1-indexed to 0-indexed
  const numChars = Number(context.evaluateFormula(args[2]));
  const newText = toString(context.evaluateFormula(args[3]));

  return oldText.substring(0, startPos) + newText + oldText.substring(startPos + numChars);
};

const findHandler: FunctionHandler = (args, context) => {
  const findText = toString(context.evaluateFormula(args[0]));
  const withinText = toString(context.evaluateFormula(args[1]));
  const startPos = args.length === 3 ? Number(context.evaluateFormula(args[2])) - 1 : 0;

  const index = withinText.indexOf(findText, startPos);
  return index === -1 ? VALUE_ERROR : index + 1; // Return 1-indexed position
};

const searchHandler: FunctionHandler = (args, context) => {
  const findText = toString(context.evaluateFormula(args[0]));
  const withinText = toString(context.evaluateFormula(args[1]));
  const startPos = args.length === 3 ? Number(context.evaluateFormula(args[2])) - 1 : 0;

  // SEARCH is case-insensitive
  const lowerFind = findText.toLowerCase();
  const lowerWithin = withinText.toLowerCase();

  const index = lowerWithin.indexOf(lowerFind, startPos);
  return index === -1 ? VALUE_ERROR : index + 1; // Return 1-indexed position
};

// A format code written as a literal still carries its quotes when it reaches
// the handler.
const stripSurroundingQuotes = (text: string): string => text.replace(/^["']/, "").replace(/["']$/, "");

const textHandler: FunctionHandler = (args, context) => {
  const value = context.evaluateFormula(args[0]);
  const format = stripSurroundingQuotes(toString(context.evaluateFormula(args[1])));
  if (typeof value !== "number") return toString(value);
  return formatWithPattern(value, format) ?? toString(value);
};

/** Read a numeric string in full, or null. `Number` rather than `parseFloat`:
 *  `parseFloat` stops at the first character it cannot read, so `VALUE("12abc")`
 *  came back 12 where Excel reports #VALUE!. An empty string is not a number
 *  here even though `Number("")` is 0. */
// Decimal or scientific notation only. `Number` alone also accepts JS-only
// spellings a spreadsheet never should — `0x10` → 16, `0b10` → 2, `Infinity` —
// so the shape is checked before converting.
const DECIMAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

const wholeNumberOrNull = (text: string): number | null => {
  if (!DECIMAL_NUMBER.test(text)) return null;
  const parsed = Number(text);
  // The pattern admits an exponent that overflows to Infinity (`1e999`), which
  // is no more a spreadsheet number than the literal spelling is.
  return Number.isFinite(parsed) ? parsed : null;
};

/** Excel VALUE: the WHOLE string must be a number once its currency symbols and
 *  thousands separators are stripped; trailing text is an error, not a prefix to
 *  salvage. */
export const parseValueText = (raw: string): number | SpreadsheetError => {
  const cleaned = raw.replace(/[$,]/g, "").trim();
  if (cleaned.endsWith("%")) {
    const percent = wholeNumberOrNull(cleaned.slice(0, -1).trim());
    return percent === null ? VALUE_ERROR : percent / 100;
  }
  const parsed = wholeNumberOrNull(cleaned);
  return parsed === null ? VALUE_ERROR : parsed;
};

const valueHandler: FunctionHandler = (args, context) => {
  return parseValueText(toString(context.evaluateFormula(args[0])));
};

const exactHandler: FunctionHandler = (args, context) => {
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
  description: "Joins several text strings into one string (same as CONCATENATE)",
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
  examples: ['SUBSTITUTE("Hello World", "World", "Earth")', 'SUBSTITUTE(A1, "old", "new", 1)'],
  category: "Text",
});

functionRegistry.register({
  name: "REPLACE",
  handler: replaceHandler,
  minArgs: 4,
  maxArgs: 4,
  description: "Replaces part of a text string with a different text string",
  examples: ['REPLACE("Hello World", 7, 5, "Earth")', 'REPLACE(A1, 1, 3, "New")'],
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
