# fix(spreadsheet): IF evaluates its chosen branch through the engine (#2360)

Two of the "静かに間違う" cases from #2360, both in `ifHandler`.

| formula (A1 = 4.567 / 3)   | before                    | Excel / now |
| -------------------------- | ------------------------- | ----------- |
| `IF(A1>0, ROUND(A1,1), 0)` | `"ROUND(4.567,1)"` (text) | `4.6`       |
| `IF(TRUE, UPPER(A1), "x")` | `"UPPER(hi)"` (text)      | `"HI"`      |
| `IF(A1>0, A1+1, 0)`        | `3`                       | `4`         |

## Root cause

`ifHandler` re-implemented evaluation for the branch it picked:

1. A hard-coded whitelist — `/^(SUM|AVERAGE|MAX|MIN|COUNT|IF|AND|OR|NOT)\(/` — decided
   what counted as a nested call. Every other registered function (ROUND, UPPER,
   VLOOKUP, TODAY, CONCATENATE …) fell through and was returned as its own text.
   IF's own registered example, `IF(B2>=5, SUM(C1:C10), 0)`, worked only because
   SUM happened to be on the list; the documented `ROUND` case did not.
2. The fallback then substituted cell refs by regex and finished with
   `parseFloat(expr)`. `parseFloat("3+1")` is `3`, so any arithmetic branch lost
   everything after the first operator.

Both failures return a plausible value, so nothing surfaces the error.

## Fix

Delete the whitelist and the hand-rolled fallback; hand the branch to
`context.evaluateFormula`, which already resolves nested calls, references and
arithmetic everywhere else in the engine. A quoted string branch keeps its
existing unquote path (it is text, not a formula).

Net effect: ~18 lines of duplicated evaluation removed from `ifHandler`.

## Tests (`test_ifBranchEvaluation.ts`)

- Nested calls: a function the whitelist omitted (ROUND), a text function
  (UPPER), one it did cover (SUM), a nested `IF`, and the false branch not
  evaluating the true one.
- Arithmetic: `A1+1`, a bare reference, a numeric literal.
- A quoted string branch still unwraps.

Verified the tests go red against the old whitelist + `parseFloat` fallback
(3 failures), and the full engine suite stays green (652 tests).

## Not covered here

The remaining #2360 divergences measured on current `main` — `MID` negative
length, `COUNTIF` case-insensitivity and wildcards, `SUM` over multiple ranges,
`TEXT` digit grouping, `VLOOKUP` out-of-range column, `VALUE("12abc")` — are
untouched and stay tracked in #2360.
