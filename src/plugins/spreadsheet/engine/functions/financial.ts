/**
 * Financial Functions
 */

import { functionRegistry, toNumber, type FunctionHandler } from "../registry";

/**
 * FV - Future Value
 * Calculates the future value of an investment based on periodic, constant payments and a constant interest rate.
 * FV(rate, nper, pmt, [pv], [type])
 * - rate: Interest rate per period
 * - nper: Total number of payment periods
 * - pmt: Payment made each period (negative for outflows)
 * - pv: Present value (optional, default 0)
 * - type: 0 = end of period, 1 = beginning of period (optional, default 0)
 */
const fvHandler: FunctionHandler = (args, context) => {
  if (args.length < 3 || args.length > 5) {
    throw new Error("FV requires 3 to 5 arguments");
  }

  const rate = toNumber(context.evaluateFormula(args[0]));
  const nper = toNumber(context.evaluateFormula(args[1]));
  const pmt = toNumber(context.evaluateFormula(args[2]));
  const pv = args.length >= 4 ? toNumber(context.evaluateFormula(args[3])) : 0;
  const type =
    args.length >= 5 ? toNumber(context.evaluateFormula(args[4])) : 0;

  if (rate === 0) {
    return -(pv + pmt * nper);
  }

  const pvFactor = Math.pow(1 + rate, nper);
  const fv = -pv * pvFactor - (pmt * (pvFactor - 1) * (1 + rate * type)) / rate;

  return fv;
};

/**
 * PV - Present Value
 * Calculates the present value of an investment based on periodic, constant payments and a constant interest rate.
 * PV(rate, nper, pmt, [fv], [type])
 */
const pvHandler: FunctionHandler = (args, context) => {
  if (args.length < 3 || args.length > 5) {
    throw new Error("PV requires 3 to 5 arguments");
  }

  const rate = toNumber(context.evaluateFormula(args[0]));
  const nper = toNumber(context.evaluateFormula(args[1]));
  const pmt = toNumber(context.evaluateFormula(args[2]));
  const fv = args.length >= 4 ? toNumber(context.evaluateFormula(args[3])) : 0;
  const type =
    args.length >= 5 ? toNumber(context.evaluateFormula(args[4])) : 0;

  if (rate === 0) {
    return -(fv + pmt * nper);
  }

  const pvFactor = Math.pow(1 + rate, nper);
  const pv =
    (-fv - (pmt * (pvFactor - 1) * (1 + rate * type)) / rate) / pvFactor;

  return pv;
};

/**
 * PMT - Payment
 * Calculates the payment for a loan based on constant payments and a constant interest rate.
 * PMT(rate, nper, pv, [fv], [type])
 */
const pmtHandler: FunctionHandler = (args, context) => {
  if (args.length < 3 || args.length > 5) {
    throw new Error("PMT requires 3 to 5 arguments");
  }

  const rate = toNumber(context.evaluateFormula(args[0]));
  const nper = toNumber(context.evaluateFormula(args[1]));
  const pv = toNumber(context.evaluateFormula(args[2]));
  const fv = args.length >= 4 ? toNumber(context.evaluateFormula(args[3])) : 0;
  const type =
    args.length >= 5 ? toNumber(context.evaluateFormula(args[4])) : 0;

  if (rate === 0) {
    return -(fv + pv) / nper;
  }

  const pvFactor = Math.pow(1 + rate, nper);
  const pmt =
    (-rate * (fv + pv * pvFactor)) / ((pvFactor - 1) * (1 + rate * type));

  return pmt;
};

/**
 * NPER - Number of Periods
 * Calculates the number of periods for an investment based on periodic, constant payments and a constant interest rate.
 * NPER(rate, pmt, pv, [fv], [type])
 */
const nperHandler: FunctionHandler = (args, context) => {
  if (args.length < 3 || args.length > 5) {
    throw new Error("NPER requires 3 to 5 arguments");
  }

  const rate = toNumber(context.evaluateFormula(args[0]));
  const pmt = toNumber(context.evaluateFormula(args[1]));
  const pv = toNumber(context.evaluateFormula(args[2]));
  const fv = args.length >= 4 ? toNumber(context.evaluateFormula(args[3])) : 0;
  const type =
    args.length >= 5 ? toNumber(context.evaluateFormula(args[4])) : 0;

  if (rate === 0) {
    return -(fv + pv) / pmt;
  }

  const pmtWithType = pmt * (1 + rate * type);
  const nper =
    Math.log((pmtWithType - fv * rate) / (pmtWithType + pv * rate)) /
    Math.log(1 + rate);

  return nper;
};

/**
 * RATE - Interest Rate
 * Calculates the interest rate per period of an annuity.
 * RATE(nper, pmt, pv, [fv], [type], [guess])
 * Uses Newton-Raphson method for iteration
 */
