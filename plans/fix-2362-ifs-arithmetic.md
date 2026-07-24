# fix(spreadsheet): compute arithmetic in IFS condition operands (#2360)

## Problem

`=IFS(A1+1>10, "hit", TRUE, "miss")` with `A1=5` returned `"hit"`. After ref
substitution the condition is `5+1>10`, but the parse-based condition evaluator
read the left side as the _text_ `"5+1"` and compared it to `10` with
`localeCompare`, flipping the branch. `IF` (which still uses the engine)
evaluated the same condition correctly — a regression introduced when #2360
removed `eval` from `IFS`.

## Root cause

`evaluateCondition` resolves each operand with `readOperand`, which reads a bare
string / number / boolean but does not compute arithmetic sub-expressions.

## Fix

Add `evaluateConditionValues(condition, evaluate)` to `condition.ts`: same
quote-aware top-level comparison split as `evaluateCondition`, but each operand
is resolved by an injected `evaluate` callback. `IFS` passes
`context.evaluateFormula`, so `5+1` is computed to `6` by the engine's existing
safe arithmetic path. The condition is still never run as code — only the two
resolved values are compared with the same `applyOperator`.

This keeps `condition.ts` pure (the evaluator is injected) and does not
reintroduce `eval`: `evaluateFormula` validates arithmetic strictly and returns
quoted cell text as a plain string (an injected `"globalThis.x=1"` stays text).

## Tests

- `test_ifsInjection.ts`: `A1+1>10` / `A1+1>5` compute correctly; arithmetic on
  both sides (`A1*2 > 3+3`).
- All prior IFS behaviour preserved: operator-in-cell text, absolute/mixed refs,
  refs inside string literals, and the injection guards (524 engine tests pass).
