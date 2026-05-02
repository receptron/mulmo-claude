// Single source of truth for the manageAccounting LLM-facing action
// names. Used by:
//   - definition.ts (the JSON-schema action enum exposed to the LLM)
//   - api.ts        (the View's REST helpers — `call(action, args)`)
//   - server/api/routes/accounting.ts (handler-table keys, PREVIEW
//     and MESSAGE_BUILDERS membership)
//   - e2e/fixtures/accounting.ts (mock dispatcher's handler-table)
//
// Stays in its own module so server-side callers can import the
// const without pulling in apiPost / Vue plumbing from `api.ts`.
//
// CLAUDE.md "no magic literals — use existing `as const` objects"
// applies here: never reference an action by raw string at any of
// the call sites above.

export const ACCOUNTING_ACTIONS = {
  openBook: "openBook",
  getBooks: "getBooks",
  createBook: "createBook",
  deleteBook: "deleteBook",
  getAccounts: "getAccounts",
  upsertAccount: "upsertAccount",
  addEntry: "addEntry",
  voidEntry: "voidEntry",
  getJournalEntries: "getJournalEntries",
  getOpeningBalances: "getOpeningBalances",
  setOpeningBalances: "setOpeningBalances",
  getReport: "getReport",
  rebuildSnapshots: "rebuildSnapshots",
} as const;

export type AccountingAction = (typeof ACCOUNTING_ACTIONS)[keyof typeof ACCOUNTING_ACTIONS];
