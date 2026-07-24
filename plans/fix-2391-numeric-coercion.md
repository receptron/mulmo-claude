# fix #2391 — spreadsheet numeric-function coercion

Issue: [#2391](https://github.com/receptron/mulmoclaude/issues/2391) — 数値関数がテキスト・論理値・空範囲を静かに 0 / 先頭値にする.

Root cause: `toNumber` (parseFloat-based, in `engine/registry.ts`) silently coerces
anything unreadable to `0`. Every numeric function leans on it, so text, logicals,
and empty ranges produce plausible-but-wrong answers instead of the Excel error /
value. `MODE` and `AVERAGEIF` have their own silent fallbacks (first value / `0`).

## Scope

IN: the four cases in the issue table (ABS/SIGN coercion, MODE no-repeat,
AVERAGEIF no-match).
OUT (separate in-flight PR #2383): empty-cell aggregation mixing where
AVERAGE / COUNT / MIN / MAX count an empty cell as `0`. This PR does not touch those
handlers' range-reading or their empty-range branches.

## Matrix (function × input × today × Excel × decision)

| Function  | Input                          | Today (buggy)      | Excel      | Decision                                                            |
| --------- | ------------------------------ | ------------------ | ---------- | ------------------------------------------------------------------ |
| ABS       | `ABS(TRUE())`                  | `0`                | `1`        | FIX — scalar coercion: boolean → 1/0                               |
| ABS       | `ABS("abc")`                   | `0`                | `#VALUE!`  | FIX — scalar coercion: non-numeric text → `#VALUE!`               |
| SIGN      | `SIGN(TRUE())` / `SIGN("abc")` | `0` / `0`          | `1` / `#VALUE!` | FIX — same scalar coercion as ABS (issue names ABS/SIGN)     |
| MODE      | `MODE(1,2,3)` (no repeat)      | `1` (first value)  | `#N/A`     | FIX — `#N/A` when the top frequency is < 2                        |
| MODE      | `MODE(1,2,2,3)`                | `2`                | `2`        | keep — most frequent, first-appearing on tie                      |
| AVERAGEIF | `AVERAGEIF(A1:A3,">100")` (0 match) | `0`           | `#DIV/0!`  | FIX — `#DIV/0!` when the match count is 0                         |
| AVERAGEIF | `AVERAGEIF(A1:A3,">1")` (match) | `2.5`             | `2.5`      | keep                                                               |
| toNumber  | `toNumber(true)` / `("abc")`   | `0` / `0`          | (n/a — internal) | PIN — leave the engine-wide lenient helper unchanged; used by SUM/AVERAGE/COUNTIF/MAX/MIN/financial. Characteristic tests lock it. |
| SUM       | text cell in range             | contributes `0`    | ignored    | PIN — lenient toNumber path unchanged (equivalent net effect)     |

## Design

Blast radius is the whole point of the issue's caution. The fix keeps the two
concerns apart:

- `engine/numericCoercion.ts` (new, pure):
  - `parseNumericString(str): number | null` — the engine's long-standing lenient
    string read (`%`, `$`, thousands, then bare `parseFloat`), returning `null`
    instead of `0` when nothing parses. `registry.toNumber` is re-implemented on
    top of it (behaviour-identical — DRY, removes the duplicated branch ladder).
  - `toScalarNumber(value): number | string` — strict scalar coercion for
    single-value math functions: boolean → 1/0, numeric text parses, non-numeric
    text → `#VALUE!`. Contained: applied ONLY to ABS and SIGN.
  - `VALUE_ERROR` sentinel.
- `engine/functions/statistical-math.ts` (new, pure): `computeMode(values)` plus
  `NA_ERROR` / `DIV_ZERO_ERROR`. MODE's "top frequency < 2 → #N/A" rule is the
  silent-failure rule worth unit-testing directly.
- `engine/functions/mathematical.ts`: ABS/SIGN return the `#VALUE!` string when
  `toScalarNumber` cannot read the argument, else `Math.abs` / `Math.sign`.
- `engine/functions/statistical.ts`: `modeHandler` → `computeMode`; `averageifHandler`
  no-match → `DIV_ZERO_ERROR`.

The global `toNumber` is deliberately NOT changed — SUM / AVERAGE / COUNTIF / MAX /
MIN / financial keep their lenient reads. Whether to extend `toScalarNumber` to
every scalar math function (ROUND, POWER, SQRT, MOD, …) engine-wide is flagged in
the PR's "Items to Confirm", not decided here.

## Tests (red-verified)

- `test_numericCoercion.ts` — `parseNumericString`, `toScalarNumber` (new
  behaviour), and pinned `toNumber` characteristics (boolean → 0, text → 0).
- `test_statisticalMath.ts` — `computeMode` (no-repeat → `#N/A`, tie, single, empty).
- `test_numericFunctions2391.ts` — the four scenarios end-to-end through the engine,
  plus pins that the out-of-scope lenient paths (SUM/AVERAGE over text) are unchanged.

Red-verification: revert each handler change, confirm its regression test fails,
restore.

## Verify

`yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, spreadsheet engine tests.
No package version bumps.
