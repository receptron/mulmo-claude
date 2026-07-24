/**
 * Rounding, modulo and significance math for the mathematical functions.
 *
 * Pure number-in / (number | formula-error-value)-out helpers. The rounding
 * direction and the domain rules are exactly where the engine diverged from
 * Excel (rounding toward +∞ instead of away from zero, modulo taking the
 * dividend's sign, negative bases and domains slipping through as NaN/∞), so
 * they are worth testing apart from the argument-reading handlers.
 */

import { DIV_ZERO_ERROR, NUM_ERROR, isSpreadsheetErrorValue, type SpreadsheetError } from "./spreadsheet-errors";

const DECIMAL_BASE = 10;

const scale = (digits: number): number => Math.pow(DECIMAL_BASE, digits);

/** Excel ROUND: half away from zero (JS `Math.round` breaks half toward +∞, so
 *  `ROUND(-2.5, 0)` came back -2 instead of -3). */
export function roundTo(value: number, digits: number): number {
  const factor = scale(digits);
  return (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor;
}

/** Excel ROUNDUP: away from zero. */
export function roundUpTo(value: number, digits: number): number {
  const factor = scale(digits);
  return (Math.sign(value) * Math.ceil(Math.abs(value) * factor)) / factor;
}

/** Excel ROUNDDOWN: toward zero. */
export function roundDownTo(value: number, digits: number): number {
  const factor = scale(digits);
  return (Math.sign(value) * Math.floor(Math.abs(value) * factor)) / factor;
}

/** Whether `value` and `significance` point the same way; opposite signs are the
 *  #NUM! case for FLOOR / CEILING. A zero value is always in range. */
const sameSign = (value: number, significance: number): boolean => value === 0 || Math.sign(value) === Math.sign(significance);

/** Excel FLOOR: nearest multiple of `significance` toward zero; opposite signs
 *  are #NUM!, and a zero significance is #DIV/0! — the division by the
 *  significance is what FLOOR reports, so it wins over the sign check. */
export function floorToSignificance(value: number, significance: number): number | SpreadsheetError {
  if (significance === 0) return DIV_ZERO_ERROR;
  if (!sameSign(value, significance)) return NUM_ERROR;
  return Math.floor(value / significance) * significance;
}

/** Excel CEILING: nearest multiple of `significance` away from zero; opposite
 *  signs are #NUM!, and a zero significance is 0 — deliberately NOT FLOOR's
 *  #DIV/0!, an asymmetry Excel keeps and this engine has to match. */
export function ceilingToSignificance(value: number, significance: number): number | SpreadsheetError {
  if (significance === 0) return 0;
  if (!sameSign(value, significance)) return NUM_ERROR;
  return Math.ceil(value / significance) * significance;
}

/** Excel MOD: result takes the divisor's sign (`MOD(-3, 2) === 1`); dividing by
 *  zero is #DIV/0!, not a silent 0. */
export function modulo(value: number, divisor: number): number | SpreadsheetError {
  if (divisor === 0) return DIV_ZERO_ERROR;
  return value - divisor * Math.floor(value / divisor);
}

/** Excel POWER: a negative base with a non-integer exponent has no real root, so
 *  it is #NUM! rather than JS's NaN. */
export function power(base: number, exponent: number): number | SpreadsheetError {
  if (base < 0 && !Number.isInteger(exponent)) return NUM_ERROR;
  return Math.pow(base, exponent);
}

/** Natural log guarded to its domain: `LN(x)` for `x <= 0` is #NUM!, not
 *  -∞ / NaN. Reused by LN and LOG. */
export function safeLog(value: number): number | SpreadsheetError {
  if (value <= 0) return NUM_ERROR;
  return Math.log(value);
}

/** Excel LOG(value, base): the base must also be positive and not 1, or the
 *  result is #NUM! rather than the ∞ / NaN a bare division would give. */
export function logWithBase(value: number, base: number): number | SpreadsheetError {
  const lnValue = safeLog(value);
  if (isSpreadsheetErrorValue(lnValue)) return lnValue;
  if (base <= 0 || base === 1) return NUM_ERROR;
  return lnValue / Math.log(base);
}

/** Base-10 log guarded to its domain (`LOG10(x)` for `x <= 0` is #NUM!). */
export function safeLog10(value: number): number | SpreadsheetError {
  if (value <= 0) return NUM_ERROR;
  return Math.log10(value);
}

/** Square root guarded to its domain (`SQRT(x)` for `x < 0` is #NUM!, not NaN). */
export function safeSqrt(value: number): number | SpreadsheetError {
  if (value < 0) return NUM_ERROR;
  return Math.sqrt(value);
}
