/**
 * Date and Time Functions
 * Excel stores dates as sequential serial numbers so they can be used in calculations.
 * January 1, 1900 is serial number 1.
 */

import {
  functionRegistry,
  toNumber,
  toString,
  type FunctionHandler,
} from "../registry";
import { dateToSerial, serialToDate } from "../date-utils";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const nowHandler: FunctionHandler = (args) => {
  if (args.length !== 0) throw new Error("NOW requires 0 arguments");
  // Return current date and time as serial number
  // We need to adjust for timezone offset because Excel dates are "local" usually
  // But for simplicity we'll use local time converted to serial
  const now = new Date();
  // Create a UTC date that matches the local time components
  const localAsUtc = new Date(
    Date.UTC(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      now.getMinutes(),
      now.getSeconds(),
    ),
  );
  return dateToSerial(localAsUtc);
};

const todayHandler: FunctionHandler = (args) => {
  if (args.length !== 0) throw new Error("TODAY requires 0 arguments");
  const now = new Date();
  const today = new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
  );
  return dateToSerial(today);
};

const dateHandler: FunctionHandler = (args, context) => {
  if (args.length !== 3) throw new Error("DATE requires 3 arguments");

  const year = toNumber(context.evaluateFormula(args[0]));
  const month = toNumber(context.evaluateFormula(args[1]));
  const day = toNumber(context.evaluateFormula(args[2]));

  // JS Date constructor handles overflow (e.g. month 13 becomes Jan of next year)
  // Month is 0-indexed in JS, 1-indexed in Excel
  const date = new Date(Date.UTC(year, month - 1, day));
  return dateToSerial(date);
};

const timeHandler: FunctionHandler = (args, context) => {
  if (args.length !== 3) throw new Error("TIME requires 3 arguments");

  const hour = toNumber(context.evaluateFormula(args[0]));
  const minute = toNumber(context.evaluateFormula(args[1]));
  const second = toNumber(context.evaluateFormula(args[2]));

  // Time is a fraction of a day
  // 1 hour = 1/24
  // 1 minute = 1/(24*60)
  // 1 second = 1/(24*60*60)

  // Normalize inputs (e.g. 25 hours)
  const totalSeconds = hour * 3600 + minute * 60 + second;
  const secondsPerDay = 86400;

  return (totalSeconds % secondsPerDay) / secondsPerDay;
};

const yearHandler: FunctionHandler = (args, context) => {
  if (args.length !== 1) throw new Error("YEAR requires 1 argument");
  const serial = toNumber(context.evaluateFormula(args[0]));
  const date = serialToDate(serial);
  return date.getUTCFullYear();
};

const monthHandler: FunctionHandler = (args, context) => {
  if (args.length !== 1) throw new Error("MONTH requires 1 argument");
  const serial = toNumber(context.evaluateFormula(args[0]));
  const date = serialToDate(serial);
  return date.getUTCMonth() + 1; // 1-indexed
};

const dayHandler: FunctionHandler = (args, context) => {
  if (args.length !== 1) throw new Error("DAY requires 1 argument");
  const serial = toNumber(context.evaluateFormula(args[0]));
  const date = serialToDate(serial);
  return date.getUTCDate();
};

const hourHandler: FunctionHandler = (args, context) => {
  if (args.length !== 1) throw new Error("HOUR requires 1 argument");
  const serial = toNumber(context.evaluateFormula(args[0]));
  // Get fractional part
  const timePart = serial - Math.floor(serial);
  const totalSeconds = Math.round(timePart * 86400);
  return Math.floor(totalSeconds / 3600);
};

const minuteHandler: FunctionHandler = (args, context) => {
  if (args.length !== 1) throw new Error("MINUTE requires 1 argument");
  const serial = toNumber(context.evaluateFormula(args[0]));
  const timePart = serial - Math.floor(serial);
  const totalSeconds = Math.round(timePart * 86400);
  return Math.floor((totalSeconds % 3600) / 60);
};

const secondHandler: FunctionHandler = (args, context) => {
  if (args.length !== 1) throw new Error("SECOND requires 1 argument");
  const serial = toNumber(context.evaluateFormula(args[0]));
  const timePart = serial - Math.floor(serial);
  const totalSeconds = Math.round(timePart * 86400);
  return totalSeconds % 60;
};

