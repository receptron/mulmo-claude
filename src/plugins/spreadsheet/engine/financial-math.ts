/**
 * Annuity math for the financial functions, as pure numeric helpers.
 *
 * Excel's cash-flow sign convention: money received is positive, money paid out
 * is negative — so a loan's `pv` is positive and its payment and interest come
 * back negative. Keeping the per-period split as plain number-in / number-out
 * functions lets it be tested against known Excel values without routing string
 * arguments back through the formula evaluator.
 */

/** Future value after `nper` periods. `type` is 0 (end of period) or 1 (begin). */
export function computeFv(rate: number, nper: number, pmt: number, pv: number, type: number): number {
  if (rate === 0) return -(pv + pmt * nper);
  const growth = Math.pow(1 + rate, nper);
  return -pv * growth - (pmt * (growth - 1) * (1 + rate * type)) / rate;
}

/** Constant per-period payment amortising a present value `pv` to `fv`. */
export function computePmt(rate: number, nper: number, pv: number, fv: number, type: number): number {
  if (rate === 0) return -(fv + pv) / nper;
  const growth = Math.pow(1 + rate, nper);
  return (-rate * (fv + pv * growth)) / ((growth - 1) * (1 + rate * type));
}

/** Interest portion of the `per`-th payment. */
export function computeIpmt(rate: number, per: number, nper: number, pv: number, fv: number, type: number): number {
  const pmt = computePmt(rate, nper, pv, fv, type);
  if (per === 1 && type === 1) return 0;
  const priorPeriods = type === 1 ? per - 2 : per - 1;
  // Interest is the rate applied to the balance outstanding at the start of the
  // period. computeFv already carries the payment-negative sign, so this product
  // is the interest as a (negative) cash outflow — negating it again inverted the
  // sign (IPMT came back +1250 for a -1250 payment) and PPMT amplified the error.
  const interest = computeFv(rate, priorPeriods, pmt, pv, type) * rate;
  return type === 1 ? interest / (1 + rate) : interest;
}

/** Principal portion of the `per`-th payment (total payment minus interest). */
export function computePpmt(rate: number, per: number, nper: number, pv: number, fv: number, type: number): number {
  return computePmt(rate, nper, pv, fv, type) - computeIpmt(rate, per, nper, pv, fv, type);
}

/** Present value of an annuity that grows to `fv` after `nper` payments of `pmt`. */
export function computePv(rate: number, nper: number, pmt: number, fv: number, type: number): number {
  if (rate === 0) return -(fv + pmt * nper);
  const growth = Math.pow(1 + rate, nper);
  return (-fv - (pmt * (growth - 1) * (1 + rate * type)) / rate) / growth;
}

/** Number of periods needed to amortise `pv` to `fv` at constant `pmt`. */
export function computeNper(rate: number, pmt: number, pv: number, fv: number, type: number): number {
  if (rate === 0) return -(fv + pv) / pmt;
  const pmtWithType = pmt * (1 + rate * type);
  return Math.log((pmtWithType - fv * rate) / (pmtWithType + pv * rate)) / Math.log(1 + rate);
}

// Newton-Raphson is iterative; a valid annuity / cash-flow series converges well
// inside these bounds. On non-convergence RATE and IRR return the last iterate (a
// divergent value or NaN) rather than Excel's #NUM!, preserving prior behaviour.
const NEWTON_MAX_ITERATIONS = 100;
const NEWTON_TOLERANCE = 1e-7;

/** Interest rate per period solving the annuity equation, via Newton-Raphson. */
export function computeRate(nper: number, pmt: number, pv: number, fv: number, type: number, guess: number): number {
  let rate = guess;
  for (let i = 0; i < NEWTON_MAX_ITERATIONS; i++) {
    if (Math.abs(rate) < NEWTON_TOLERANCE) rate = NEWTON_TOLERANCE; // avoid division by zero
    const growth = Math.pow(1 + rate, nper);
    const f = pv * growth + pmt * ((growth - 1) / rate) * (1 + rate * type) + fv;
    const df =
      nper * pv * Math.pow(1 + rate, nper - 1) +
      (pmt * (1 + rate * type) * (nper * Math.pow(1 + rate, nper - 1) * rate - (growth - 1))) / (rate * rate) +
      pmt * type * ((growth - 1) / rate);
    const newRate = rate - f / df;
    if (Math.abs(newRate - rate) < NEWTON_TOLERANCE) return newRate;
    rate = newRate;
  }
  return rate;
}

/** Net present value of `cashflows`, each discounted one period further into the future. */
export function computeNpv(rate: number, cashflows: number[]): number {
  return cashflows.reduce((npv, value, index) => npv + value / Math.pow(1 + rate, index + 1), 0);
}

/** Internal rate of return of `values` (element 0 at period 0), via Newton-Raphson. */
export function computeIrr(values: number[], guess: number): number {
  let rate = guess;
  for (let i = 0; i < NEWTON_MAX_ITERATIONS; i++) {
    let npv = 0;
    let dnpv = 0;
    for (let j = 0; j < values.length; j++) {
      const factor = Math.pow(1 + rate, j);
      npv += values[j] / factor;
      dnpv -= (j * values[j]) / (factor * (1 + rate));
    }
    if (Math.abs(npv) < NEWTON_TOLERANCE) return rate;
    if (Math.abs(dnpv) < NEWTON_TOLERANCE) throw new Error("IRR cannot converge");
    const newRate = rate - npv / dnpv;
    if (Math.abs(newRate - rate) < NEWTON_TOLERANCE) return newRate;
    rate = newRate;
  }
  return rate;
}
