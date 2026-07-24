# refactor(#2395): extract the evaluator's Excel→JS translation into a pure module

## Issue

[#2395](https://github.com/receptron/mulmoclaude/issues/2395) — `evaluator.ts` turns an Excel
expression into a JS expression and hands it to `new Function`. That translation is pure string
processing but was inline and untested, and it is where the operator gaps reported in #2359 live
(`2^3^2` = 512 not 64, `<>` unsupported, the non-overlapping `=`→`==` replace).

## Scope

This is a **behaviour-preserving refactor**. It extracts the operator-translation string transforms
into a pure, testable module and pins the CURRENT behaviour — including the known-wrong cases — with
a characterization test suite. It does **not** fix the operator gaps; that belongs to #2359 / #2360
and shows up later as a visible diff against these pinned tests.

Deliberately out of scope to keep the change minimal and merge-clean against the parallel #2332
cross-sheet work in `evaluator.ts`: the function-call parenthesis matching and the cell-reference
substitution logic are left untouched. `renderOperand`, `maskStringLiterals`, `isSafeConcatExpression`,
`findCellRefs`, `endOfStringLiteral` were already extracted by earlier PRs (#2357 / #2376) and stay put.

## New module — `engine/translateFormula.ts` (pure, no engine/evaluator state)

| Function | Replaces (was inline in `evaluateFormula`) |
|---|---|
| `caretToPow(expr)` | `expr.replace(/\^/g, "**")` |
| `replaceConcatOperator(expr)` | the `&`→`+` char-walk loop (string-literal aware) |
| `rewriteComparisonEq(expr)` | `expr.replace(/([^<>!])=([^=])/g, "$1==$2")` |
| `isSafeArithmetic(expr)` | `/^[\d+\-*/(). ]+$/.test(expr)` |
| `isSafeComparison(expr)` | `/^[\d+\-*/(). <>!=]+$/.test(expr)` |

`replaceConcatOperator` faithfully reproduces the previous loop (backslash-escape aware quote
tracking) so the `&`-inside-a-literal behaviour is byte-for-byte identical.

## evaluator.ts edits (localized to the translation region of `evaluateFormula`)

- add one import from `./translateFormula`
- four call-site swaps in the lower half of `evaluateFormula` (`^` rewrite, concat loop, comparison
  guard + `=` rewrite, arithmetic guard). No change to reference detection / substitution / function
  replacement — the region #2332 touches.

## Tests — `test/plugins/spreadsheet/engine/test_translateFormula.ts`

Unit tests for every pure function (happy / edge / boundary / empty / invalid), plus end-to-end
characterization through `SpreadsheetEngine`. Known-wrong behaviours pinned with a `(#2359)` note so a
later fix is a reviewed flip: `2^3^2`→`2**3**2` (=512), `5=6=7`→`5==6=7`, `5=`→`5=`, `5==6`→`5===6`,
`=5<>6`→`"5<>6"`. RED-verified: reverting `**`→`*` and dropping the in-literal `&` guard turned 7
tests red.

## Verification

`yarn format`, `yarn lint` (0 errors), `yarn typecheck` (0 errors), `yarn build`, and the 345
spreadsheet engine tests — all green. No package version bumped.
