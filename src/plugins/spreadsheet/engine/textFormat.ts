/**
 * Excel number-format patterns for the TEXT function.
 *
 * Deliberately separate from `formatter.formatNumber`, which renders CELL
 * display values: the two disagree on defaults — Excel's `TEXT(0.5,"0%")` is
 * `"50%"`, while a cell carrying the format `0%` has always displayed
 * `"50.00%"` — so sharing the whole path would move every formatted cell in
 * every stored workbook. Only the digit-grouping primitive is shared.
 */

import { groupThousands } from "./formatter";

const PERCENT_SCALE = 100;

// Characters that introduce an Excel format feature this module does not
// render (quoted literals, fill/skip, fractions, dates, text placeholder,
// negative/zero sections). Seeing one means the caller keeps its own fallback.
const UNSUPPORTED_LITERAL_CHARS = `?\\*_[]"@;/`;

// One run of digit placeholders, optionally carrying grouping commas and a
// decimal point: the `#,##0.00` family.
const NUMERIC_CORE_RE = /[#0][#0,.]*/;
const PLACEHOLDER_RE = /[#0]/;
const TRAILING_ZEROS_RE = /0+$/;

export interface NumberPattern {
  prefix: string;
  suffix: string;
  useGrouping: boolean;
  integerMinDigits: number;
  minDecimals: number;
  maxDecimals: number;
  isPercent: boolean;
}

const countOf = (text: string, chars: string): number => Array.from(text).filter((char) => chars.includes(char)).length;

const hasUnsupportedLiteral = (text: string): boolean => Array.from(text).some((char) => UNSUPPORTED_LITERAL_CHARS.includes(char));

/**
 * Split a format code into a leading literal, one numeric core and a trailing
 * literal, or `null` when the code uses a feature this module does not render.
 */
export const parseNumberPattern = (pattern: string): NumberPattern | null => {
  const core = NUMERIC_CORE_RE.exec(pattern);
  if (!core) return null;
  // A comma AFTER the last placeholder scales by a thousand in Excel.
  if (core[0].endsWith(",")) return null;

  const prefix = pattern.slice(0, core.index);
  const suffix = pattern.slice(core.index + core[0].length);
  // A second placeholder run (`0.00E+00`, `# ?/?`) is a format of its own kind.
  if (PLACEHOLDER_RE.test(suffix)) return null;
  if (hasUnsupportedLiteral(prefix) || hasUnsupportedLiteral(suffix)) return null;

  const [integerPart, decimalPart = "", ...extraParts] = core[0].split(".");
  if (extraParts.length > 0) return null;

  return {
    prefix,
    suffix,
    useGrouping: integerPart.includes(","),
    integerMinDigits: countOf(integerPart, "0"),
    minDecimals: countOf(decimalPart, "0"),
    maxDecimals: countOf(decimalPart, "#0"),
    isPercent: prefix.includes("%") || suffix.includes("%"),
  };
};

// `0` keeps a decimal digit, `#` drops it once it is a trailing zero — so
// `0.0#` renders 0.5 as "0.5" but 0.25 as "0.25".
const trimOptionalZeros = (decimals: string, minDecimals: number): string => {
  const kept = decimals.replace(TRAILING_ZEROS_RE, "");
  return kept.length >= minDecimals ? kept : decimals.slice(0, minDecimals);
};

const renderDigits = (absValue: number, pattern: NumberPattern): string => {
  const [wholeDigits, decimalDigits = ""] = absValue.toFixed(pattern.maxDecimals).split(".");
  const padded = wholeDigits.padStart(pattern.integerMinDigits, "0");
  const whole = pattern.useGrouping ? groupThousands(padded) : padded;
  const decimals = trimOptionalZeros(decimalDigits, pattern.minDecimals);
  return decimals ? `${whole}.${decimals}` : whole;
};

const isZeroText = (digits: string): boolean => Array.from(digits).every((char) => char === "0" || char === "," || char === ".");

/**
 * Render a number the way Excel's TEXT does for the common numeric format
 * codes: `#,##0` grouping, `0.00` fixed decimals, `0.##` optional decimals, a
 * literal prefix/suffix such as `$`, and a `%` that scales by 100.
 *
 * Returns `null` for a format code it does not render, so the caller can keep
 * its own fallback rather than inventing a plausible wrong string.
 */
export const formatWithPattern = (value: number, pattern: string): string | null => {
  if (!Number.isFinite(value)) return null;
  const spec = parseNumberPattern(pattern);
  if (!spec) return null;

  const scaled = spec.isPercent ? value * PERCENT_SCALE : value;
  const digits = renderDigits(Math.abs(scaled), spec);
  // The sign follows the ROUNDED digits: -0.001 under "0.00" reads "0.00", not "-0.00".
  const sign = scaled < 0 && !isZeroText(digits) ? "-" : "";
  return `${sign}${spec.prefix}${digits}${spec.suffix}`;
};
