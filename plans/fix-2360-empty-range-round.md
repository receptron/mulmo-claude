# fix(spreadsheet): #2360 (remaining) — empty-range AVERAGE / MEDIAN, FLOOR zero significance

Date: 2026-07-24
Issue: #2360, section "2. 空範囲・不正引数で 0 を返す".

## Scope

The last three entries of that section that are still wrong. Everything else in
the section was fixed by #2449 / #2453 / #2485 / #2492 or matches Excel already
— each is listed below with the evidence, so nothing is "fixed" that Excel
actually does.

Errors are returned as the error VALUES introduced by #2492
(`DIV_ZERO_ERROR` / `NUM_ERROR` from `spreadsheet-errors.ts`), never as raw
strings, so `IFERROR` can still tell them from text that spells an error.

## Verified matrix

Current column measured through `SpreadsheetEngine.calculate` on a sheet whose
`A1:A5` is blank (probe run before any edit).

| Function | Input | Current | Excel | Action |
|---|---|---|---|---|
| `AVERAGE` | empty range | `0` | `#DIV/0!` | **fix** |
| `AVERAGE` | text-only range | `0` | `#DIV/0!` | **fix** (same code path — blanks and text are both dropped by the numeric range reader) |
| `MEDIAN` | empty range | `0` | `#NUM!` | **fix** |
| `FLOOR` | `FLOOR(3, 0)` | `0` | `#DIV/0!` | **fix** |
| `CEILING` | `CEILING(3, 0)` | `0` | `0` | skip — Excel's documented asymmetry with FLOOR; pin with a test + comment |
| `MAX` / `MIN` | empty range | `0` | `0` | skip — Excel really does return 0 for MAX/MIN with no numbers |
| `SUM` / `COUNT` | empty range | `0` | `0` | skip — correct |
| `STDEV` / `VAR` | empty / single value | `#DIV/0!` | `#DIV/0!` | skip — fixed by #2453 |
| `MODE` | no repeated value | `#N/A` | `#N/A` | skip — fixed by #2449 |
| `AVERAGEIF` | no matching cell | `#DIV/0!` | `#DIV/0!` | skip — fixed by #2449 |
| `SQRT` | `SQRT(-1)` | `#NUM!` | `#NUM!` | skip — fixed by #2449 |
| `ROUND` | `ROUND(-2.5, 0)` | `-3` | `-3` | skip — already half-away-from-zero (`roundTo` in `math-ops.ts`) |
| `ROUNDUP` | `ROUNDUP(-3.14159, 2)` | `-3.15` | `-3.15` | skip — already away from zero |
| `ROUNDDOWN` | `ROUNDDOWN(-3.14159, 2)` | `-3.14` | `-3.14` | skip — already toward zero |

Excel's own error code differs per function and is not interchangeable:
`AVERAGE` divides by a count of zero (`#DIV/0!`), while `MEDIAN` has no
undefined division — the middle of an empty set simply does not exist, which
Excel reports as `#NUM!`.

## Changes

`src/plugins/spreadsheet/engine/functions/statistical-math.ts`

- Add pure `computeAverage(values)` → `#DIV/0!` when there are no values.
- Add pure `computeMedian(values)` → `#NUM!` when there are no values; sorts a
  copy so the caller's array is untouched.
- `averageHandler` / `medianHandler` in `functions/statistical.ts` call them,
  matching how `computeMode` / `sampleStdev` are already wired.

`src/plugins/spreadsheet/engine/math-ops.ts`

- `floorToSignificance(value, 0)` returns `DIV_ZERO_ERROR` instead of `0`. The
  zero check stays ahead of the sign check so `FLOOR(-3, 0)` is `#DIV/0!` too,
  not `#NUM!`.
- `ceilingToSignificance(value, 0)` keeps returning `0`, now with the reason in
  the comment so the asymmetry is not "tidied up" later.

## Verification

- Failing regression tests first; each one confirmed to go RED with the fix
  reverted (stated per item in the PR).
- The existing `test_mathematicalFunctions.ts` case that pins
  `floorToSignificance(5, 0) === 0` encodes the bug and is updated to the Excel
  answer in the same commit.
- `yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, plus the whole
  spreadsheet engine suite. No package version bumps.
