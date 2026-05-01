// Helpers for the accounting plugin E2E tests.
//
// `mockAccountingApi` registers a `/api/accounting` route handler that
// keeps a small in-memory state across action dispatches so the View
// can drive a realistic create-book / set-opening / add-entry flow
// without standing up the real server. The state lives inside the
// closure — call `mockAccountingApi(page)` once per test.

import { randomUUID } from "node:crypto";
import type { Page, Route } from "@playwright/test";
import { ACCOUNTING_ACTIONS } from "../../src/plugins/accounting/actions";

interface FakeBook {
  id: string;
  name: string;
  currency: string;
  createdAt: string;
}

interface FakeAccount {
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "income" | "expense";
}

interface FakeLine {
  accountCode: string;
  debit?: number;
  credit?: number;
  memo?: string;
}

interface FakeEntry {
  id: string;
  date: string;
  kind: "normal" | "opening" | "void" | "void-marker";
  lines: FakeLine[];
  memo?: string;
  voidedEntryId?: string;
  voidReason?: string;
  createdAt: string;
}

interface AccountingState {
  books: FakeBook[];
  accountsByBook: Map<string, FakeAccount[]>;
  entriesByBook: Map<string, FakeEntry[]>;
}

const SEED_ACCOUNTS: FakeAccount[] = [
  { code: "1000", name: "Cash", type: "asset" },
  { code: "2000", name: "Accounts payable", type: "liability" },
  { code: "3000", name: "Equity", type: "equity" },
  { code: "4000", name: "Sales", type: "income" },
  { code: "5000", name: "Rent expense", type: "expense" },
];

interface DispatchBody {
  action: string;
  [key: string]: unknown;
}

interface MockResponse {
  status: number;
  body: unknown;
}

type ActionHandler = (state: AccountingState, body: DispatchBody) => MockResponse;

function makeState(): AccountingState {
  return { books: [], accountsByBook: new Map(), entriesByBook: new Map() };
}

function uniqueId(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

const ok = (body: unknown): MockResponse => ({ status: 200, body });
const err = (status: number, message: string): MockResponse => ({ status, body: { error: message } });
const missingBookId = (): MockResponse => err(400, "bookId is required");

/** Resolve the book id the way the real service does (see
 *  `resolveBookId` in `server/accounting/service.ts`): require an
 *  explicit string `bookId` (else 400) AND require it to exist in
 *  state (else 404). Returning a `MockResponse` for the unhappy
 *  paths lets the fixture mirror production's status-code shape so
 *  e2e flows that exercise stale / typo'd ids see the real 404
 *  rather than a silent 200 with empty data. */
function resolveBookId(state: AccountingState, body: DispatchBody): string | MockResponse {
  if (typeof body.bookId !== "string") return missingBookId();
  if (!state.books.some((book) => book.id === body.bookId)) {
    return err(404, `book ${JSON.stringify(body.bookId)} not found`);
  }
  return body.bookId;
}

function handleOpenApp(state: AccountingState, body: DispatchBody): MockResponse {
  const requested = typeof body.bookId === "string" ? body.bookId : null;
  const bookId = requested && state.books.some((book) => book.id === requested) ? requested : null;
  const initialTab = typeof body.initialTab === "string" ? body.initialTab : undefined;
  if (state.books.length === 0) {
    // Mirrors the server's no-book LLM-facing message — see
    // server/api/routes/accounting.ts handleOpenApp.
    return ok({
      kind: "accounting-app",
      bookId,
      initialTab,
      books: state.books,
      message:
        "No books in this workspace yet. The accounting UI is showing a form asking the user to create their first book (name + currency) before any accounting feature can be used.",
    });
  }
  return ok({ kind: "accounting-app", bookId, initialTab, books: state.books });
}

function handleGetBooks(state: AccountingState): MockResponse {
  return ok({ books: state.books });
}

function handleCreateBook(state: AccountingState, body: DispatchBody): MockResponse {
  const name = typeof body.name === "string" ? body.name : "Test book";
  const currency = typeof body.currency === "string" ? body.currency : "USD";
  const book: FakeBook = { id: uniqueId("book"), name, currency, createdAt: new Date().toISOString() };
  state.books.push(book);
  state.accountsByBook.set(book.id, [...SEED_ACCOUNTS]);
  state.entriesByBook.set(book.id, []);
  return ok({ book });
}

function handleDeleteBook(state: AccountingState, body: DispatchBody): MockResponse {
  const bookId = typeof body.bookId === "string" ? body.bookId : "";
  if (body.confirm !== true) return err(400, "deleteBook requires confirm: true");
  const idx = state.books.findIndex((book) => book.id === bookId);
  if (idx < 0) return err(404, `book ${JSON.stringify(bookId)} not found`);
  const target = state.books[idx];
  state.books.splice(idx, 1);
  state.accountsByBook.delete(bookId);
  state.entriesByBook.delete(bookId);
  return ok({ deletedBookId: bookId, deletedBookName: target.name });
}

function handleGetAccounts(state: AccountingState, body: DispatchBody): MockResponse {
  const resolved = resolveBookId(state, body);
  if (typeof resolved !== "string") return resolved;
  return ok({ bookId: resolved, accounts: state.accountsByBook.get(resolved) ?? [] });
}

function voidedIdsFrom(entries: readonly FakeEntry[]): string[] {
  const set = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === "void-marker" && entry.voidedEntryId) set.add(entry.voidedEntryId);
  }
  return Array.from(set).sort();
}

