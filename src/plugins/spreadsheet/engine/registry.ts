/**
 * Spreadsheet Function Registry
 *
 * This module provides a registry system for spreadsheet functions,
 * allowing modular organization and easy extension of formula capabilities.
 */

import type { CellValue } from "./types";
import { parseNumericString } from "./numericCoercion";
export type { CellValue };
export type CellGetter = (ref: string) => CellValue;
export type RangeGetter = (range: string) => CellValue[];
export type RawRangeGetter = (range: string) => CellValue[];

export interface FunctionContext {
  getCellValue: CellGetter;
  getRangeValues: RangeGetter;
  getRangeValuesRaw?: RawRangeGetter;
  evaluateFormula: (formula: string) => CellValue;
}

export type FunctionHandler = (args: string[], context: FunctionContext) => CellValue;

export interface FunctionDefinition {
  name: string;
  handler: FunctionHandler;
  minArgs?: number;
  maxArgs?: number;
  description?: string;
  examples?: string[];
  category?: string;
}

class FunctionRegistry {
  private functions = new Map<string, FunctionDefinition>();

  register(def: FunctionDefinition): void {
    this.functions.set(def.name.toUpperCase(), def);
  }

  get(name: string): FunctionDefinition | undefined {
    return this.functions.get(name.toUpperCase());
  }

  hasFunction(name: string): boolean {
    return this.functions.has(name.toUpperCase());
  }

  getAllFunctions(): FunctionDefinition[] {
    return Array.from(this.functions.values());
  }

  getFunctionsByCategory(): Map<string, FunctionDefinition[]> {
    const categories = new Map<string, FunctionDefinition[]>();

    for (const func of Array.from(this.functions.values())) {
      const category = func.category || "Other";
      if (!categories.has(category)) {
        categories.set(category, []);
      }
      categories.get(category)!.push(func);
    }

    return categories;
  }
}

export const functionRegistry = new FunctionRegistry();

/**
 * Lenient numeric coercion for range aggregation: anything unreadable is 0.
 * PINNED behaviour (booleans are 0, not Excel's 1/0) — the string parsing lives
 * in numericCoercion.parseNumericString, shared with the strict scalar read.
 */
export function toNumber(value: CellValue): number {
  if (typeof value === "number") return value;
  return parseNumericString(String(value)) ?? 0;
}

/**
 * Helper function to convert a value to a string
 */
export function toString(value: CellValue): string {
  return String(value);
}

const REGEXP_METACHARACTERS = /[.*+?^${}()|[\]\\]/;

const escapeRegExpChar = (char: string): string => (REGEXP_METACHARACTERS.test(char) ? `\\${char}` : char);

/**
 * Match text the way a spreadsheet criteria does: case-insensitively, with `*`
 * standing for any run of characters, `?` for exactly one, and `~` escaping the
 * next character. A plain `String(v) === criteria` missed both — `COUNTIF(range,
 * "yes")` skipped a cell holding `Yes`, and `"A*"` was compared literally.
 */
function textMatcher(pattern: string): (text: string) => boolean {
  const source: string[] = [];
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === "~" && index + 1 < pattern.length) {
      source.push(escapeRegExpChar(pattern[index + 1]));
      index++;
    } else if (char === "*") {
      source.push(".*");
    } else if (char === "?") {
      source.push(".");
    } else {
      source.push(escapeRegExpChar(char));
    }
  }
  const regex = new RegExp(`^${source.join("")}$`, "iu");
  return (text) => regex.test(text);
}

/**
 * Helper to parse criteria for conditional functions like COUNTIF, SUMIF
 * Returns a comparison function that tests if a value matches the criteria
 */
export function parseCriteria(criteria: string): (value: CellValue) => boolean {
  // eslint-disable -- sonarjs/anchor-precedence
  const trimmedCriteria = criteria.trim().replace(/^["']|["']$/g, "");

  // Check for comparison operators
  // eslint-disable -- sonarjs/slow-regex
  const opMatch = trimmedCriteria.match(/^([><=!]+)(.+)$/);
  if (opMatch) {
    const [, op, value] = opMatch;
    const numValue = parseFloat(value);

    // `=` / `<>` compare like the bare criteria does — case-insensitive text
    // with wildcards, or the number. `<>` is exactly its negation.
    const equals = matchesTextOrNumber(value);
    switch (op) {
      case ">":
        return (v) => toNumber(v) > numValue;
      case ">=":
        return (v) => toNumber(v) >= numValue;
      case "<":
        return (v) => toNumber(v) < numValue;
      case "<=":
        return (v) => toNumber(v) <= numValue;
      case "=":
      case "==":
        return equals;
      case "!=":
      case "<>":
        return (v) => !equals(v);
      default:
        return () => false;
    }
  }

  return matchesTextOrNumber(trimmedCriteria);
}

/** A value matches when its text matches the criteria (case-insensitively, with
 *  wildcards) or, for a numeric criteria, when its number is equal. */
function matchesTextOrNumber(criteria: string): (value: CellValue) => boolean {
  const matchesText = textMatcher(criteria);
  const numCriteria = parseFloat(criteria);
  const hasNumber = !isNaN(numCriteria);
  return (value) => matchesText(String(value)) || (hasNumber && toNumber(value) === numCriteria);
}
