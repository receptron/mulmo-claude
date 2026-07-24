# fix(spreadsheet): domain/boundary rules for the math functions (#2389)

A bug family — each case returned a plausible number or a silent NaN/∞ instead of
the Excel result/error.

| Function  | Input                      | Before   | Excel / now              |
| --------- | -------------------------- | -------- | ------------------------ |
| FLOOR     | `FLOOR(-2.5, 2)`           | -4       | `#NUM!` (sign mismatch)  |
| CEILING   | `CEILING(2.5, -2)`         | 2        | `#NUM!`                  |
| SQRT      | `SQRT(-1)`                 | NaN      | `#NUM!`                  |
| LN        | `LN(0)` / `LN(-1)`         | -∞ / NaN | `#NUM!`                  |
| LOG10     | `LOG10(0)`                 | -∞       | `#NUM!`                  |
| POWER     | `POWER(-8, 1/3)`           | NaN      | `#NUM!` (no real root)   |
| ROUND     | `ROUND(-2.5, 0)`           | -2       | -3 (half away from zero) |
| ROUNDUP   | `ROUNDUP(-3.14159, 2)`     | -3.14    | -3.15 (away from zero)   |
| ROUNDDOWN | `ROUNDDOWN(-3.14159, 2)`   | -3.15    | -3.14 (toward zero)      |
| MOD       | `MOD(-3, 2)` / `MOD(5, 0)` | -1 / 0   | 1 / `#DIV/0!`            |

## Root cause

- ROUND used `Math.round` (breaks half toward +∞); ROUNDUP/ROUNDDOWN used
  `Math.ceil`/`Math.floor` on the signed value, so they moved the wrong way for
  negatives.
- FLOOR/CEILING never checked that `number` and `significance` share a sign.
- MOD used the JS `%` operator (sign of the dividend) and returned `0` for a zero
  divisor.
- SQRT/LN/LOG10/POWER let NaN/∞ escape instead of the Excel error.

## Fix

Extract the rounding / significance / modulo / domain math into pure helpers in a
new `engine/math-ops.ts` (`roundTo`, `roundUpTo`, `roundDownTo`,
`floorToSignificance`, `ceilingToSignificance`, `modulo`, `power`, `safeLog`,
`safeLog10`, `safeSqrt`), each returning a number or an Excel error string, and
delegate the handlers to them. Rounding is done on the magnitude with the sign
reapplied; MOD is `value - divisor * floor(value / divisor)`.

## Chosen semantics

- Legacy FLOOR/CEILING sign rule (opposite signs → `#NUM!`); same-sign rounding is
  toward/away from zero as before.
- `POWER(negative, non-integer)` → `#NUM!` (matches Excel; no complex roots).

## Tests (test_mathematicalFunctions.ts)

- Pure helpers: rounding direction, FLOOR/CEILING sign domain + zero cases, MOD
  divisor sign + `#DIV/0!`, POWER negative-base domain, SQRT/LN/LOG10 domain.
- End-to-end: the handlers surface `#NUM!` / `#DIV/0!` / the rounded values.
