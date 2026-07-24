# fix(spreadsheet): MID bounds and VALUE whole-string parsing (#2360)

Two more silent-wrong-answer cases from #2360.

| formula             | before | Excel / now |
| ------------------- | ------ | ----------- |
| `MID("Hello",3,-1)` | `"e"`  | `#VALUE!`   |
| `VALUE("12abc")`    | `12`   | `#VALUE!`   |

## Root cause

- **MID** passed its raw arguments to `String.prototype.substring`, which
  **swaps** its bounds when they are reversed. A negative count therefore read
  _backwards_ from the start position and returned earlier characters — a
  plausible-looking substring rather than an error. The 1-based start was also
  unvalidated, so `0` and negatives silently shifted the window.
- **VALUE** finished with `parseFloat`, which stops at the first character it
  cannot read and returns the prefix. `VALUE("12abc")` became `12`.

## Fix

- `takeMid(text, start, count)` — validates through the existing
  `normalizeCharCount` (non-finite / negative count → `#VALUE!`, fractional
  truncates toward zero) and requires `start >= 1`.
- `parseValueText(raw)` — strips currency symbols and thousands separators, then
  requires the **whole** remainder to match a decimal/scientific pattern before
  converting (not `parseFloat`, which returns the readable prefix); a trailing
  `%` is read as a fraction, and an empty string is an error rather than
  `Number("") === 0`.

  Two guards, because `Number` alone is too permissive in two different ways:
  the pattern rejects JS-only spellings (`0x10` → 16, `0b10` → 2, `1_000`, the
  literal `Infinity`), and a finiteness check rejects an exponent that matches
  the pattern but overflows (`1e999` → `Infinity`).

Both are exported pure functions, so the rules are testable without the engine.

## Note

`VALUE_ERROR` is the `SpreadsheetError` **value** introduced by #2451/#2492, not
a string — the guard is `isSpreadsheetErrorValue`, and the return types are
`string | SpreadsheetError` / `number | SpreadsheetError`. (Writing
`typeof x === "string"` here compiles but never matches; `tsc` catches it once
the return type is declared.)

## Tests

`test_midValue.ts`: MID negative / non-finite / start < 1 / normal / overrun /
zero / fractional; VALUE trailing text, empty, plain, currency, percent,
JS-only syntaxes, overflowing exponent, decimal/scientific; plus both surfacing
through `SpreadsheetEngine`. Full engine suite green (737).

Mutation-checked, each guard separately — restoring the raw `substring` and
`parseFloat` turns six red; dropping the decimal pattern reds the JS-syntax
test; dropping the finiteness check reds the overflow test. The finiteness
check needs its own case because the pattern already rejects the literal
`Infinity` spelling, so without an overflow input the guard tests green when
deleted.

## Still open in #2360

`TEXT` digit grouping (`TEXT(1234.5,"$#,##0.00")` → `"$1234.50"`), `VLOOKUP`
out-of-range column (`0` instead of `#REF!`).