const rateHandler: FunctionHandler = (args, context) => {
  if (args.length < 3 || args.length > 6) {
    throw new Error("RATE requires 3 to 6 arguments");
  }

  const nper = toNumber(context.evaluateFormula(args[0]));
  const pmt = toNumber(context.evaluateFormula(args[1]));
  const pv = toNumber(context.evaluateFormula(args[2]));
  const fv = args.length >= 4 ? toNumber(context.evaluateFormula(args[3])) : 0;
  const type =
    args.length >= 5 ? toNumber(context.evaluateFormula(args[4])) : 0;
  const guess =
    args.length >= 6 ? toNumber(context.evaluateFormula(args[5])) : 0.1;

  // Use Newton-Raphson method to find rate
  let rate = guess;
  const maxIterations = 100;
  const tolerance = 1e-7;

  for (let i = 0; i < maxIterations; i++) {
    if (Math.abs(rate) < tolerance) {
      rate = tolerance; // Avoid division by zero
    }

    const y = Math.pow(1 + rate, nper);
    const f = pv * y + pmt * ((y - 1) / rate) * (1 + rate * type) + fv;

    const df =
      nper * pv * Math.pow(1 + rate, nper - 1) +
      (pmt *
        (1 + rate * type) *
        (nper * Math.pow(1 + rate, nper - 1) * rate -
          (Math.pow(1 + rate, nper) - 1))) /
        (rate * rate) +
      pmt * type * ((Math.pow(1 + rate, nper) - 1) / rate);

    const newRate = rate - f / df;

    if (Math.abs(newRate - rate) < tolerance) {
      return newRate;
    }

    rate = newRate;
  }

  return rate;
};

/**
 * IPMT - Interest Payment
 * Calculates the interest payment for a given period for an investment based on periodic, constant payments and a constant interest rate.
 * IPMT(rate, per, nper, pv, [fv], [type])
 */
const ipmtHandler: FunctionHandler = (args, context) => {
  if (args.length < 4 || args.length > 6) {
    throw new Error("IPMT requires 4 to 6 arguments");
  }

  const rate = toNumber(context.evaluateFormula(args[0]));
  const per = toNumber(context.evaluateFormula(args[1]));
  const type =
    args.length >= 6 ? toNumber(context.evaluateFormula(args[5])) : 0;

  // Calculate payment first
  const pmt = pmtHandler(
    [
      args[0],
      args[2],
      args[3],
      ...(args.length >= 5 ? [args[4]] : []),
      ...(args.length >= 6 ? [args[5]] : []),
    ],
    context,
  );

  if (per === 1 && type === 1) {
    return 0; // No interest in first period when payment is at beginning
  }

  // Calculate remaining balance at previous period
  const fvPrevious = fvHandler(
    [
      args[0],
      String(type === 1 ? per - 2 : per - 1),
      String(pmt),
      args[3],
      ...(args.length >= 6 ? [args[5]] : []),
    ],
    context,
  );

  const ipmt = -fvPrevious * rate;

  return type === 1 ? ipmt / (1 + rate) : ipmt;
};

/**
 * PPMT - Principal Payment
 * Calculates the payment on the principal for a given period for an investment based on periodic, constant payments and a constant interest rate.
 * PPMT(rate, per, nper, pv, [fv], [type])
 */
const ppmtHandler: FunctionHandler = (args, context) => {
  if (args.length < 4 || args.length > 6) {
    throw new Error("PPMT requires 4 to 6 arguments");
  }

  // Calculate total payment
  const pmt = pmtHandler(
    [
      args[0],
      args[2],
      args[3],
      ...(args.length >= 5 ? [args[4]] : []),
      ...(args.length >= 6 ? [args[5]] : []),
    ],
    context,
  );

  // Calculate interest payment
  const ipmt = ipmtHandler(args, context);

  // Principal payment = Total payment - Interest payment
  return toNumber(pmt) - toNumber(ipmt);
};

/**
 * NPV - Net Present Value
 * Calculates the net present value of an investment based on a discount rate and a series of future cash flows.
 * NPV(rate, value1, [value2], ...)
 */
const npvHandler: FunctionHandler = (args, context) => {
  if (args.length < 2) {
    throw new Error("NPV requires at least 2 arguments");
  }

  const rate = toNumber(context.evaluateFormula(args[0]));
  let npv = 0;

  // Process each cash flow
  for (let i = 1; i < args.length; i++) {
    // Check if argument is a range
    if (args[i].includes(":")) {
      const values = context.getRangeValues(args[i]);
      for (let j = 0; j < values.length; j++) {
        const value = toNumber(values[j]);
        // Period starts from i for first range element, then continues
        const period = i + j;
        npv += value / Math.pow(1 + rate, period);
      }
    } else {
      const value = toNumber(context.evaluateFormula(args[i]));
      npv += value / Math.pow(1 + rate, i);
    }
  }

  return npv;
};

