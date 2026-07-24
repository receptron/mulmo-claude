# refactor(accounting-plugin): single-source server↔vue response/report types (#2411)

## Problem

Inside `packages/plugins/accounting-plugin`, the domain response types and
report shapes are declared **twice** — once on the server side and once on the
Vue side. Same-kind bug as #2334: adding a field to an API response leaves the
Vue-side type silently stale, so the frontend keeps compiling against an old
shape and the drift is invisible until a runtime surprise.

Duplicated pairs (all in-package):

| Pair | Content |
|---|---|
| `src/server/types.ts` ↔ `src/vue/api.ts` | domain response types (`Account`, `AccountType`, `JournalLine`, `JournalEntry`, `JournalEntryKind`, `BookSummary`, `AccountBalance`, `ReportPeriod`) |
| `src/server/report.ts` ↔ `src/vue/api.ts` | report shapes (`BalanceSheet`, `BalanceSheetSection`, `ProfitLoss`, `Ledger`, `LedgerRow`) |
| `src/server/report.ts` (`aggregateBalances` tail) ↔ `src/server/snapshotCache.ts` (`mergeBalances` tail) | server-internal: identical `Map → sorted AccountBalance[]` transform |
| `src/server/http.ts` ↔ host `server/utils/asyncHandler.ts` | handler wrapper (cross-package) |

There is no zod schema driving the responses, so single-sourcing is a straight
interface consolidation (no `z.infer` needed).

## Approach

### 1. New `src/shared/types.ts` (browser-safe, isomorphic)

The package already has an isomorphic `src/shared/` surface (`errors.ts`,
`countries.ts`, …) imported by both server and Vue with no `node:` / Vue deps.
Add `types.ts` there as the single home for the shared domain + report types:

- Domain: `ACCOUNT_TYPES` (+ derived `AccountType`), `BALANCE_SHEET_ACCOUNT_TYPES`,
  `Account`, `JournalEntryKind`, `JournalLine`, `JournalEntry`, `BookSummary`,
  `AccountBalance`, `ReportPeriod`.
- Report: `BalanceSheetSection`, `BalanceSheet`, `ProfitLoss`, `LedgerRow`, `Ledger`.

`BookSummary` keeps referencing `SupportedCountryCode` / `FiscalYearEnd` via
`import type` from the sibling shared modules (still browser-safe).

Register it in `src/shared/index.ts` (`export * from "./types"`).

### 2. Repoint the server

- `src/server/types.ts` keeps only the **server-only persistence** types
  (`AccountingConfig`, `MonthSnapshot`) and imports the shared domain types it
  references. Domain/report types now come from `../shared/types.js`.
- Server files that imported domain types from `./types.js` repoint to
  `../shared/types.js` (`Account`, `AccountType`, `AccountBalance`,
  `JournalEntry`, `JournalLine`, `BookSummary`, `ReportPeriod`,
  `BALANCE_SHEET_ACCOUNT_TYPES`).
- `src/server/report.ts` imports the report shapes from shared instead of
  declaring them; the `build*` pure functions stay put.
- `src/server/index.ts` re-exports `BookSummary` from `../shared/types.js`
  (it is the package's public server type — already a re-export today).

### 3. Repoint the Vue side

`src/vue/api.ts` drops its local duplicate declarations and instead
`import type`s them from `../shared`, re-exporting the domain + report types so
the ~17 Vue components that import them from `../api` keep their single
UI-facing surface unchanged (deliberate: `api.ts` is the Vue data-layer entry —
components pull the API fn and its result type from one module).

### 4. Server-internal dedup + test (pure logic)

Extract the shared `Map<string, number> → sorted AccountBalance[]` tail into an
exported pure helper `sortedBalancesFromMap` in `report.ts`; `aggregateBalances`
and `snapshotCache.mergeBalances` both call it. Add a unit test for the helper
in `test/accounting/test_report.ts` (sorting, merge-of-empty, dedup key).

### 5. `http.ts` ↔ host `asyncHandler` — intentional copy, keep

A plugin importing `server/utils/asyncHandler.ts` would be an **uphill** import
(plugin → host), forbidden by the package-dependency-direction rule. Sharing
would require lifting the wrapper into `@mulmoclaude/core` — a cross-cutting
change out of scope for an in-package type dedup. The two also diverge (the
plugin copy forwards to Express `next(err)` on `headersSent`). Keep the copy;
tighten the header comment so a future reader does not "fix" it by importing
uphill.

## Verification

- Behaviour identical — pure type consolidation + one pure-fn extraction.
- Temporarily add a field to a shared type and confirm BOTH server and Vue tsc
  see it (the #2349 drift check), then remove.
- `yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn test`.

## Version

Purely in-package type dedup — no public shape change, no behaviour change. No
`@mulmoclaude/accounting-plugin` version bump, so no consumer-range sweep and
the launcherSync invariant is untouched.
