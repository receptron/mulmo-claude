# fix(#2332): cross-sheet reference breaks date cells

## Symptom

Referencing a date cell on another sheet does not resolve it as a date.

```
Data!A1 = "03/04/2025"
Summary = [ "=DAY(Data!A1)", "=Data!A1" ]

actual:   [2, 3]
expected: [4, "03/04/2025"]   (same as the identical same-sheet formula)
```

`=Data!A1` returns `3` — `parseFloat("03/04/2025")` reads only the leading `03`.
`=DAY(Data!A1)` returns `2` because serial `3` is 1900-01-02.

Same-sheet is correct: `A1="03/04/2025"`, `=DAY(A1)` → `4`, `=A1` → `"03/04/2025"`.

## Root cause

`calculateSheet` runs a **final display-formatting pass** (calculator.ts, the second
row/col loop) that turns date **serial numbers** into **display strings**
(`45720` → `"03/04/2025"`) for any cell carrying a date format code `f`.

- **Same-sheet** references read the current sheet's `calculated` array *during* the
  main evaluation loop, i.e. **before** that formatting pass runs, so they see the raw
  serial `45720`.
- **Cross-sheet** references resolve the target sheet by recursively calling
  `calculateSheet(...)` and reading `.data` — the **fully formatted** output. The date
  cell is now the string `"03/04/2025"`, which `getRawValue` feeds to `parseFloat` → `3`.

So cross-sheet consumes a *presentation* value as *data*. Currency/percentage/comma
formats survive by luck (`getRawValue` strips `$ , %`); dates have no such recovery.
Formula-produced dates on the target sheet hit the same bug via auto-date-format.

## Fix

Cross-sheet target computation must return the **raw calculated values**, not the
display-formatted ones — making cross-sheet consistent with same-sheet.

- Add an internal `skipFormatting?: boolean` to `CalculateOptions`.
- Extract the per-cell display-formatting decision into a pure, tested function
  `formatCellForDisplay(originalCell, calculatedValue, preferDDMMYYYY)` and its
  date-serial predicate `isLikelyDateSerial(value)`.
- Guard the final formatting pass with `skipFormatting`.
- Pass `skipFormatting: true` in the two cross-sheet recursive `calculateSheet` calls
  (`getCellValue`, `collectRangeValues`).

The consuming formula cell (`=Data!A1`) still auto-date-formats its own numeric result,
so the final displayed output matches same-sheet exactly (`"03/04/2025"`).

Same-sheet behaviour is untouched (it never used the formatted target output).

## Tests

- Regression (via `SpreadsheetEngine`): `=DAY(Data!A1)` → `4`, `=Data!A1` equals the
  identical same-sheet formula; must go red without the fix.
- Boundary cross-sheet reads: date, number, string, empty cell, and a
  formula-producing cell on the source sheet.
- Unit tests for `isLikelyDateSerial` / `formatCellForDisplay` (date, number, string,
  empty, formula, no-format).

## Notes

- Only one copy of the engine exists (`src/plugins/spreadsheet/engine/`). No
  `packages/mulmoclaude/**` mirror is present in the tree — nothing to keep in sync.
- Change is localized to `calculator.ts` + `types.ts` (+ a small pure helper file).
  Does not touch `evaluator.ts` or `functions/lookup.ts` (owned by parallel sessions).