/**
 * IRR - Internal Rate of Return
 * Calculates the internal rate of return for a series of cash flows.
 * IRR(values, [guess])
 * Uses Newton-Raphson method for iteration
 */
const irrHandler: FunctionHandler = (args, context) => {
  if (args.length < 1 || args.length > 2) {
    throw new Error("IRR requires 1 or 2 arguments");
  }

  const values = context.getRangeValues(args[0]).map(toNumber);
  const guess =
    args.length === 2 ? toNumber(context.evaluateFormula(args[1])) : 0.1;

  if (values.length === 0) {
    throw new Error("IRR requires at least one value");
  }

  // Use Newton-Raphson method
  let rate = guess;
  const maxIterations = 100;
  const tolerance = 1e-7;

  for (let i = 0; i < maxIterations; i++) {
    let npv = 0;
    let dnpv = 0;

    for (let j = 0; j < values.length; j++) {
      const factor = Math.pow(1 + rate, j);
      npv += values[j] / factor;
      dnpv -= (j * values[j]) / (factor * (1 + rate));
    }

    if (Math.abs(npv) < tolerance) {
      return rate;
    }

    if (Math.abs(dnpv) < tolerance) {
      throw new Error("IRR cannot converge");
    }

    const newRate = rate - npv / dnpv;

    if (Math.abs(newRate - rate) < tolerance) {
      return newRate;
    }

    rate = newRate;
  }

  return rate;
};

// Register all financial functions
functionRegistry.register({
  name: "FV",
  handler: fvHandler,
  minArgs: 3,
  maxArgs: 5,
  description:
    "Calculates the future value of an investment based on periodic, constant payments and a constant interest rate",
  examples: ["FV(0.06/12, 12, -100, -1000, 1)", "FV(A1, A2, A3)"],
  category: "Financial",
});

functionRegistry.register({
  name: "PV",
  handler: pvHandler,
  minArgs: 3,
  maxArgs: 5,
  description:
    "Calculates the present value of an investment based on periodic, constant payments and a constant interest rate",
  examples: ["PV(0.08/12, 12*20, 500, 0, 0)", "PV(A1, A2, A3)"],
  category: "Financial",
});

functionRegistry.register({
  name: "PMT",
  handler: pmtHandler,
  minArgs: 3,
  maxArgs: 5,
  description:
    "Calculates the payment for a loan based on constant payments and a constant interest rate",
  examples: ["PMT(0.06/12, 30*12, 250000)", "PMT(A1, A2, A3)"],
  category: "Financial",
});

functionRegistry.register({
  name: "NPER",
  handler: nperHandler,
  minArgs: 3,
  maxArgs: 5,
  description:
    "Calculates the number of periods for an investment based on periodic, constant payments and a constant interest rate",
  examples: ["NPER(0.06/12, -1000, 50000, 0, 0)", "NPER(A1, A2, A3)"],
  category: "Financial",
});

functionRegistry.register({
  name: "RATE",
  handler: rateHandler,
  minArgs: 3,
  maxArgs: 6,
  description:
    "Calculates the interest rate per period of an annuity using iteration",
  examples: ["RATE(12, -100, 1000, 0, 0, 0.1)", "RATE(A1, A2, A3)"],
  category: "Financial",
});

functionRegistry.register({
  name: "IPMT",
  handler: ipmtHandler,
  minArgs: 4,
  maxArgs: 6,
  description:
    "Calculates the interest payment for a given period for an investment",
  examples: ["IPMT(0.06/12, 1, 30*12, 250000)", "IPMT(A1, A2, A3, A4)"],
  category: "Financial",
});

functionRegistry.register({
  name: "PPMT",
  handler: ppmtHandler,
  minArgs: 4,
  maxArgs: 6,
  description:
    "Calculates the payment on the principal for a given period for an investment",
  examples: ["PPMT(0.06/12, 1, 30*12, 250000)", "PPMT(A1, A2, A3, A4)"],
  category: "Financial",
});

functionRegistry.register({
  name: "NPV",
  handler: npvHandler,
  minArgs: 2,
  description:
    "Calculates the net present value of an investment based on a discount rate and a series of future cash flows",
  examples: ["NPV(0.1, -10000, 3000, 4200, 6800)", "NPV(A1, B1:B10)"],
  category: "Financial",
});

functionRegistry.register({
  name: "IRR",
  handler: irrHandler,
  minArgs: 1,
  maxArgs: 2,
  description:
    "Calculates the internal rate of return for a series of cash flows",
  examples: ["IRR(A1:A5, 0.1)", "IRR(B1:B10)"],
  category: "Financial",
});
