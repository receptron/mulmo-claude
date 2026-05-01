// Service layer for the accounting plugin. Wraps the IO + domain
// modules into the handful of operations the route + MCP bridge
// expose. Each function:
//
//  - performs validation,
//  - mutates the journal / accounts / config files atomically,
//  - invalidates dependent snapshots,
//  - publishes a pub/sub event so subscribers refetch.
//
// Snapshot rebuild policy in this iteration is **lazy** — we drop
// the stale files synchronously and let the next `getReport` rebuild
// them via `snapshotCache.getOrBuildSnapshot`. The plan calls for a
// later upgrade to async background rebuild with a "ready" event;
// that is captured under "Out of scope" / follow-up. The lazy path
// is correct (returns identical results, just on read instead of
// on write), so this file's API stays stable across that upgrade.

import { randomUUID } from "node:crypto";

import {
  appendJournal,
  bookExists,
  ensureBookDir,
  invalidateAllSnapshots,
  invalidateSnapshotsFrom,
  listJournalPeriods,
  periodFromDate,
  readAccounts,
  readConfig,
  readJournalMonth,
  readMeta,
  removeBookDir,
  writeAccounts,
  writeConfig,
  writeMeta,
} from "../utils/files/accounting-io.js";
import { findActiveOpening, validateOpening } from "./openingBalances.js";
import { makeEntry, makeVoidEntries, validateEntry } from "./journal.js";
import { aggregateBalances, buildBalanceSheet, buildLedger, buildProfitLoss } from "./report.js";
import { balancesAtEndOf, getOrBuildSnapshot, rebuildAllSnapshots } from "./snapshotCache.js";
import { publishBookChange, publishBooksChanged } from "./eventPublisher.js";
import { DEFAULT_ACCOUNTS } from "./defaultAccounts.js";
import type { Account, AccountingConfig, BookSummary, JournalEntry, JournalLine, ReportPeriod } from "./types.js";

export class AccountingError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "AccountingError";
  }
}

const DEFAULT_BOOK_ID = "default";
const DEFAULT_CURRENCY = "USD";

function emptyConfig(): AccountingConfig {
  return { activeBookId: DEFAULT_BOOK_ID, books: [] };
}

async function loadOrInitConfig(workspaceRoot?: string): Promise<AccountingConfig> {
  const cfg = await readConfig(workspaceRoot);
  return cfg ?? emptyConfig();
}

function findBook(config: AccountingConfig, bookId: string): BookSummary | null {
  return config.books.find((book) => book.id === bookId) ?? null;
}

function resolveBookId(config: AccountingConfig, requested?: string): string {
  if (requested && findBook(config, requested)) return requested;
  if (requested) {
    throw new AccountingError(404, `book ${JSON.stringify(requested)} not found`);
  }
  if (!findBook(config, config.activeBookId)) {
    throw new AccountingError(409, "no books exist; call createBook first");
  }
  return config.activeBookId;
}

/** Read every journal entry across every month, in period-sorted
 *  order. Used by paths that need a full-history view (opening
 *  balance lookups, P/L date filtering). */
async function readAllEntries(bookId: string, workspaceRoot?: string): Promise<JournalEntry[]> {
  const periods = await listJournalPeriods(bookId, workspaceRoot);
  const all: JournalEntry[] = [];
  for (const monthKey of periods) {
    const { entries } = await readJournalMonth(bookId, monthKey, workspaceRoot);
    for (const entry of entries) all.push(entry);
  }
  return all;
}

// ── books ──────────────────────────────────────────────────────────

export async function listBooks(workspaceRoot?: string): Promise<{ activeBookId: string; books: BookSummary[] }> {
  const config = await loadOrInitConfig(workspaceRoot);
  return { activeBookId: config.activeBookId, books: config.books };
}

export async function createBook(input: { id?: string; name: string; currency?: string }, workspaceRoot?: string): Promise<{ book: BookSummary }> {
  const config = await loadOrInitConfig(workspaceRoot);
  // First book defaults to id "default" so a typical user with a
  // single ledger gets the obvious path on disk. Explicit `id` from
  // the caller takes precedence and is kept verbatim — no slugification
  // — so users who want their own scheme can keep using it.
  const bookId = input.id ?? (config.books.length === 0 ? DEFAULT_BOOK_ID : `book-${randomUUID().slice(0, 8)}`);
  if (findBook(config, bookId)) {
    throw new AccountingError(409, `book ${JSON.stringify(bookId)} already exists`);
  }
  if (await bookExists(bookId, workspaceRoot)) {
    throw new AccountingError(409, `book directory ${JSON.stringify(bookId)} already exists on disk`);
  }
  const book: BookSummary = {
    id: bookId,
    name: input.name,
    currency: input.currency ?? DEFAULT_CURRENCY,
    createdAt: new Date().toISOString(),
  };
  await ensureBookDir(bookId, workspaceRoot);
  await writeAccounts(bookId, [...DEFAULT_ACCOUNTS], workspaceRoot);
  await writeMeta(bookId, { createdAt: book.createdAt }, workspaceRoot);
  const nextConfig: AccountingConfig = {
    activeBookId: config.books.length === 0 ? bookId : config.activeBookId,
    books: [...config.books, book],
  };
  await writeConfig(nextConfig, workspaceRoot);
  publishBooksChanged();
  return { book };
}