function handleGetJournalEntries(state: AccountingState, body: DispatchBody): MockResponse {
  const resolved = resolveBookId(state, body);
  if (typeof resolved !== "string") return resolved;
  const entries = state.entriesByBook.get(resolved) ?? [];
  return ok({ bookId: resolved, entries, voidedEntryIds: voidedIdsFrom(entries) });
}

function handleAddEntry(state: AccountingState, body: DispatchBody): MockResponse {
  const resolved = resolveBookId(state, body);
  if (typeof resolved !== "string") return resolved;
  const entry: FakeEntry = {
    id: uniqueId("entry"),
    date: typeof body.date === "string" ? body.date : "2026-04-01",
    kind: "normal",
    lines: (body.lines as FakeLine[]) ?? [],
    memo: typeof body.memo === "string" ? body.memo : undefined,
    createdAt: new Date().toISOString(),
  };
  const list = state.entriesByBook.get(resolved) ?? [];
  list.push(entry);
  state.entriesByBook.set(resolved, list);
  return ok({ bookId: resolved, entry });
}

function buildVoidMemo(target: FakeEntry, reason: string | undefined): string {
  // Mirror the real service contract from
  // `server/accounting/journal.ts#voidMemo`: entry-level memo →
  // first line memo → date-only fallback. Picking memo from any
  // line (e.g. via `find(...)`) would diverge from production.
  const memoSource = target.memo ?? target.lines[0]?.memo ?? null;
  const base = memoSource ? `void of '${memoSource}' on ${target.date}` : `void of entry on ${target.date}`;
  return reason && reason.trim() !== "" ? `${base}: ${reason}` : base;
}

function handleVoidEntry(state: AccountingState, body: DispatchBody): MockResponse {
  const resolved = resolveBookId(state, body);
  if (typeof resolved !== "string") return resolved;
  const list = state.entriesByBook.get(resolved) ?? [];
  const targetId = typeof body.entryId === "string" ? body.entryId : "";
  const target = list.find((entry) => entry.id === targetId);
  if (!target) return err(404, `entry ${JSON.stringify(targetId)} not found`);
  const reason = typeof body.reason === "string" ? body.reason : undefined;
  const voidDate = typeof body.voidDate === "string" ? body.voidDate : "2026-04-30";
  const reverse: FakeEntry = {
    id: uniqueId("entry"),
    date: voidDate,
    kind: "void",
    lines: target.lines.map((line) => ({ accountCode: line.accountCode, debit: line.credit, credit: line.debit, memo: line.memo })),
    memo: buildVoidMemo(target, reason),
    voidedEntryId: target.id,
    voidReason: reason,
    createdAt: new Date().toISOString(),
  };
  const marker: FakeEntry = {
    id: uniqueId("entry"),
    date: voidDate,
    kind: "void-marker",
    lines: [],
    voidedEntryId: target.id,
    voidReason: reason,
    createdAt: new Date().toISOString(),
  };
  list.push(reverse, marker);
  state.entriesByBook.set(resolved, list);
  return ok({ bookId: resolved, reverseEntry: reverse, markerEntry: marker });
}

function handleGetOpening(state: AccountingState, body: DispatchBody): MockResponse {
  const resolved = resolveBookId(state, body);
  if (typeof resolved !== "string") return resolved;
  const list = state.entriesByBook.get(resolved) ?? [];
  return ok({ bookId: resolved, opening: list.find((entry) => entry.kind === "opening") ?? null });
}

