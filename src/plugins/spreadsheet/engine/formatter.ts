/**
 * Number Formatting Utilities
 *
 * Handles Excel-style format codes for currency, percentages, decimals, dates, etc.
 */

import {
  serialToDate,
  MONTH_NAMES_SHORT,
  MONTH_NAMES_FULL,
  DAY_NAMES_SHORT,
  DAY_NAMES_FULL,
} from "./date-utils";

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
function formatDate(serial: number, format: string): string {
  const date = serialToDate(serial);

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-11
  const day = date.getUTCDate();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = date.getUTCSeconds();
  const dayOfWeek = date.getUTCDay(); // 0-6

  let result = format;

  // Replace year tokens
  result = result.replace(/YYYY/g, year.toString());
  result = result.replace(/YY/g, (year % 100).toString().padStart(2, "0"));

  // Replace month tokens (order matters - do longer patterns first)
  result = result.replace(
    /MMMM/g,
    MONTH_NAMES_FULL[month] || MONTH_NAMES_FULL[0],
  );
  result = result.replace(
    /MMM/g,
    MONTH_NAMES_SHORT[month] || MONTH_NAMES_SHORT[0],
  );
  result = result.replace(/MM/g, (month + 1).toString().padStart(2, "0"));
  result = result.replace(/M/g, (month + 1).toString());

  // Replace day tokens
  result = result.replace(/DD/g, day.toString().padStart(2, "0"));
  result = result.replace(/D/g, day.toString());

  // Replace day of week tokens
  result = result.replace(
    /dddd/g,
    DAY_NAMES_FULL[dayOfWeek] || DAY_NAMES_FULL[0],
  );
  result = result.replace(
    /ddd/g,
    DAY_NAMES_SHORT[dayOfWeek] || DAY_NAMES_SHORT[0],
  );

  // Replace time tokens
  // Handle 12-hour format with AM/PM
  if (result.includes("AM/PM") || result.includes("am/pm")) {
    const isPM = hours >= 12;
    const hours12 = hours % 12 || 12; // 0 becomes 12

    result = result.replace(/h/g, hours12.toString());
    result = result.replace(/AM\/PM/g, isPM ? "PM" : "AM");
    result = result.replace(/am\/pm/g, isPM ? "pm" : "am");
  } else {
    // 24-hour format
    result = result.replace(/HH/g, hours.toString().padStart(2, "0"));
    result = result.replace(/H/g, hours.toString());
    result = result.replace(/h/g, hours.toString());
  }

  result = result.replace(/mm/g, minutes.toString().padStart(2, "0"));
  result = result.replace(/ss/g, seconds.toString().padStart(2, "0"));

  return result;
}

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
        // Add thousand separators without regex to avoid performance issues
        const parts = formatted.split(".");
        const integerPart = parts[0];
        let result = "";
        for (let i = integerPart.length - 1, count = 0; i >= 0; i--, count++) {
          if (count > 0 && count % 3 === 0) {
            result = "," + result;
          }
          result = integerPart[i] + result;
        }
        parts[0] = result;
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
      // Add thousand separators without regex to avoid performance issues
      const parts = formatted.split(".");
      const integerPart = parts[0];
      let result = "";
      for (let i = integerPart.length - 1, count = 0; i >= 0; i--, count++) {
        if (count > 0 && count % 3 === 0) {
          result = "," + result;
        }
        result = integerPart[i] + result;
      }
      parts[0] = result;
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