export async function setActiveBook(input: { bookId: string }, workspaceRoot?: string): Promise<{ activeBookId: string }> {
  const config = await loadOrInitConfig(workspaceRoot);
  if (!findBook(config, input.bookId)) {
    throw new AccountingError(404, `book ${JSON.stringify(input.bookId)} not found`);
  }
  await writeConfig({ ...config, activeBookId: input.bookId }, workspaceRoot);
  publishBooksChanged();
  return { activeBookId: input.bookId };
}

export async function deleteBook(
  input: { bookId: string; confirm: boolean },
  workspaceRoot?: string,
): Promise<{ deletedBookId: string; activeBookId: string }> {
  if (!input.confirm) {
    throw new AccountingError(400, "deleteBook requires confirm: true");
  }
  const config = await loadOrInitConfig(workspaceRoot);
  if (!findBook(config, input.bookId)) {
    throw new AccountingError(404, `book ${JSON.stringify(input.bookId)} not found`);
  }
  if (config.books.length === 1) {
    throw new AccountingError(409, "cannot delete the last book; create another book first");
  }
  await removeBookDir(input.bookId, workspaceRoot);
  const remaining = config.books.filter((book) => book.id !== input.bookId);
  const nextActive = config.activeBookId === input.bookId ? remaining[0].id : config.activeBookId;
  await writeConfig({ activeBookId: nextActive, books: remaining }, workspaceRoot);
  publishBooksChanged();
  return { deletedBookId: input.bookId, activeBookId: nextActive };
}

// ── accounts ───────────────────────────────────────────────────────

export async function listAccounts(input: { bookId?: string }, workspaceRoot?: string): Promise<{ bookId: string; accounts: Account[] }> {
  const config = await loadOrInitConfig(workspaceRoot);
  const bookId = resolveBookId(config, input.bookId);
  return { bookId, accounts: await readAccounts(bookId, workspaceRoot) };
}

export async function upsertAccount(input: { bookId?: string; account: Account }, workspaceRoot?: string): Promise<{ bookId: string; accounts: Account[] }> {
  const config = await loadOrInitConfig(workspaceRoot);
  const bookId = resolveBookId(config, input.bookId);
  const accounts = await readAccounts(bookId, workspaceRoot);
  const existingIdx = accounts.findIndex((account) => account.code === input.account.code);
  const next = [...accounts];
  const oldType = existingIdx >= 0 ? accounts[existingIdx].type : null;
  if (existingIdx >= 0) {
    next[existingIdx] = { ...input.account };
  } else {
    next.push({ ...input.account });
  }
  await writeAccounts(bookId, next, workspaceRoot);
  // Type changes affect aggregation across periods — drop every
  // snapshot to be safe. Pure name / note changes don't, but
  // distinguishing isn't worth the complexity.
  if (oldType !== null && oldType !== input.account.type) {
    await invalidateAllSnapshots(bookId, workspaceRoot);
  }
  publishBookChange(bookId, { kind: "accounts" });
  return { bookId, accounts: next };
}

// ── journal entries ────────────────────────────────────────────────

export async function addEntry(
  input: { bookId?: string; date: string; lines: JournalLine[]; memo?: string },
  workspaceRoot?: string,
): Promise<{ bookId: string; entry: JournalEntry }> {
  const config = await loadOrInitConfig(workspaceRoot);
  const bookId = resolveBookId(config, input.bookId);
  const accounts = await readAccounts(bookId, workspaceRoot);
  const validation = validateEntry({ date: input.date, lines: input.lines, accounts });
  if (!validation.ok) {
    throw new AccountingError(400, "invalid journal entry", validation.errors);
  }
  const entry = makeEntry({ date: input.date, lines: input.lines, memo: input.memo, kind: "normal" });
  await appendJournal(bookId, entry, workspaceRoot);
  const period = periodFromDate(input.date);
  await invalidateSnapshotsFrom(bookId, period, workspaceRoot);
  publishBookChange(bookId, { kind: "journal", period });
  return { bookId, entry };
}

