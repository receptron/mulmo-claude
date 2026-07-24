# fix(spreadsheet): aggregates accept several arguments, as Excel does (#2360)

`SUM(A1:A5, B1:B5)` — ordinary spreadsheet usage — failed with `#ERROR!`.

## Root cause

Eight aggregates were registered with `maxArgs: 1` and read only `args[0]`:
SUM, AVERAGE, COUNT, MEDIAN, MODE, STDEV, VAR, COUNTA. A second range tripped
the registry's arg-count check, so the whole formula failed. (MAX and MIN were
already multi-argument — they used the `collectNumericValues` helper that has
been sitting in the same file all along.)

## Fix

- The seven numeric aggregates now use the existing `collectNumericValues(args,
context)`, which walks every argument and expands ranges in place.
- COUNTA needs cells un-coerced (it counts text too), so it uses a new
  `collectRawValues` — the same walk, keeping each value as it is.
- `maxArgs` lifted from 1 to `MAX_AGGREGATE_ARGS` (255, Excel's limit) for all
  eight.

Single-range behaviour is unchanged: the helper produces the same list it did
before for one argument, including #2358's blank handling (blanks are dropped
from the numeric list, so AVERAGE's denominator stays the count of numbers).

## Behaviour notes

- A scalar argument is now accepted (`SUM(A1:A2, 10)`), matching Excel.
- `COUNT("text")` counts the scalar as one item because `collectNumericValues`
  coerces an evaluated scalar with `toNumber`. Excel would not count it. This
  only affects a form that previously could not be written at all (a second
  argument was rejected outright), so it is not a regression — noted here rather
  than fixed, to keep the change to the arity bug.

## Tests

`test_multiRangeAggregates.ts`: two ranges through SUM / AVERAGE / COUNT /
COUNTA / MEDIAN, range-plus-literal, range-plus-cell, and the unchanged
single-range results. Mutation-checked (restoring `maxArgs: 1` on SUM turns
three red).

Two tests that pinned the OLD limitation were updated — `test_errorReporting.ts`
used `SUM(A1:A5,B1:B5)` as its example of a throwing handler; it now uses
`IFS` with an odd argument count, which is a genuine handler-side throw (a
pairing rule the registry's min/max cannot express).

## Still open in #2360

`MID` negative length, `TEXT` digit grouping, `VLOOKUP` out-of-range column,
`VALUE("12abc")`.
