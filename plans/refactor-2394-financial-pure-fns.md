# refactor(spreadsheet): extract PV/NPER/RATE/IRR/NPV into pure financial-math helpers (#2394)

## Goal

Continue the extraction started in #2386. The spreadsheet financial handlers in
`src/plugins/spreadsheet/engine/functions/financial.ts` mixed argument evaluation
(`toNumber(context.evaluateFormula(...))`) with the annuity / cash-flow formulas.
The formulas depend only on numbers, so they can live as pure number-in / number-out
helpers that are directly testable against known Excel values — no formula evaluator,
no `FunctionContext`.

## What was already done (#2386, merged)

`computeFv`, `computePmt`, `computeIpmt`, `computePpmt` were already extracted into
`src/plugins/spreadsheet/engine/financial-math.ts`, and the FV/PMT/IPMT/PPMT handlers
already delegate to them. This refactor matches that file's module header, doc-comment
style, and the Excel cash-flow sign convention (money out = negative).

## What this change extracts

Added to `financial-math.ts` (verbatim copies of the handler formulas):

- `computePv(rate, nper, pmt, fv, type)` — present value of an annuity (incl. `rate === 0` branch)
- `computeNper(rate, pmt, pv, fv, type)` — number of periods (incl. `rate === 0` branch)
- `computeRate(nper, pmt, pv, fv, type, guess)` — Newton-Raphson interest rate solver
- `computeNpv(rate, cashflows: number[])` — discounts element `k` by `(1+rate)^(k+1)`
- `computeIrr(values: number[], guess)` — Newton-Raphson internal rate of return

The `pvHandler`, `nperHandler`, `rateHandler`, `npvHandler`, `irrHandler` now only
parse arguments and delegate.

### Ranges stay in the handler

For NPV/IRR the range reading (`context.getRangeValues`) stays in the handler; the
pure functions receive a plain `number[]`. NPV flattens its cash-flow args via a small
`readCashflowSeries` helper. IRR keeps its arg-count and empty-values validation in the
handler.

### Newton-Raphson constants

`RATE` and `IRR` shared identical local `maxIterations = 100` / `tolerance = 1e-7`
literals; these are lifted to named module constants `NEWTON_MAX_ITERATIONS` /
`NEWTON_TOLERANCE`.

## Sign / semantic conventions preserved

- Excel cash-flow sign: money received positive, money paid out negative.
- NPV discounts the FIRST cash flow by one period (`(1+rate)^1`); IRR places element 0
  at period 0 (`(1+rate)^0`). This asymmetry is intentional and pinned by tests.
- Non-convergence behaviour is preserved (NOT changed to Excel's `#NUM!`): RATE returns
  the last (possibly divergent/NaN) iterate; IRR throws `"IRR cannot converge"` when the
  derivative collapses (same-sign flows). Both are pinned as known-limitation tests.

## Behaviour-preserving verification

Every new pure function was diffed against the pre-refactor inline formula over a spread
of inputs (scratchpad harness) — 0 mismatches. Spot values confirmed unchanged:
`PV(0.05,10,-1000)=7721.73`, `NPER(0.05,-1000,8000)=10.47`,
`NPV(0.1,-10000,3000,4200,6800)=1188.44`, `RATE` recovers `0.05` from its own `PMT`,
`IRR([-100,60,60])=0.130662`.

## Tests

Extended `test/plugins/spreadsheet/engine/test_financialMath.ts` with pure-function
tests for PV/NPER/RATE/NPV/IRR (Excel-known values, zero-rate branches, PV↔PMT inverse
round-trip, IRR↔NPV zero invariant, empty NPV series, and the RATE/IRR non-convergence
pins). 22 tests total, all pass; verified each new test fails when the covered formula
is mutated.
