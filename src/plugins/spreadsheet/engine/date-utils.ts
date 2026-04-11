/**
 * Date Utility Functions
 *
 * Shared utilities for converting between JavaScript Date objects and Excel serial numbers.
 * Excel stores dates as sequential serial numbers so they can be used in calculations.
 * January 1, 1900 is serial number 1.
 */

// Constants
const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Excel base date: Dec 30, 1899 (to handle the 1900 leap year bug correctly)
const EXCEL_BASE_DATE = new Date(Date.UTC(1899, 11, 30));

/**
 * Convert JavaScript Date to Excel Serial Number
 *
 * @param date - JavaScript Date object
 * @returns Excel serial number (days since Dec 30, 1899)
 */
export const dateToSerial = (date: Date): number => {
  const diff = date.getTime() - EXCEL_BASE_DATE.getTime();
  return diff / MS_PER_DAY;
};

/**
 * Convert Excel Serial Number to JavaScript Date
 *
 * @param serial - Excel serial number
 * @returns JavaScript Date object
 */
export const serialToDate = (serial: number): Date => {
  const days = Math.floor(serial);
  const timePart = serial - days;

  const date = new Date(EXCEL_BASE_DATE.getTime() + days * MS_PER_DAY);

  // Add time component
  const totalSeconds = Math.round(timePart * 24 * 60 * 60);
  date.setSeconds(date.getSeconds() + totalSeconds);

  return date;
};

/**
 * Month names for formatting
 */
export const MONTH_NAMES_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export const MONTH_NAMES_FULL = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Day names for formatting
 */
export const DAY_NAMES_SHORT = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
];

export const DAY_NAMES_FULL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
