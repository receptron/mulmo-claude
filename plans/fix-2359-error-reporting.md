# fix #2359 — spreadsheet engine swallows failures into strings; errors[] never populated

## Root cause

`evaluateFormula` (`src/plugins/spreadsheet/engine/evaluator.ts`) wraps its whole body in a
top-level `try/catch` that returns the raw `formula` string on any throw. Because the function
**never throws**, three things follow:

1. `errors[]` only ever receives `"circular"` (pushed from `calculator.ts`, not the evaluator).
2. `calculator.ts`'s per-cell `catch` (the `"unknown"` path) is **unreachable** — its callee cannot throw.
3. `types.ts` error kinds `"div_zero"` / `"invalid_ref"` / `"syntax"` are declared but **emitted nowhere**.

Consequently a failed formula silently lands in the cell as a bare **string** or a wrong **number**
(e.g. `Infinity`), with an empty `errors[]`. The inner `new Function` blocks compound this: each one
`return formula` on failure, so a JS parse error also becomes a bare string.

## Scope

This issue (#2359) is the **error-reporting** hole only. Operator-semantics gaps (`2^3^2`, `<>`, `-2^2`,
`50%`, trailing empty args, char-count `maxIterations`, cross-sheet circular, `strictMode`) are tracked by
the sibling issues (#2356 / #2357 / #2358, split from #2325) and are **out of scope** here. This change
must not regress #2439 / #2440 / #2441 / #2362 (all merged).

## Error matrix — formula → today's silent result → the kind that SHOULD be emitted

| Formula | Today (value / errors[]) | After (value / errors[].type) | Excel |
|---|---|---|---|
| `=1/0` | `Infinity` / `[]` | `#DIV/0!` / `div_zero` | `#DIV/0!` |
| `=A1/A2` (10/0) | `Infinity` / `[]` | `#DIV/0!` / `div_zero` | `#DIV/0!` |
| `=Missing!A1` (sheet absent) | `0` / `[]` | `#REF!` / `invalid_ref` | `#REF!` |
| `=UNKNOWNFN(A1)` | `"UNKNOWNFN(A1)"` (string) / `[]` | `#NAME?` / `syntax` | `#NAME?` |
| `=SUM(A1:A5,B1:B5)` (handler throws maxArgs) | `"SUM(A1:A5,B1:B5)"` (string) / `[]` | `#ERROR!` / `unknown` | (Excel sums both) |
| `=A1+1` where A1 is an error | `"Infinity+1"` / `[]` | propagates A1's error (`#DIV/0!` / `div_zero`) | propagates |
| `=A1` where A1 is an error | shows the error string | unchanged (lone ref reads the value) | shows error |
| circular (`A1=B1+1`, `B1=A1+1`) | one `circular` entry, 0-value | unchanged (circular still works) | `#REF!`/circular |
| `=ZZ999` (empty in-bounds cell) | `0` / `[]` | **unchanged** — 0 is Excel-correct for a blank cell, NOT an error | `0` |
| `=SUM(A1:A3)` (valid) | `6` | unchanged | `6` |
| `=A1+A2` (valid) | `5` | unchanged | `5` |

Note on `=ZZ999`: the issue lists it under "silently returns 0", but referencing an unpopulated
in-bounds cell returning 0 is exactly Excel's behaviour, so it is intentionally left unchanged.

## Design

New pure module `engine/formulaError.ts` (unit-tested in isolation):
- `FORMULA_ERROR_VALUES` map: `div_zero → #DIV/0!`, `invalid_ref → #REF!`, `syntax → #NAME?`, `unknown → #ERROR!`.
- `FormulaError extends Error` carrying `errorType` + `display`; `isFormulaError` type guard.
- Factories: `divZeroError()`, `invalidRefError(ref)`, `nameError(funcName)`, `unknownError()`.
- `isErrorValue(v)` / `errorValueToType(v)` for error **propagation** across references.
- `classifyThrownError(error)` → `{ type, display }` (FormulaError passes through; anything else → unknown / `#ERROR!`).

`evaluator.ts`:
- Remove the over-broad top-level `try/catch`; let real failures throw.
- Unknown whole-formula function call → `throw nameError(...)` (also stops the infinite-recursion-to-string).
- Extract `evalValidatedExpression()`: a `new Function` parse failure → `unknownError()`; a **non-finite**
  arithmetic result → `divZeroError()`. Concat / comparison / arithmetic paths route through it instead of
  `return formula`.
- Substitution loop: if a referenced cell holds an error value, `throw` to propagate it.

`calculator.ts`:
- getRawValue's formula `catch` (now reachable) classifies via `classifyThrownError`, pushes a typed entry,
  and stores the Excel error string as the cell value.
- Missing cross-sheet target → `throw invalidRefError(ref)` instead of returning 0.
- Add an `evaluated` set so string/error results are cached and the top loop routes evaluation through
  the protected `getRawValue` path (no uncaught throw from the top loop; no double-emit for referenced cells).

## Tests
- Characteristic tests pinning CURRENT behaviour first, then flip them to the fixed expectation.
- Per newly-emitted kind (`div_zero`, `invalid_ref`, `syntax`, `unknown`) a regression test, each verified
  RED against the unfixed code.
- Pure-unit tests for `formulaError.ts`.
- Success paths (`=SUM(A1:A3)`, `=A1+A2`, concat, cross-sheet, circular) stay green.
