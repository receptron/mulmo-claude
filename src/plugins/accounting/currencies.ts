// Currency utilities for the accounting plugin.
//
// We expose a curated list of ISO 4217 codes for the New Book
// dropdown — covering the major reserve currencies plus the most
// requested Asian / regional ones — plus per-currency formatting
// helpers built on Intl.NumberFormat.
//
// The book's currency is per-book metadata (BookSummary.currency)
// and only matters once the user has opened the book; cross-book
// aggregation isn't supported.

/** ISO 4217 codes shown in the New Book dropdown. Curated for
 *  recognisability — Intl.DisplayNames provides the localised
 *  human name at render time, so this stays a flat list of codes. */
export const SUPPORTED_CURRENCY_CODES = ["USD", "EUR", "JPY", "GBP", "CNY", "KRW", "TWD", "HKD", "SGD", "AUD", "CAD", "CHF", "INR", "BRL", "MXN"] as const;

export type SupportedCurrencyCode = (typeof SUPPORTED_CURRENCY_CODES)[number];

const DEFAULT_FALLBACK_DIGITS = 2;

/** Localised human name for a currency code. Falls back to the
 *  code itself if the runtime can't resolve the name. */
export function localizedCurrencyName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Number of fraction digits ISO 4217 specifies for a currency.
 *  JPY = 0, USD = 2, KWD = 3. Used both for amount formatting and
 *  for the HTML input step on debit/credit fields. */
export function fractionDigitsFor(currency: string): number {
  try {
    const opts = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions();
    return opts.maximumFractionDigits ?? DEFAULT_FALLBACK_DIGITS;
  } catch {
    return DEFAULT_FALLBACK_DIGITS;
  }
}

/** "1" for JPY, "0.01" for USD, "0.001" for KWD. Used as the HTML
 *  input step on debit/credit fields so a JPY book doesn't let the
 *  user type cents that would just round-trip back through the
 *  decimal validator. */
export function inputStepFor(currency: string): string {
  const digits = fractionDigitsFor(currency);
  if (digits === 0) return "1";
  return (1 / 10 ** digits).toFixed(digits);
}

/** Locale-aware currency formatter — returns "¥1,130" / "$1,130.00"
 *  etc. Falls back to fixed-point formatting if the runtime can't
 *  resolve the currency code; the fallback still respects the
 *  currency's natural fraction-digit count so JPY shows whole
 *  numbers even on the slow path. */
export function formatAmount(value: number, currency: string, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(value);
  } catch {
    return value.toFixed(fractionDigitsFor(currency));
  }
}
