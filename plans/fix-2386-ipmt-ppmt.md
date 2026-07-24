# fix(spreadsheet): correct IPMT sign and PPMT (#2386)

## Problem

```
IPMT(0.005, 1, 360, 250000) => 1250      (Excel: -1250, sign inverted)
PPMT(0.005, 1, 360, 250000) => -2748.88  (Excel: -248.88, way off)
PMT(0.005, 360, 250000)     => -1498.88  (correct)
```

`PMT` returns the payment as a (correct) negative outflow, but `IPMT` returned
the interest with the wrong sign, and `PPMT = PMT - IPMT` amplified the error.

## Root cause

`ipmtHandler` computed `const ipmt = -fvPrevious * rate;`. `fvHandler` already
returns the outstanding balance with Excel's payment-negative sign, so negating
it again flipped the interest sign. `PPMT` then did `-1498.88 - (+1250) =
-2748.88` instead of `-1498.88 - (-1250) = -248.88`.

## Fix

Extract the annuity math into pure numeric helpers in a new
`engine/financial-math.ts` (`computeFv`, `computePmt`, `computeIpmt`,
`computePpmt`) and have the FV / PMT / IPMT / PPMT handlers parse their args and
delegate. The sign is fixed in one place: `interest = computeFv(...) * rate`
(no extra negation). Because PPMT calls the same pure `computeIpmt`, one fix
corrects both, and the `IPMT + PPMT == PMT` invariant holds.

This also removes the awkward previous structure where IPMT/PPMT re-invoked the
PMT/FV _handlers_ with stringified numeric args through the evaluator.

## Tests (test_financialMath.ts, pure functions — no evaluator needed)

- Excel values: `PMT = -1498.88`, `IPMT(1) = -1250`, `IPMT(2) = -1248.76`,
  `PPMT(1) = -248.88`.
- Invariant: `IPMT(per) + PPMT(per) == PMT` for per ∈ {1, 2, 12, 180, 360}.
- Sign anchor: `computeFv(rate, 0, pmt, pv, 0) == -pv`; zero-rate streams.
- Annuity-due first period has zero interest.

## Items to confirm

- Excel cash-flow sign convention (money out = negative) is followed throughout.
- FV/PMT numeric results are unchanged (only relocated into the pure module).
