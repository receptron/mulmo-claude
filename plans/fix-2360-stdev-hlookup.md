# fix(spreadsheet): #2360 (partial) — STDEV/VAR sample estimator + HLOOKUP/VLOOKUP approximate match

Date: 2026-07-24
Issue: #2360 (partial — this PR fixes only the two items below; the IF / IFERROR
items stay open under the #2362 / #2448 line to avoid touching `logical.ts`).

## Scope

Two mismatches from the #2360 table, plus their tests. Nothing else in the
issue is touched here.

Excluded on purpose (other open PRs own these): `functions/logical.ts`
(IF / IFERROR — #2431 / #2448), `functions/mathematical.ts` (#2432), and the
error-value representation refactor (#2451). Excel error strings are returned
the same way the current code already does (`"#DIV/0!"`, `"#N/A"`).

## 1. STDEV / VAR use population (n) instead of sample (n-1)

`src/plugins/spreadsheet/engine/functions/statistical.ts`

- Current: `variance = Σ(x-μ)² / n` — that is the POPULATION estimator (Excel's
  `STDEVP` / `VARP`), and empty input silently returns `0`.
- Excel: `STDEV` / `VAR` are the SAMPLE estimators — divide by `n - 1`. With
  fewer than two values there is no `n - 1` to divide by, so Excel returns
  `#DIV/0!`.
- `STDEVP` / `VARP` are not registered in this engine, so nothing there changes.

Fix: extract pure `sampleVariance(values)` / `sampleStdev(values)` into
`functions/statistical-math.ts` (same pattern as the existing `computeMode`),
returning `DIV_ZERO_ERROR` when `values.length < 2`. Handlers call them.

Characterization: `STDEV({2,4,4,4,5,5,7,9})` = 2.138… (sample) vs 2.0
(population). Boundary: single value / empty → `#DIV/0!`.

## 2. HLOOKUP / VLOOKUP 4th arg TRUE behaves as exact

`src/plugins/spreadsheet/engine/functions/lookup.ts`

- Current: `isApproximate(rangeLookup)` accepts only `true | 1 | "1"`. The
  literal `TRUE` reaches the handler as the STRING `"TRUE"` (the evaluator
  leaves bare words unquoted), so `HLOOKUP("Axles", A1:C10, 2, TRUE)` silently
  falls back to `matchType = 0` (exact) and returns `#N/A`.
- Excel: TRUE / omitted → approximate match (largest first-row/col value ≤ the
  lookup key in a sorted range); FALSE → exact.

Fix: extract a pure `isApproximateMatch(rangeLookup)` into
`functions/lookup-math.ts` that reads the range_lookup argument the way Excel
coerces a logical: boolean as-is, non-zero number → TRUE, and the strings
`"TRUE"` / `"1"` → TRUE, `"FALSE"` / `"0"` / blank → FALSE (case-insensitive).
The existing `findMatchIndex(matchType = 1)` already implements largest-≤ and
returns `-1` (→ `#N/A`) below the smallest key, so only the argument reading is
wrong.

Characterization (through the engine): approximate VLOOKUP/HLOOKUP with an
explicit `TRUE` returns the largest-≤ match. Boundaries: below smallest key →
`#N/A`; `FALSE` exact path unchanged.

## Verification

- Add failing characterization tests first, confirm each fails when the fix is
  reverted (stated in the PR).
- `yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, spreadsheet
  engine tests all green. No package version bumps.
