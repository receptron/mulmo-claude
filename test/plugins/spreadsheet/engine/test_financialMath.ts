// The per-period interest/principal split of an annuity. The bug this covers
// returned a plausible NUMBER — IPMT came back +1250 for a -1250 interest
// payment (sign inverted), and PPMT (= PMT - IPMT) amplified it to -2748.88
// instead of -248.88 (#2386). Values are checked against Excel.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeFv,
  computePmt,
  computeIpmt,
  computePpmt,
  computePv,
  computeNper,
  computeRate,
  computeNpv,
  computeIrr,
} from "../../../../src/plugins/spreadsheet/engine/financial-math.ts";

const closeTo = (actual: number, expected: number, eps = 0.01): boolean => Math.abs(actual - expected) <= eps;

// A 250,000 loan at 0.5%/period over 360 periods — the issue's worked example.
const RATE = 0.005;
const NPER = 360;
const PRINCIPAL = 250000;

describe("computePmt", () => {
  it("matches Excel's constant payment (negative outflow)", () => {
    assert.ok(closeTo(computePmt(RATE, NPER, PRINCIPAL, 0, 0), -1498.88), "PMT ≈ -1498.88");
  });

  it("splits a zero-interest loan evenly", () => {
    assert.ok(closeTo(computePmt(0, 10, 1000, 0, 0), -100, 1e-9), "zero-rate PMT");
  });
});

describe("computeIpmt", () => {
  it("returns the first period's interest with Excel's sign", () => {
    // Interest on the full 250,000 balance: 250000 * 0.005 = 1250, as a payment
    // it is negative. The bug returned +1250.
    assert.ok(closeTo(computeIpmt(RATE, 1, NPER, PRINCIPAL, 0, 0), -1250, 1e-9), "IPMT(1) = -1250");
  });

  it("decreases in magnitude as the balance is paid down", () => {
    assert.ok(closeTo(computeIpmt(RATE, 2, NPER, PRINCIPAL, 0, 0), -1248.76), "IPMT(2) ≈ -1248.76");
  });

  it("has no interest in the first period of an annuity due", () => {
    assert.equal(computeIpmt(RATE, 1, NPER, PRINCIPAL, 0, 1), 0);
  });
});

describe("computePpmt", () => {
  it("returns the first period's principal, not a wildly wrong value", () => {
    // PMT - IPMT = -1498.88 - (-1250) = -248.88. The sign bug made this -2748.88.
    assert.ok(closeTo(computePpmt(RATE, 1, NPER, PRINCIPAL, 0, 0), -248.88), "PPMT(1) ≈ -248.88");
  });
});

describe("the interest and principal split reconstitutes the payment", () => {
  it("IPMT(per) + PPMT(per) == PMT for every period", () => {
    const pmt = computePmt(RATE, NPER, PRINCIPAL, 0, 0);
    for (const per of [1, 2, 12, 180, 360]) {
      const split = computeIpmt(RATE, per, NPER, PRINCIPAL, 0, 0) + computePpmt(RATE, per, NPER, PRINCIPAL, 0, 0);
      assert.ok(closeTo(split, pmt, 1e-9), `period ${per}: IPMT + PPMT == PMT`);
    }
  });
});

describe("computeNpv", () => {
  const NPV_RATE = 0.1;

  // Each flow discounts by its 1-based POSITION in the flattened list. The #2390
  // bug used the argument index, so a scalar after a 3-cell range landed at
  // period 2 instead of 4 — the position is what makes 100/1.1 + 200/1.1^2 +
  // 300/1.1^3 + 500/1.1^4 correct.
  it("discounts each flow by its 1-based position", () => {
    const expected = 100 / 1.1 + 200 / 1.1 ** 2 + 300 / 1.1 ** 3 + 500 / 1.1 ** 4;
    assert.ok(closeTo(computeNpv(NPV_RATE, [100, 200, 300, 500]), expected, 1e-9));
  });

  it("sums flows undiscounted at a zero rate", () => {
    assert.ok(closeTo(computeNpv(0, [100, 200, 300, 500]), 1100, 1e-9));
  });

  it("is zero for no cash flows", () => {
    assert.equal(computeNpv(NPV_RATE, []), 0);
  });

  it("discounts a single flow by one period", () => {
    assert.ok(closeTo(computeNpv(NPV_RATE, [100]), 100 / 1.1, 1e-9));
  });
});