async function findEntryById(bookId: string, entryId: string, workspaceRoot?: string): Promise<JournalEntry | null> {
  const periods = await listJournalPeriods(bookId, workspaceRoot);
  for (const monthKey of periods) {
    const { entries } = await readJournalMonth(bookId, monthKey, workspaceRoot);
    const hit = entries.find((entry) => entry.id === entryId);
    if (hit) return hit;
  }
  return null;
}

export async function voidEntry(
  input: { bookId?: string; entryId: string; reason?: string; voidDate?: string },
  workspaceRoot?: string,
): Promise<{ bookId: string; reverseEntry: JournalEntry; markerEntry: JournalEntry }> {
  const config = await loadOrInitConfig(workspaceRoot);
  const bookId = resolveBookId(config, input.bookId);
  const target = await findEntryById(bookId, input.entryId, workspaceRoot);
  if (!target) {
    throw new AccountingError(404, `entry ${JSON.stringify(input.entryId)} not found`);
  }
  const voidDate = input.voidDate ?? new Date().toISOString().slice(0, 10);
  const { reverse, marker } = makeVoidEntries(target, input.reason, voidDate);
  await appendJournal(bookId, reverse, workspaceRoot);
  await appendJournal(bookId, marker, workspaceRoot);
  // Period whose snapshot is now stale = the older of the
  // original entry's month and the void's month.
  const fromPeriod = target.date < voidDate ? periodFromDate(target.date) : periodFromDate(voidDate);
  await invalidateSnapshotsFrom(bookId, fromPeriod, workspaceRoot);
  publishBookChange(bookId, { kind: "journal", period: fromPeriod });
  return { bookId, reverseEntry: reverse, markerEntry: marker };
}

interface ListEntriesInput {
  bookId?: string;
  from?: string;
  to?: string;
  accountCode?: string;
}

function entryMatchesFilters(entry: JournalEntry, input: ListEntriesInput): boolean {
  if (input.from && entry.date < input.from) return false;
  if (input.to && entry.date > input.to) return false;
  if (input.accountCode && !entry.lines.some((line) => line.accountCode === input.accountCode)) return false;
  return true;
}

export async function listEntries(input: ListEntriesInput, workspaceRoot?: string): Promise<{ bookId: string; entries: JournalEntry[] }> {
  const config = await loadOrInitConfig(workspaceRoot);
  const bookId = resolveBookId(config, input.bookId);
  const periods = await listJournalPeriods(bookId, workspaceRoot);
  const entries: JournalEntry[] = [];
  for (const monthKey of periods) {
    if (input.from && monthKey < input.from.slice(0, 7)) continue;
    if (input.to && monthKey > input.to.slice(0, 7)) continue;
    const { entries: monthEntries } = await readJournalMonth(bookId, monthKey, workspaceRoot);
    for (const entry of monthEntries) {
      if (entryMatchesFilters(entry, input)) entries.push(entry);
    }
  }
  return { bookId, entries };
}

// ── opening balances ───────────────────────────────────────────────

export async function getOpeningBalances(input: { bookId?: string }, workspaceRoot?: string): Promise<{ bookId: string; opening: JournalEntry | null }> {
  const config = await loadOrInitConfig(workspaceRoot);
  const bookId = resolveBookId(config, input.bookId);
  const all = await readAllEntries(bookId, workspaceRoot);
  return { bookId, opening: findActiveOpening(all) };
}

export async function setOpeningBalances(
  input: { bookId?: string; asOfDate: string; lines: JournalLine[]; memo?: string },
  workspaceRoot?: string,
): Promise<{ bookId: string; openingEntry: JournalEntry; replacedExisting: boolean }> {
  const config = await loadOrInitConfig(workspaceRoot);
  const bookId = resolveBookId(config, input.bookId);
  const accounts = await readAccounts(bookId, workspaceRoot);
  const all = await readAllEntries(bookId, workspaceRoot);
  const validation = validateOpening({
    asOfDate: input.asOfDate,
    lines: input.lines,
    accounts,
    existingEntries: all,
  });
  if (!validation.ok) {
    throw new AccountingError(400, "invalid opening balances", validation.errors);
  }
  // Replace-mode: void any existing active opening so the new one
  // is unambiguous. The marker is dated today (when the void
  // happened), not the original opening date.
  const existing = findActiveOpening(all);
  if (existing) {
    const today = new Date().toISOString().slice(0, 10);
    const { reverse, marker } = makeVoidEntries(existing, "replaced via setOpeningBalances", today);
    await appendJournal(bookId, reverse, workspaceRoot);
    await appendJournal(bookId, marker, workspaceRoot);
  }
  const opening = makeEntry({
    date: input.asOfDate,
    lines: input.lines,
    memo: input.memo ?? "Opening balances",
    kind: "opening",
  });
  await appendJournal(bookId, opening, workspaceRoot);
  await invalidateAllSnapshots(bookId, workspaceRoot);
  publishBookChange(bookId, { kind: "opening" });
  return { bookId, openingEntry: opening, replacedExisting: existing !== null };
}

