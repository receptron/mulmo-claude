/**
 * DATEDIF — complete elapsed time between two dates, in a chosen unit.
 *
 * Pure: two Excel serials and a unit in, a number (or a formula error value)
 * out. The unit branches each have their own boundary handling (month-end
 * borrowing, year wraparound), which is exactly what makes them worth testing
 * apart from the handler that reads the arguments.
 */

import { serialToDate } from "./date-utils";
import { NUM_ERROR, type SpreadsheetError } from "./spreadsheet-errors";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MONTHS_PER_YEAR = 12;

/** `date` advanced by `months`, clamping the day to the target month's length so
 *  adding a month to Jan 30 lands on the last day of a shorter month instead of
 *  overflowing into the next one. */
function addMonthsClamped(date: Date, months: number): Date {
  const monthIndex = date.getUTCMonth() + months;
  const year = date.getUTCFullYear() + Math.floor(monthIndex / MONTHS_PER_YEAR);
  const month = ((monthIndex % MONTHS_PER_YEAR) + MONTHS_PER_YEAR) % MONTHS_PER_YEAR;
  const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(date.getUTCDate(), lastDayOfMonth);
  return new Date(Date.UTC(year, month, day));
}

/** Complete `unit`s between two dates, or `#NUM!` when start is after end or
 *  the unit is not one of Y / M / D / MD / YM / YD. `unit` is matched
 *  case-insensitively. */
export function computeDatedif(startSerial: number, endSerial: number, unit: string): number | SpreadsheetError {
  if (startSerial > endSerial) return NUM_ERROR;

  const startDate = serialToDate(startSerial);
  const endDate = serialToDate(endSerial);

  const yearDiff = endDate.getUTCFullYear() - startDate.getUTCFullYear();
  const monthDiff = endDate.getUTCMonth() - startDate.getUTCMonth();
  const dayDiff = endDate.getUTCDate() - startDate.getUTCDate();

  switch (unit.toUpperCase()) {
    case "Y": {
      // Complete years: back off one if the end has not yet reached the
      // start's month-and-day within its year.
      const years = yearDiff;
      return monthDiff < 0 || (monthDiff === 0 && dayDiff < 0) ? years - 1 : years;
    }

    case "M": {
      // Complete months, backing off one when the day-of-month has not been reached.
      const months = yearDiff * MONTHS_PER_YEAR + monthDiff;
      return dayDiff < 0 ? months - 1 : months;
    }

    case "D":
      return Math.floor(endSerial - startSerial);

    case "MD": {
      // Days left after the complete months "M" counts. Anchoring on start plus
      // those months keeps the result non-negative and self-consistent (start +
      // M months + MD days == end). Subtracting the calendar month before `end`
      // instead goes negative when the start day outruns that month's length —
      // Jan 30 → Mar 1 borrowed Feb's 28 days and returned -1.
      const completeMonths = yearDiff * MONTHS_PER_YEAR + monthDiff - (dayDiff < 0 ? 1 : 0);
      const anchor = addMonthsClamped(startDate, completeMonths);
      // Compare whole days only. `end` may carry a time-of-day (a datetime
      // serial); anchor is already UTC midnight, so strip end's time too or the
      // remainder would swing with the clock (Codex review).
      const endMidnight = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate());
      return Math.round((endMidnight - anchor.getTime()) / MS_PER_DAY);
    }

    case "YM": {
      // Month difference, ignoring years — wraps into 0..11.
      const ym = dayDiff < 0 ? monthDiff - 1 : monthDiff;
      return ym < 0 ? ym + MONTHS_PER_YEAR : ym;
    }

    case "YD": {
      // Day difference, ignoring years: move the start into the end's year,
      // stepping back a year if that would put it after the end.
      const startInEndYear = new Date(startDate);
      startInEndYear.setUTCFullYear(endDate.getUTCFullYear());
      if (startInEndYear.getTime() - endDate.getTime() > 0) {
        startInEndYear.setUTCFullYear(endDate.getUTCFullYear() - 1);
      }
      return Math.floor((endDate.getTime() - startInEndYear.getTime()) / MS_PER_DAY);
    }

    default:
      return NUM_ERROR;
  }
}
