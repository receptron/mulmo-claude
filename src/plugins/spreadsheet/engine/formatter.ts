/**
 * Number Formatting Utilities
 *
 * Handles Excel-style format codes for currency, percentages, decimals, dates, etc.
 */

import { serialToDate, MONTH_NAMES_SHORT, MONTH_NAMES_FULL, DAY_NAMES_SHORT, DAY_NAMES_FULL } from "./date-utils";

/**
 * Check if a format code is for dates
 */
function isDateFormat(format: string): boolean {
  // Date formats contain date/time tokens: Y, M, D, h, m, s
  // But not percentage (which also has 'm' in format like #,##0)
  // Look for specific date patterns
  return /[YMD]|MMM|DD|YYYY|h:mm|AM\/PM/i.test(format);
}

/**
 * Format a number as a date according to Excel format code
 *
 * Supported formats:
 * - MM/DD/YYYY, M/D/YYYY
 * - DD/MM/YYYY, D/M/YYYY
 * - YYYY-MM-DD
 * - DD-MMM-YYYY, D-MMM-YYYY
 * - MMM D, YYYY, MMMM D, YYYY
 * - h:mm AM/PM, HH:mm:ss
 *
 * @param serial - Excel serial number
 * @param format - Date format code
 * @returns Formatted date string
 */
// Every token, longest-first within each family so `MMMM` wins over `MMM` and
// `MM`. Matched in ONE pass: a sequence of `replace` calls re-scans its own
// output, so an inserted "March" had its `M` rewritten by the later month-number
// step and "AM/PM" was destroyed before the meridiem branch could see it.
const DATE_TOKEN_RE = /YYYY|YY|MMMM|MMM|MM|M|dddd|ddd|DD|D|AM\/PM|am\/pm|HH|H|hh|h|mm|ss/g;

function formatDate(serial: number, format: string): string {
  const date = serialToDate(serial);

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-11
  const day = date.getUTCDate();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = date.getUTCSeconds();
  const dayOfWeek = date.getUTCDay(); // 0-6

  // `h` means the 12-hour clock only when the format also asks for a meridiem;
  // decided from the ORIGINAL format, before any substitution.
  const uses12Hour = /AM\/PM|am\/pm/.test(format);
  const hours12 = hours % 12 || 12; // 0 becomes 12
  const isPM = hours >= 12;

  const replacements: Record<string, string> = {
    YYYY: year.toString(),
    YY: (year % 100).toString().padStart(2, "0"),
    MMMM: MONTH_NAMES_FULL[month] ?? MONTH_NAMES_FULL[0],
    MMM: MONTH_NAMES_SHORT[month] ?? MONTH_NAMES_SHORT[0],
    MM: (month + 1).toString().padStart(2, "0"),
    M: (month + 1).toString(),
    dddd: DAY_NAMES_FULL[dayOfWeek] ?? DAY_NAMES_FULL[0],
    ddd: DAY_NAMES_SHORT[dayOfWeek] ?? DAY_NAMES_SHORT[0],
    DD: day.toString().padStart(2, "0"),
    D: day.toString(),
    "AM/PM": isPM ? "PM" : "AM",
    "am/pm": isPM ? "pm" : "am",
    HH: hours.toString().padStart(2, "0"),
    H: hours.toString(),
    hh: (uses12Hour ? hours12 : hours).toString().padStart(2, "0"),
    h: (uses12Hour ? hours12 : hours).toString(),
    mm: minutes.toString().padStart(2, "0"),
    ss: seconds.toString().padStart(2, "0"),
  };

  return format.replace(DATE_TOKEN_RE, (token) => replacements[token] ?? token);
}

const THOUSANDS_GROUP_SIZE = 3;

/**
 * Insert thousands separators into a run of digits ("1234567" → "1,234,567").
 * Regex free on purpose: the classic `\B(?=(\d{3})+(?!\d))` lookahead
 * backtracks badly on a long run of digits.
 */
export const groupThousands = (digits: string): string =>
  Array.from(digits).reduce((grouped, digit, index) => {
    const needsSeparator = index > 0 && (digits.length - index) % THOUSANDS_GROUP_SIZE === 0;
    return needsSeparator ? `${grouped},${digit}` : `${grouped}${digit}`;
  }, "");

/**
 * Format a number according to Excel format code
 *
 * Supported formats:
 * - Currency: $#,##0.00, $#,##0
 * - Percentage: 0.00%, 0.0%
 * - Integer with commas: #,##0
 * - Decimal: 0.00, 0.000
 * - Dates: MM/DD/YYYY, DD-MMM-YYYY, etc.
 *
 * @param value - The numeric value to format
 * @param format - The Excel format code
 * @returns Formatted string representation
 */
export function formatNumber(value: number, format: string): string {
  if (!format) return value.toString();

  try {
    // Check if it's a date format
    if (isDateFormat(format)) {
      return formatDate(value, format);
    }

    // Handle currency formats
    if (format.includes("$")) {
      const decimals = (format.match(/\.0+/) || [""])[0].length - 1;
      const hasComma = format.includes(",");

      let formatted = Math.abs(value).toFixed(decimals >= 0 ? decimals : 0);
      if (hasComma) {
        const parts = formatted.split(".");
        parts[0] = groupThousands(parts[0]);
        formatted = parts.join(".");
      }
      formatted = "$" + formatted;
      if (value < 0) formatted = "-" + formatted;
      return formatted;
    }

    // Handle percentage
    if (format.includes("%")) {
      const decimals = (format.match(/\.0+/) || [""])[0].length - 1;
      return (value * 100).toFixed(decimals >= 0 ? decimals : 2) + "%";
    }

    // Handle comma separator
    if (format.includes(",")) {
      const decimals = (format.match(/\.0+/) || [""])[0].length - 1;
      let formatted = Math.abs(value).toFixed(decimals >= 0 ? decimals : 0);
      const parts = formatted.split(".");
      parts[0] = groupThousands(parts[0]);
      formatted = parts.join(".");
      if (value < 0) formatted = "-" + formatted;
      return formatted;
    }

    // Handle decimal places
    const decimals = (format.match(/\.0+/) || [""])[0].length - 1;
    if (decimals >= 0) {
      return value.toFixed(decimals);
    }

    return value.toString();
  } catch (error) {
    console.error("Format error:", error);
    return value.toString();
  }
}