const datedifHandler: FunctionHandler = (args, context) => {
  if (args.length !== 3) throw new Error("DATEDIF requires 3 arguments");

  const startSerial = toNumber(context.evaluateFormula(args[0]));
  const endSerial = toNumber(context.evaluateFormula(args[1]));
  const unit = toString(context.evaluateFormula(args[2])).toUpperCase();

  if (startSerial > endSerial) return "#NUM!";

  const startDate = serialToDate(startSerial);
  const endDate = serialToDate(endSerial);

  const yearDiff = endDate.getUTCFullYear() - startDate.getUTCFullYear();
  const monthDiff = endDate.getUTCMonth() - startDate.getUTCMonth();
  const dayDiff = endDate.getUTCDate() - startDate.getUTCDate();

  switch (unit) {
    case "Y": {
      // Complete years
      let years = yearDiff;
      if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
        years--;
      }
      return years;
    }

    case "M": {
      // Complete months
      let months = yearDiff * 12 + monthDiff;
      if (dayDiff < 0) {
        months--;
      }
      return months;
    }

    case "D":
      // Complete days
      return Math.floor(endSerial - startSerial);

    case "MD": {
      // Difference in days, ignoring months and years
      // This is tricky. It's basically day of month difference, but handling wrap around
      // E.g. Jan 30 to Mar 1.
      // Standard implementation:
      const startD = startDate.getUTCDate();
      const endD = endDate.getUTCDate();

      if (endD >= startD) return endD - startD;

      // Need to borrow days from previous month
      const prevMonthDate = new Date(
        Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 0),
      );
      return prevMonthDate.getUTCDate() - startD + endD;
    }

    case "YM": {
      // Difference in months, ignoring years
      let ym = monthDiff;
      if (dayDiff < 0) ym--;
      if (ym < 0) ym += 12;
      return ym;
    }

    case "YD": {
      // Difference in days, ignoring years
      // Treat start date as being in the same year as end date
      // If start > end (after adjusting year), move start to previous year
      const startCopy = new Date(startDate);
      startCopy.setUTCFullYear(endDate.getUTCFullYear());

      const diff = (startCopy.getTime() - endDate.getTime()) / MS_PER_DAY;
      if (diff > 0) {
        startCopy.setUTCFullYear(endDate.getUTCFullYear() - 1);
      }

      return Math.floor((endDate.getTime() - startCopy.getTime()) / MS_PER_DAY);
    }

    default:
      return "#NUM!";
  }
};

// Register functions
functionRegistry.register({
  name: "NOW",
  handler: nowHandler,
  minArgs: 0,
  maxArgs: 0,
  description: "Returns the serial number of the current date and time",
  examples: ["NOW()"],
  category: "Date & Time",
});

functionRegistry.register({
  name: "TODAY",
  handler: todayHandler,
  minArgs: 0,
  maxArgs: 0,
  description: "Returns the serial number of today's date",
  examples: ["TODAY()"],
  category: "Date & Time",
});

functionRegistry.register({
  name: "DATE",
  handler: dateHandler,
  minArgs: 3,
  maxArgs: 3,
  description: "Returns the serial number that represents a particular date",
  examples: ["DATE(2023, 11, 25)"],
  category: "Date & Time",
});

functionRegistry.register({
  name: "TIME",
  handler: timeHandler,
  minArgs: 3,
  maxArgs: 3,
  description: "Returns the serial number of a particular time",
  examples: ["TIME(14, 30, 0)"],
  category: "Date & Time",
});

functionRegistry.register({
  name: "YEAR",
  handler: yearHandler,
  minArgs: 1,
  maxArgs: 1,
  description: "Converts a serial number to a year",
  examples: ["YEAR(TODAY())", "YEAR(A1)"],
  category: "Date & Time",
});

functionRegistry.register({
  name: "MONTH",
  handler: monthHandler,
  minArgs: 1,
  maxArgs: 1,
  description: "Converts a serial number to a month",
  examples: ["MONTH(TODAY())", "MONTH(A1)"],
  category: "Date & Time",
});

functionRegistry.register({
  name: "DAY",
  handler: dayHandler,
  minArgs: 1,
  maxArgs: 1,
  description: "Converts a serial number to a day of the month",
  examples: ["DAY(TODAY())", "DAY(A1)"],
  category: "Date & Time",
});

functionRegistry.register({
  name: "HOUR",
  handler: hourHandler,
  minArgs: 1,
  maxArgs: 1,
  description: "Converts a serial number to an hour",
  examples: ["HOUR(NOW())", "HOUR(A1)"],
  category: "Date & Time",
});

functionRegistry.register({
  name: "MINUTE",
  handler: minuteHandler,
  minArgs: 1,
  maxArgs: 1,
  description: "Converts a serial number to a minute",
  examples: ["MINUTE(NOW())", "MINUTE(A1)"],
  category: "Date & Time",
});

functionRegistry.register({
  name: "SECOND",
  handler: secondHandler,
  minArgs: 1,
  maxArgs: 1,
  description: "Converts a serial number to a second",
  examples: ["SECOND(NOW())", "SECOND(A1)"],
  category: "Date & Time",
});

functionRegistry.register({
  name: "DATEDIF",
  handler: datedifHandler,
  minArgs: 3,
  maxArgs: 3,
  description:
    "Calculates the number of days, months, or years between two dates",
  examples: ['DATEDIF(A1, B1, "Y")', 'DATEDIF(DATE(2020,1,1), TODAY(), "D")'],
  category: "Date & Time",
});
