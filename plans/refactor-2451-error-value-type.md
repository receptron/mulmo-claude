# refactor(spreadsheet): formula errors as a distinct value type (#2451)

## Problem

Formula errors were plain strings. At the value level a real error and text that
merely spells one were the same thing:

| formula                           | before          | after        |
| --------------------------------- | --------------- | ------------ |
| `IFERROR(SQRT(-1), 42)`           | `42` ✅         | `42`         |
| `IFERROR("#NUM!", 42)`            | `"#NUM!"` ✅ \* | `"#NUM!"`    |
| `IFERROR(CONCAT("#N","UM!"), 42)` | `42` ❌         | `"#NUM!"` ✅ |

\* only because `iferrorHandler` exempted a _syntactically_ quoted argument
(`isQuotedLiteral`, #2432). A COMPUTED string carried no such signal, so it was
swallowed. That is the case this refactor fixes.

## Shape chosen

A small class in `src/plugins/spreadsheet/engine/spreadsheet-errors.ts`:

```ts
export class SpreadsheetError {
  constructor(readonly code: SpreadsheetErrorCode) {}
  toString(): string {
    return this.code;
  }
  toJSON(): string {
    return this.code;
  }
}
```

Why a class rather than a branded object literal (`{ __spreadsheetError: … }`):

- `instanceof` gives a one-line guard with no property-name convention to keep
  in sync, and no chance a decoded JSON object accidentally satisfies it.
- `toString()` means every place the engine already coerces a cell value to text
  (`toString(value)`, `String(value)`, template literals) keeps producing
  `#NUM!` with no extra branch.
- `toJSON()` means an error that somehow reached a serializer becomes `"#NUM!"`
  rather than `{}`.

**Interning**: one instance per code (`spreadsheetError(code)` + the named
`NUM_ERROR` / `DIV_ZERO_ERROR` / … exports). Two errors of the same kind
therefore compare `===`, exactly as the strings did — which the condition
comparison path (`applyOperator`'s `left === right`) and the existing pure-helper
tests rely on.

`#ERROR!` (the engine's own catch-all, previously listed only in
`formulaError.ts`) is folded into `SPREADSHEET_ERRORS`, so there is now ONE
taxonomy. `formulaError.ts`'s duplicate `RECOGNIZED_ERROR_VALUES` /
`isErrorValue` are gone.

### Types

`types.ts` now distinguishes the two:

```ts
export type StoredCellValue = number | string | boolean; // serialized to JSON
export type CellValue = StoredCellValue | SpreadsheetError; // computed
export interface SpreadsheetCell {
  v: StoredCellValue;
  f?: string;
}
```

An error is a COMPUTED value only. `SpreadsheetCell.v` stays `StoredCellValue`,
so nothing can write an error into the workbook JSON.

## Every function switched

| File                            | Switched to the error value                                                                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `math-ops.ts`                   | `floorToSignificance`, `ceilingToSignificance`, `modulo`, `power`, `safeLog`, `logWithBase`, `safeLog10`, `safeSqrt`                         |
| `datedif.ts`                    | `computeDatedif` (start after end, unknown unit)                                                                                             |
| `numericCoercion.ts`            | `toScalarNumber` (`#VALUE!`); its `VALUE_ERROR` moved to `spreadsheet-errors.ts`                                                             |
| `functions/statistical-math.ts` | `computeMode`, `sampleVariance`, `sampleStdev`; its `NA_ERROR` / `DIV_ZERO_ERROR` moved                                                      |
| `functions/statistical.ts`      | `AVERAGEIF` with no match → `#DIV/0!`                                                                                                        |
| `functions/text.ts`             | `normalizeCharCount`, `takeLeft`, `takeRight`, `substituteText`, `FIND`, `SEARCH`, `VALUE`                                                   |
| `functions/lookup.ts`           | `VLOOKUP` / `HLOOKUP` / `MATCH` no-match → `#N/A`, `INDEX` out of range → `#REF!`, `XLOOKUP` default `if_not_found` and fallthrough → `#N/A` |
| `functions/logical.ts`          | `IFS` with no matching branch → `#N/A`                                                                                                       |
| `functions/mathematical.ts`     | `ABS` / `SIGN` pass the error value through instead of a string                                                                              |
| `calculator.ts`                 | a thrown `FormulaError` stores the error VALUE in the cell (so a cell reading it sees an error)                                              |

Adjacent guards that had to learn the new variant (behaviour pinned, not
changed): `coerce-boolean.ts` (an error is truthy, as the string was),
`functions/lookup-math.ts` (`isApproximateMatch` reads an error as FALSE),
`condition.ts` / `evaluator.ts` renderers (quote the code).

## Display / serialization touch points

- `cellFormatting.formatCellForDisplay` — renders an error value to its code
  first; its return type is now `StoredCellValue`, making it the explicit
  boundary where a computed value becomes what the cell shows and the workbook
  serializes.
- `calculator.calculateSheet` — the final display pass (skipped for cross-sheet
  resolution, which must keep the raw error so it can propagate).
- `SpreadsheetError.toJSON()` — belt and braces for any other serializer.
- `evaluator.renderOperand` / `condition.renderConditionOperand` — an error
  substituted into an expression/condition renders as its QUOTED code.
- `engine/index.ts` re-exports `spreadsheet-errors` so UI consumers can render
  the variant.

## Provenance-aware checks

- `isErrorResult` (what IFERROR catches) → the error VALUE, NaN/∞, null. **Not**
  a look-alike string.
- `ifnaHandler` → `isSpreadsheetErrorValue(result) && result.code === NA_ERROR.code`.
- Nested-call substitution in `evaluator` → propagates only for the error VALUE,
  so `CONCAT("#N","UM!") & "!"` stays ordinary text.
- Cell-reference substitution in `evaluator` → uses `errorCodeOf`, which accepts
  the error value OR a cell whose STORED TEXT spells a code. Deliberate: #2359
  made a literal `#REF!` in a cell poison the arithmetic that reads it, and
  arithmetic over such text is never meaningful. Provenance matters for
  IFERROR/IFNA, not for "can I add 1 to this".

## `isQuotedLiteral` removed

Yes. `IFERROR("#NUM!", 42)` now returns `"#NUM!"` because a string literal is
simply not an error value — no syntactic exemption needed. The workaround was
also wrong in a way nobody had noticed: it matched anything starting and ending
with a quote, so `IFERROR("#N" & "UM!", 42)` was exempted by accident, and
`IFERROR("x" & SQRT(-1), 42)` would have been exempted for a real error.

## Headline case (observed)

```
before:  =IFERROR(CONCAT("#N","UM!"), 42)  →  42        ← wrong
after:   =IFERROR(CONCAT("#N","UM!"), 42)  →  "#NUM!"   ← correct
```

Pinned in `test/plugins/spreadsheet/engine/test_errorValue.ts`
("does not catch COMPUTED text that spells an error"). Verified load-bearing by
mutation: restoring the string check to `isErrorResult` turns 4 tests red.

## Other behaviour changes (improvements, not preservation)

Both were garbage before and are now the Excel answer:

```
=SQRT(-1)+1     before: "\"#NUM!\"+1"   after: #NUM!
=SQRT(-1)&"x"   before: "#NUM!x"        after: #NUM!
```

`isSpreadsheetError("#ERROR!")` is now `true` (the two taxonomies were merged).

## Tests

- New `test/plugins/spreadsheet/engine/test_errorValue.ts` (25 tests): the guard,
  interning, `isErrorResult` value-vs-string, the display pass, functions
  returning the value, IFERROR provenance incl. the headline case, IFNA by code.
- Updated in place: `test_spreadsheetErrors`, `test_formulaError`,
  `test_mathematicalFunctions`, `test_datedif`, `test_statisticalMath`,
  `test_numericCoercion`, `test_textFunctions` — pure helpers now compare against
  the error VALUE, end-to-end assertions still compare against the code STRING.
- Full engine suite: 688 pass (was 661).
