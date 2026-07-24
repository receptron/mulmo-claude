# fix(spreadsheet): TEXT honours digit grouping and the format's decimals (#2360)

Last open item of #2360: `TEXT(1234.5,"$#,##0.00")` returned `"$1234.50"` (no digit
grouping), `TEXT(0.5,"0%")` returned `"50.00%"` and `TEXT(5,"$0")` returned `"$5.00"` —
the `$` / `%` branches hard-coded two decimals instead of reading the pattern.

Measured on `origin/main` before the change:

| formula                    | before     | Excel       |
| -------------------------- | ---------- | ----------- |
| `TEXT(1234.5,"$#,##0.00")` | `$1234.50` | `$1,234.50` |
| `TEXT(0.5,"0%")`           | `50.00%`   | `50%`       |
| `TEXT(5,"$0")`             | `$5.00`    | `$5`        |
| `TEXT(1234567,"#,##0")`    | `1234567`  | `1,234,567` |
| `TEXT(-1234.5,"#,##0.00")` | `-1234.50` | `-1,234.50` |

## Blast radius — who renders numbers, and what changed

A previous PR deferred this item because `engine/formatter.ts`'s `formatNumber` already
implements grouping/precision/negatives and is **also the cell display path**. Callers:

| caller                                                                               | reaches                                     | changed? |
| ------------------------------------------------------------------------------------ | ------------------------------------------- | -------- |
| `engine/cellFormatting.ts:50` `formatCellForDisplay` → `formatNumber(value, cell.f)` | every cell carrying an explicit format code | no       |
| `engine/cellFormatting.ts:55` → `formatNumber(serial, "DD/MM/YYYY" \| "MM/DD/YYYY")` | date-serial autoformat                      | no       |
| `engine/calculator.ts:429` → `formatCellForDisplay`                                  | every cell of every calculated sheet        | no       |
| `engine/functions/text.ts` `textHandler`                                             | the TEXT function only                      | **yes**  |

Coverage that pins cell display, all still green and unmodified:

- `test/plugins/spreadsheet/engine/test_formatter.ts` — 30 assertions incl.
  `formatNumber(0.5,"0%") === "50.00%"` and `formatNumber(1234.5,"$#,##0.00") === "$1,234.50"`.
- `test/plugins/spreadsheet/engine/test_cellFormatting.ts`, `test_errorValue.ts`.
- `e2e/tests/spreadsheet.spec.ts:194` (`$#,##0.00` cell renders `$1,234.50`) and `:208`
  (`0.00%` cell renders `25.00%`). Neither is affected — no e2e snapshot needed updating.

## Approach

TEXT gets its own pattern interpreter; the display path is untouched.

- New pure module `src/plugins/spreadsheet/engine/textFormat.ts` exporting
  `formatWithPattern(value, pattern): string | null` and `parseNumberPattern(pattern)`.
- `text.ts`'s `textHandler` parses its two args and delegates; `null` (a pattern the
  module does not render) falls back to the previous `toString(value)`.
- The one piece genuinely shared is digit grouping: the identical hand-rolled loop
  appeared **twice** in `formatter.ts`. Extracted as `groupThousands(digits)` there
  (behaviour-identical, verified by the existing formatter tests) and imported by
  `textFormat.ts`.

Why not delegate TEXT to `formatNumber`: the two disagree on defaults. `formatNumber`'s
percent branch defaults to 2 decimals, so `"0%"` renders `"50.00%"` — pinned by
`test_formatter.ts` and shipped in stored workbooks. Making TEXT correct through that
function would silently reformat every `0%` cell. The correct Excel default belongs to
TEXT; changing cell display is a separate decision, out of scope here.

## Format tokens supported / not

Supported: `#` and `0` digit placeholders, `#,##0` grouping, `0.00` fixed decimals,
`0.##` optional decimals (trailing zeros trimmed to the `0` count), leading zero padding
(`000` → `005`), a leading literal (`$`, `USD `), a trailing literal (` kg`), and `%`
(scales by 100, decimals from the pattern). The sign prefixes the whole rendering
(`-$1,234.50`) and follows the **rounded** digits, so `-0.001` under `0.00` is `"0.00"`
rather than `"-0.00"` — a deliberate deviation, pinned as a test.

Not supported — `parseNumberPattern` returns `null` and TEXT keeps its old fallback
(`String(value)`), rather than inventing a plausible wrong string:

- multi-section patterns `positive;negative;zero;text` (`;`)
- date/time tokens (`MM/DD/YYYY`) — no digit placeholder, so they fall through as before
- scientific `0.00E+00`, fractions `# ?/?`, quoted literals `0" units"`, fill `*`, skip `_`,
  text placeholder `@`, locale prefixes `[$-409]`
- thousands scaling (a comma **after** the last placeholder, `#,##0,`) — rendering it as
  ordinary grouping would be off by 1000
- non-finite values

## Tests

New `test/plugins/spreadsheet/engine/test_textFormat.ts` (47 assertions): the three issue
cases, grouping boundaries (999 / 1000 / 1234567 / a carry across 999.5), negatives, zero,
rounding, fixed vs optional decimals, integer padding, percent, literals, every declined
pattern above, `parseNumberPattern` shape, `groupThousands`, plus the end-to-end path
through `SpreadsheetEngine` (literal and cell-reference arguments).

Mutation check (revert → red → restore):

1. reverting `textHandler` to `origin/main` → **6** end-to-end tests red.
2. forcing `useGrouping: false` in the pure module → **14** red.
3. defaulting the decimal counts to 2 (the original bug) → **15** red, incl. the two
   `TEXT(0.5,"0%")` / `TEXT(5,"$0")` cases.

No existing test pinned the old wrong output: the full engine suite
(`tsx --test test/plugins/spreadsheet/engine/*.ts`) is 767 pass / 0 fail with nothing
updated. `npx tsc --noEmit` clean.
