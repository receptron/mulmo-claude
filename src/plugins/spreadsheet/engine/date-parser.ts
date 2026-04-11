/**
 * Date Parsing Utilities
 *
 * Parse various date string formats into Excel serial numbers.
 */

import {
  dateToSerial,
  MONTH_NAMES_SHORT,
  MONTH_NAMES_FULL,
} from "./date-utils";

/**
 * Check if a string looks like a date
 *
 * @param str - String to check
 * @returns true if string matches common date patterns
 */
export function isDateLike(str: string): boolean {
  if (typeof str !== "string") return false;
  if (str.length < 6 || str.length > 30) return false; // Reasonable length for dates

  // Common date patterns:
  // MM/DD/YYYY, DD/MM/YYYY, M/D/YYYY
  // YYYY-MM-DD, YYYY/MM/DD
  // DD-MMM-YYYY, D-MMM-YYYY
  // MMM D, YYYY, MMMM D, YYYY

  // Pattern 1: Contains digits and separators (/, -, space)
  const hasDigits = /\d/.test(str);
  const hasSeparator = /[/\-\s,]/.test(str);

  if (!hasDigits || !hasSeparator) return false;

  // Pattern 2: Matches common date formats
  const datePatterns = [
    /^\d{1,2}\/\d{1,2}\/\d{2,4}$/, // MM/DD/YYYY or DD/MM/YYYY
    /^\d{4}-\d{1,2}-\d{1,2}$/, // YYYY-MM-DD
    /^\d{4}\/\d{1,2}\/\d{1,2}$/, // YYYY/MM/DD
    /^\d{1,2}-[A-Za-z]{3}-\d{2,4}$/, // DD-MMM-YYYY
    /^[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}$/, // MMM D, YYYY or MMMM D, YYYY
    /^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}$/, // D MMM YYYY
  ];

  return datePatterns.some((pattern) => pattern.test(str.trim()));
}

/**
 * Parse a month name to month number (1-12)
 */
function parseMonthName(monthStr: string): number | null {
  const month = monthStr.toLowerCase();

  // Try short names
  const shortIndex = MONTH_NAMES_SHORT.findIndex(
    (m) => m.toLowerCase() === month,
  );
  if (shortIndex !== -1) return shortIndex + 1;

  // Try full names
  const fullIndex = MONTH_NAMES_FULL.findIndex(
    (m) => m.toLowerCase() === month,
  );
  if (fullIndex !== -1) return fullIndex + 1;

  return null;
}

/**
 * Parse a date string into Excel serial number
 *
 * Supports formats:
 * - MM/DD/YYYY, M/D/YYYY
 * - DD/MM/YYYY (when day > 12)
 * - YYYY-MM-DD, YYYY/MM/DD (ISO format)
 * - DD-MMM-YYYY, D-MMM-YYYY
 * - MMM D, YYYY, MMMM D, YYYY
 *
 * @param dateStr - String that might contain a date
 * @param preferDDMMYYYY - Prefer DD/MM/YYYY over MM/DD/YYYY for ambiguous dates (default: false)
 * @returns Serial number or null if not a valid date
 */
export function parseDate(
  dateStr: string,
  preferDDMMYYYY: boolean = false,
): number | null {
  if (!isDateLike(dateStr)) return null;

  const trimmed = dateStr.trim();

  // Try YYYY-MM-DD or YYYY/MM/DD (ISO format)
  const isoMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1]);
    const month = parseInt(isoMatch[2]);
    const day = parseInt(isoMatch[3]);

    if (isValidDate(year, month, day)) {
      const date = new Date(Date.UTC(year, month - 1, day));
      return dateToSerial(date);
    }
    return null;
  }

  // Try DD-MMM-YYYY or D-MMM-YYYY
  const dmmyMatch = trimmed.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (dmmyMatch) {
    const day = parseInt(dmmyMatch[1]);
    const monthName = dmmyMatch[2];
    let year = parseInt(dmmyMatch[3]);

    // Handle 2-digit years
    if (year < 100) {
      year = year < 30 ? 2000 + year : 1900 + year;
    }

    const month = parseMonthName(monthName);
    if (month && isValidDate(year, month, day)) {
      const date = new Date(Date.UTC(year, month - 1, day));
      return dateToSerial(date);
    }
    return null;
  }

  // Try MMM D, YYYY or MMMM D, YYYY
  const mmmMatch = trimmed.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (mmmMatch) {
    const monthName = mmmMatch[1];
    const day = parseInt(mmmMatch[2]);
    const year = parseInt(mmmMatch[3]);

    const month = parseMonthName(monthName);
    if (month && isValidDate(year, month, day)) {
      const date = new Date(Date.UTC(year, month - 1, day));
      return dateToSerial(date);
    }
    return null;
  }

  // Try D MMM YYYY
  const dMmmMatch = trimmed.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (dMmmMatch) {
    const day = parseInt(dMmmMatch[1]);
    const monthName = dMmmMatch[2];
    const year = parseInt(dMmmMatch[3]);

    const month = parseMonthName(monthName);
    if (month && isValidDate(year, month, day)) {
      const date = new Date(Date.UTC(year, month - 1, day));
      return dateToSerial(date);
    }
    return null;
  }

  // Try MM/DD/YYYY or DD/MM/YYYY
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const first = parseInt(slashMatch[1]);
    const second = parseInt(slashMatch[2]);
    let year = parseInt(slashMatch[3]);

    // Handle 2-digit years
    if (year < 100) {
      year = year < 30 ? 2000 + year : 1900 + year;
    }

    // Determine if it's MM/DD/YYYY or DD/MM/YYYY
    // If first > 12, it must be DD/MM; if second > 12, it must be MM/DD
    // Otherwise use preference (default to MM/DD for US format)
    const isDayFirst =
      first > 12 || (second <= 12 && first <= 12 && preferDDMMYYYY);
    const month = isDayFirst ? second : first;
    const day = isDayFirst ? first : second;

    if (isValidDate(year, month, day)) {
      const date = new Date(Date.UTC(year, month - 1, day));
      return dateToSerial(date);
    }
    return null;
  }

  return null;
}

/**
 * Validate that a date is valid
 */
function isValidDate(year: number, month: number, day: number): boolean {
  // Check basic ranges
  if (year < 1900 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  // Check if day is valid for the given month
  const date = new Date(Date.UTC(year, month - 1, day));

  // If the date rolls over to the next month, it's invalid
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Get default date format based on parsed date
 *
 * @param originalStr - Original date string
 * @returns Appropriate format code
 */
export function getDefaultDateFormat(originalStr: string): string {
  const trimmed = originalStr.trim();

  // YYYY-MM-DD → use same format
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(trimmed)) {
    return "YYYY-MM-DD";
  }

  // DD-MMM-YYYY → use same format
  if (/^\d{1,2}-[A-Za-z]{3}-\d{2,4}$/.test(trimmed)) {
    return "DD-MMM-YYYY";
  }

  // MMM D, YYYY → use same format
  if (/^[A-Za-z]{3}\s+\d{1,2},?\s+\d{4}$/.test(trimmed)) {
    return "MMM D, YYYY";
  }

  // MMMM D, YYYY → use same format
  if (/^[A-Za-z]{4,9}\s+\d{1,2},?\s+\d{4}$/.test(trimmed)) {
    return "MMMM D, YYYY";
  }

  // Default to MM/DD/YYYY for slash-separated dates
  return "MM/DD/YYYY";
}
