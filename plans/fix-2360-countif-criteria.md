# fix(spreadsheet): COUNTIF/SUMIF criteria match case-insensitively, with wildcards (#2360)

Two more "静かに間違う" cases from #2360 — both **undercount** without any error.

| criteria                | cell   | before                      | Excel / now |
| ----------------------- | ------ | --------------------------- | ----------- |
| `COUNTIF(range, "yes")` | `Yes`  | 0 (no match)                | 1           |
| `COUNTIF(range, "A*")`  | `Axle` | 0 (`A*` compared literally) | 1           |

## Root cause

`parseCriteria` (engine/registry.ts) finished with `String(v) === trimmedCriteria`:
a case-sensitive, literal comparison. Excel matches criteria text
case-insensitively and treats `*` / `?` as wildcards (`~` escapes them). The
`=` / `<>` operator branches had the same literal comparison.

## Fix

Build the text test once per criteria with `textMatcher`:

- `*` → any run of characters, `?` → exactly one, `~X` → literal `X`.
- every other character is regex-escaped, so `a.c` matches only `a.c`.
- the regex is anchored and case-insensitive (`iu`).

`matchesTextOrNumber` combines it with the existing numeric equality, and both
the bare-criteria path and `=` / `<>` use it (`<>` is its exact negation), so
one rule covers every criteria form.

## Behaviour changes to note

- **VLOOKUP/HLOOKUP exact-match lookups also go through `parseCriteria`**
  (`functions/lookup.ts`), so they are now case-insensitive and wildcard-aware —
  which is also Excel's behaviour for an exact-match lookup.
- Two tests in `test_registry.ts` pinned the OLD behaviour as a documented
  limitation ("treats a wildcard as a literal character", "matching is
  case-sensitive"); both are updated to the Excel behaviour.

## Tests

`test_criteria.ts` (new): case-insensitive match, non-match, `*` / `?` / `~`
escape, regex metacharacters staying literal, numeric criteria, the comparison
operators, `=` / `<>` case-insensitivity, and COUNTIF end-to-end through
`SpreadsheetEngine`. Verified 7 of the 11 go red against a case-sensitive,
literal matcher. Full engine suite green (672).

## Still open in #2360

`MID` negative length, `SUM` over multiple ranges, `TEXT` digit grouping,
`VLOOKUP` out-of-range column, `VALUE("12abc")`.
