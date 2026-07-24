# fix(spreadsheet): VLOOKUP / HLOOKUP index bounds (#2360)

| formula (table `A1:B2`)      | before                                | Excel / now |
| ---------------------------- | ------------------------------------- | ----------- |
| `VLOOKUP("a",A1:B2,9,FALSE)` | `0`                                   | `#REF!`     |
| `VLOOKUP("a",A1:B2,0,FALSE)` | value of the column left of the table | `#REF!`     |
| `HLOOKUP("a",A1:B2,9,FALSE)` | `0`                                   | `#REF!`     |

## Root cause

Both handlers computed the result cell straight from the caller's 1-based index:

```ts
const resultColStr = indexToColumn(bounds.startCol + colIndexNum - 1);
```

With no bounds check, an index past the table addressed a cell OUTSIDE the
range and returned whatever lived there — for an empty cell that is `0`, which
reads like a real answer. A `0` or negative index walked backwards off the left
edge the same way.

`INDEX` already had this guard (`resolveIndexTarget`, added in #2390); VLOOKUP
and HLOOKUP were the two that never got it.

## Fix

Export `resolveTableOffset(position, size)` from `formulaRefs.ts` — a thin name
over the existing `lineOffset` that INDEX's guard already uses, so all three
functions share one rule (1-based, truncates toward zero, null outside the
line). VLOOKUP checks it against the table's width, HLOOKUP against its height,
and both return `REF_ERROR` when it is null.

## Behaviour preserved

- An in-range index returns the same value as before, including column 1 (the
  key column itself).
- A missing key is still `#N/A` — a lookup that finds nothing is not a `#REF!`.

## Tests

`test_lookupBounds.ts`: `resolveTableOffset` directly (in-range, past the end,
zero, negative, non-finite, fractional) plus VLOOKUP/HLOOKUP through the engine
for out-of-range, zero/negative, in-range, and the unchanged `#N/A`.
Mutation-checked — removing the VLOOKUP guard turns two red. Full engine suite
green (720).

## Still open in #2360

`TEXT` digit grouping (`TEXT(1234.5,"$#,##0.00")` → `"$1234.50"`), which needs
the shared `formatter.ts` and carries e2e-snapshot risk — deliberately left for
its own change.