// ── reports ────────────────────────────────────────────────────────

function endDateOfPeriod(period: ReportPeriod): string {
  if (period.kind === "month") {
    const [year, month] = period.period.split("-").map((segment) => parseInt(segment, 10));
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return `${period.period}-${String(last).padStart(2, "0")}`;
  }
  return period.to;
}

export async function getBalanceSheetReport(
  input: { bookId?: string; period: ReportPeriod },
  workspaceRoot?: string,
): Promise<{ bookId: string; balanceSheet: ReturnType<typeof buildBalanceSheet> }> {
  const config = await loadOrInitConfig(workspaceRoot);
  const bookId = resolveBookId(config, input.bookId);
  const accounts = await readAccounts(bookId, workspaceRoot);
  const monthKey = input.period.kind === "month" ? input.period.period : input.period.to.slice(0, 7);
  const snap = await getOrBuildSnapshot(bookId, monthKey, workspaceRoot);
  return {
    bookId,
    balanceSheet: buildBalanceSheet({
      accounts,
      balances: snap.balances,
      asOf: endDateOfPeriod(input.period),
    }),
  };
}

export async function getProfitLossReport(
  input: { bookId?: string; period: ReportPeriod },
  workspaceRoot?: string,
): Promise<{ bookId: string; profitLoss: ReturnType<typeof buildProfitLoss> }> {
  const config = await loadOrInitConfig(workspaceRoot);
  const bookId = resolveBookId(config, input.bookId);
  const accounts = await readAccounts(bookId, workspaceRoot);
  const all = await readAllEntries(bookId, workspaceRoot);
  const fromDate = input.period.kind === "month" ? `${input.period.period}-01` : input.period.from;
  const toDate = endDateOfPeriod(input.period);
  return { bookId, profitLoss: buildProfitLoss({ accounts, entries: all, from: fromDate, to: toDate }) };
}

export async function getLedgerReport(
  input: { bookId?: string; accountCode: string; period?: ReportPeriod },
  workspaceRoot?: string,
): Promise<{ bookId: string; ledger: ReturnType<typeof buildLedger> }> {
  const config = await loadOrInitConfig(workspaceRoot);
  const bookId = resolveBookId(config, input.bookId);
  const accounts = await readAccounts(bookId, workspaceRoot);
  const account = accounts.find((acct) => acct.code === input.accountCode);
  if (!account) {
    throw new AccountingError(404, `account ${JSON.stringify(input.accountCode)} not found`);
  }
  const all = await readAllEntries(bookId, workspaceRoot);
  const fromDate = input.period?.kind === "month" ? `${input.period.period}-01` : input.period?.from;
  const toDate = input.period ? endDateOfPeriod(input.period) : undefined;
  return { bookId, ledger: buildLedger({ account, entries: all, from: fromDate, to: toDate }) };
}

// ── snapshot admin ─────────────────────────────────────────────────

export async function rebuildSnapshots(input: { bookId?: string }, workspaceRoot?: string): Promise<{ bookId: string; rebuilt: string[] }> {
  const config = await loadOrInitConfig(workspaceRoot);
  const bookId = resolveBookId(config, input.bookId);
  const result = await rebuildAllSnapshots(bookId, workspaceRoot);
  publishBookChange(bookId, { kind: "snapshots-ready" });
  return { bookId, rebuilt: result.rebuilt };
}

// ── meta (read-only convenience) ───────────────────────────────────

export async function getBookMeta(input: { bookId?: string }, workspaceRoot?: string): Promise<{ bookId: string; meta: Awaited<ReturnType<typeof readMeta>> }> {
  const config = await loadOrInitConfig(workspaceRoot);
  const bookId = resolveBookId(config, input.bookId);
  return { bookId, meta: await readMeta(bookId, workspaceRoot) };
}

// Direct access for tests / lazy paths that want to bypass the
// snapshot cache.
export { aggregateBalances, balancesAtEndOf };