describe("computeFv", () => {
  it("carries the payment-negative sign the interest split relies on", () => {
    // Balance outstanding at the start of period 1 is the present value, which
    // FV expresses as its negative.
    assert.ok(closeTo(computeFv(RATE, 0, computePmt(RATE, NPER, PRINCIPAL, 0, 0), PRINCIPAL, 0), -PRINCIPAL, 1e-9), "FV of pv over 0 periods = -pv");
  });

  it("sums a zero-rate stream directly", () => {
    assert.ok(closeTo(computeFv(0, 10, -100, 0, 0), 1000, 1e-9), "zero-rate FV");
  });
});

// PV / NPER / RATE / NPV / IRR were inline in the handlers before this refactor;
// the values below were captured from the pre-refactor formulas (verbatim) and
// cross-checked against Excel, so they double as regression pins.

describe("computePv", () => {
  it("matches Excel's present value of an annuity", () => {
    // Excel PV(0.05, 10, -1000) = 7721.73 (paying out 1000/period is a positive PV).
    assert.ok(closeTo(computePv(0.05, 10, -1000, 0, 0), 7721.73), "PV ≈ 7721.73");
  });

  it("discounts a zero-rate stream to its undiscounted total", () => {
    assert.ok(closeTo(computePv(0, 10, -100, 0, 0), 1000, 1e-9), "zero-rate PV");
  });

  it("is the inverse of PMT — it recovers the principal from that payment", () => {
    const payment = computePmt(RATE, NPER, PRINCIPAL, 0, 0);
    assert.ok(closeTo(computePv(RATE, NPER, payment, 0, 0), PRINCIPAL, 1e-6), "PV(PMT(pv)) == pv");
  });
});

describe("computeNper", () => {
  it("counts the periods needed to pay off a loan (Excel value)", () => {
    // Excel NPER(0.05, -1000, 8000) = 10.47.
    assert.ok(closeTo(computeNper(0.05, -1000, 8000, 0, 0), 10.47), "NPER ≈ 10.47");
  });

  it("splits a zero-rate balance into equal periods", () => {
    assert.ok(closeTo(computeNper(0, -100, 1000, 0, 0), 10, 1e-9), "zero-rate NPER");
  });
});

describe("computeRate", () => {
  it("recovers the rate implied by a known payment via Newton-Raphson", () => {
    const payment = computePmt(0.05, 12, 1000, 0, 0);
    assert.ok(closeTo(computeRate(12, payment, 1000, 0, 0, 0.1), 0.05, 1e-6), "RATE recovers 0.05");
  });

  // Deliberate known limitation: with no real root the iteration diverges to a
  // finite nonsense value; Excel reports #NUM!. Pinned so a future change to the
  // convergence handling is a conscious decision, not a silent regression.
  it("returns a divergent finite value instead of Excel's #NUM! when no root exists", () => {
    const diverged = computeRate(10, 100, 100, 100, 0, 0.1);
    assert.ok(closeTo(diverged, -2.5804947624929158, 1e-9), "divergent finite rate is preserved");
  });
});

describe("computeNpv", () => {
  it("discounts each cash flow one period further out (Excel NPV)", () => {
    // Excel NPV(0.1, -10000, 3000, 4200, 6800) = 1188.44 — the first flow is
    // discounted one period, unlike IRR which places element 0 at period 0.
    assert.ok(closeTo(computeNpv(0.1, [-10000, 3000, 4200, 6800]), 1188.44), "NPV ≈ 1188.44");
  });

  it("discounts a single flow by exactly one period", () => {
    assert.ok(closeTo(computeNpv(0.1, [100]), 90.9090909, 1e-6), "100 / 1.1");
  });

  it("returns zero for an empty cash-flow series", () => {
    assert.equal(computeNpv(0.1, []), 0);
  });
});

describe("computeIrr", () => {
  it("finds the rate that zeroes the NPV (Excel IRR)", () => {
    assert.ok(closeTo(computeIrr([-100, 60, 60], 0.1), 0.130662, 1e-5), "IRR ≈ 0.130662");
  });

  it("drives the period-0 discounted cash flows to zero at the returned rate", () => {
    const irr = computeIrr([-1000, 500, 400, 300, 100], 0.1);
    const npvFromPeriodZero = [-1000, 500, 400, 300, 100].reduce((sum, value, index) => sum + value / (1 + irr) ** index, 0);
    assert.ok(closeTo(npvFromPeriodZero, 0, 1e-6), "NPV at IRR ≈ 0");
  });

  // Same-sign cash flows have no internal rate of return; the derivative collapses
  // and the current code throws rather than returning Excel's #NUM!. Pinned.
  it("throws when the cash flows never change sign", () => {
    assert.throws(() => computeIrr([100, 200, 300], 0.1), /IRR cannot converge/);
  });
});