function handleSetOpening(state: AccountingState, body: DispatchBody): MockResponse {
  const resolved = resolveBookId(state, body);
  if (typeof resolved !== "string") return resolved;
  const opening: FakeEntry = {
    id: uniqueId("entry"),
    date: typeof body.asOfDate === "string" ? body.asOfDate : "2026-01-01",
    kind: "opening",
    lines: (body.lines as FakeLine[]) ?? [],
    memo: typeof body.memo === "string" ? body.memo : "Opening balances",
    createdAt: new Date().toISOString(),
  };
  const list = state.entriesByBook.get(resolved) ?? [];
  list.push(opening);
  state.entriesByBook.set(resolved, list);
  return ok({ bookId: resolved, openingEntry: opening, replacedExisting: false });
}

function handleGetReport(state: AccountingState, body: DispatchBody): MockResponse {
  const resolved = resolveBookId(state, body);
  if (typeof resolved !== "string") return resolved;
  const kind = typeof body.kind === "string" ? body.kind : "balance";
  if (kind === "pl") {
    return ok({
      bookId: resolved,
      profitLoss: { from: "2026-04-01", to: "2026-04-30", income: { rows: [], total: 0 }, expense: { rows: [], total: 0 }, netIncome: 0 },
    });
  }
  if (kind === "ledger") {
    return ok({ bookId: resolved, ledger: { accountCode: "1000", accountName: "Cash", rows: [], closingBalance: 0 } });
  }
  return ok({ bookId: resolved, balanceSheet: { asOf: "2026-04-30", sections: [], imbalance: 0 } });
}

const ACTION_HANDLERS: Record<string, ActionHandler> = {
  [ACCOUNTING_ACTIONS.openApp]: handleOpenApp,
  [ACCOUNTING_ACTIONS.getBooks]: handleGetBooks,
  [ACCOUNTING_ACTIONS.createBook]: handleCreateBook,
  [ACCOUNTING_ACTIONS.deleteBook]: handleDeleteBook,
  [ACCOUNTING_ACTIONS.getAccounts]: handleGetAccounts,
  [ACCOUNTING_ACTIONS.getJournalEntries]: handleGetJournalEntries,
  [ACCOUNTING_ACTIONS.addEntry]: handleAddEntry,
  [ACCOUNTING_ACTIONS.voidEntry]: handleVoidEntry,
  [ACCOUNTING_ACTIONS.getOpeningBalances]: handleGetOpening,
  [ACCOUNTING_ACTIONS.setOpeningBalances]: handleSetOpening,
  [ACCOUNTING_ACTIONS.getReport]: handleGetReport,
  [ACCOUNTING_ACTIONS.rebuildSnapshots]: (state, body) => {
    const resolved = resolveBookId(state, body);
    if (typeof resolved !== "string") return resolved;
    return ok({ bookId: resolved, rebuilt: [] });
  },
};

function dispatch(state: AccountingState, body: DispatchBody): MockResponse {
  const handler = ACTION_HANDLERS[body.action];
  if (!handler) return err(400, `unhandled mock action ${JSON.stringify(body.action)}`);
  return handler(state, body);
}

/** Register a mock /api/accounting route on `page`. The mock keeps
 *  in-memory state so multi-step flows (createBook → addEntry →
 *  voidEntry) work end-to-end. Returns the state so tests can
 *  pre-seed before navigation. */
export async function mockAccountingApi(page: Page): Promise<AccountingState> {
  const state = makeState();
  await page.route(
    (url) => url.pathname === "/api/accounting",
    async (route: Route) => {
      const body = (route.request().postDataJSON() ?? {}) as DispatchBody;
      const result = dispatch(state, body);
      await route.fulfill({ status: result.status, json: result.body });
    },
  );
  return state;
}

/** Build the accounting-app tool_result envelope that mounts
 *  `<AccountingApp>` in the canvas. Drop into a session's entries
 *  array exactly like presentChart / presentSpreadsheet results. */
export function makeAccountingToolResult(opts: { bookId?: string | null; initialTab?: string } = {}): Record<string, unknown> {
  return {
    type: "tool_result",
    source: "tool",
    result: {
      uuid: "accounting-result-1",
      toolName: "manageAccounting",
      message: "Accounting app ready",
      data: { kind: "accounting-app", bookId: opts.bookId ?? null, initialTab: opts.initialTab },
    },
  };
}
