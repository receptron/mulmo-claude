# fix #2390 + refactor #2396 — spreadsheet lookup range parsing

Two paired issues that both live in `src/plugins/spreadsheet/engine/functions/lookup.ts`.
The refactor (#2396) centralises the range/column parsing that the bug fix (#2390)
depends on, so they ship as one PR with clearly separated commits (see "PR shape").

## Canonical copy

There is exactly ONE copy of the spreadsheet engine: `src/plugins/spreadsheet/**`.
The `packages/mulmoclaude/src/plugins/spreadsheet/...` path referenced in the task
brief does not exist on `origin/main` (verified with `find`). No dual-copy sync
needed. Recent spreadsheet fixes (#2414, #2386, #2357, #2356) all touched only
`src/plugins/spreadsheet/**` and `test/plugins/spreadsheet/**`.

## #2396 — consolidation (foundation)

`functions/lookup.ts` carried independent re-implementations of already-tested
shared code:

| lookup.ts | canonical | issue |
|---|---|---|
| `colToIndex` / `indexToCol` (lines 9-27) | `parser.ts` `columnToIndex` / `indexToColumn` (tested) | byte-for-byte duplicate |
| range-bounds parse (lines 122, 148, 199, 264) | none — 4 hand-copies | one copy (line 122) rejected sheet-qualified ranges |

Fix:
- Delete `colToIndex` / `indexToCol`; import `columnToIndex` / `indexToColumn` from `parser.ts`.
- Add pure `parseRangeBounds(range)` to `formulaRefs.ts` (alongside `expandRange` /
  `parseSingleCellRef`). It splits an optional `Sheet!` / `'Sheet Name'!` prefix,
  parses the `A2:C10` body into `{ sheetPrefix, startCol, startRow, endCol, endRow }`
  (cols 0-based via `columnToIndex`, rows 1-based), and returns `null` for non-ranges.
- Repoint VLOOKUP / HLOOKUP / INDEX to `parseRangeBounds`.

Behaviour is identical for the single-sheet ranges the four copies already handled;
the one difference is the intended one — the sheet-qualified throw disappears (below).

## #2390 — three bugs

### 1. Cross-sheet VLOOKUP throws (fixed BY the #2396 consolidation)
`VLOOKUP(x, Sheet1!A2:C10, 2)` threw. Line 122 ran a *sheet-unaware* regex
`/^([A-Z]+)\d+:...$/` against the whole `Sheet1!A2:C10` and threw "Invalid table
array range" before the sheet-aware block at line 148 could run. `parseRangeBounds`
strips the sheet prefix first, so the single unified parse accepts it. Regression
test lands with the refactor commit.

### 2. INDEX out-of-range reads the wrong cell → should be `#REF!`
`INDEX(A1:A3, 5)` read A5 (outside the range); `INDEX(A2:B5, 0, 1)` read A1 (above
the range). Root cause: `indexHandler` computed `startRow + rowNum - 1` with no
bounds check. Fix: pure `resolveIndexTarget(bounds, rowNum, colNum)` validates the
1-based position against the range dimensions and returns `null` (→ `#REF!`) when
out of range. Excel's `0` = "entire row/column" selector is only representable in
this scalar engine when that dimension is a single line; otherwise it also returns
`#REF!` rather than silently reading an out-of-range cell. This is pinned as a test.

### 3. NPV period offset
`NPV(0.1, A1:A3, 500)` discounted 500 at period 2 (its argument index) instead of
period 4. Root cause: the handler used the *argument* index `i` as the period, so a
scalar after an N-cell range landed at period 2 rather than N+1. Fix: pure
`computeNpv(rate, cashFlows)` in `financial-math.ts` discounts each flow by its
1-based position in a single flattened, ordered list; the handler flattens ranges
(numeric values) then scalars into that list.

## Pure functions extracted (each unit-tested)

- `parseRangeBounds` — `formulaRefs.ts` (range/sheet parsing; the #2396 target)
- `resolveIndexTarget` — `formulaRefs.ts` (INDEX bounds → cell or `#REF!`)
- `computeNpv` — `financial-math.ts` (ordered discounting)

## PR shape

One PR, `refactor/2396-lookup-refs`, commits kept separated:
1. `docs(plan)` — this file
2. `refactor(spreadsheet): #2396` — consolidation + cross-sheet VLOOKUP test
3. `fix(spreadsheet): #2390` — INDEX `#REF!` + NPV period, with tests

Two separate PRs would both edit `lookup.ts` from `main` and self-conflict (neither
is merged in this task), so the coupled single-PR form is used per the brief.

## Verification

Each regression test is confirmed to go red when its fix is reverted. Full gate:
`yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, spreadsheet tests.
