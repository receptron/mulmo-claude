// Service layer for the accounting plugin. Wraps the IO + domain
// modules into the handful of operations the route + MCP bridge
// expose. Each function:
//
//  - performs validation,
//  - mutates the journal / accounts / config files atomically,
//  - invalidates dependent snapshots,
//  - publishes a pub/sub event so subscribers refetch.
//
// Snapshot rebuild policy: writes invalidate stale snapshot files
// synchronously, then call `scheduleRebuild` to rebuild them in the
// background. `getOrBuildSnapshot` keeps a lazy fallback so a report
// requested before the rebuild reaches that month still returns the
// right number — it just builds inline. Both paths are byte-identical
// (enforced by `test/accounting/test_snapshotCache.ts`).

import { randomUUID } from "node:crypto";

import {
  appendJournal,
  bookExists,
  ensureBookDir,
  invalidateAllSnapshots,
  invalidateSnapshotsFrom,
  isSafeBookId,
  listJournalPeriods,
  periodFromDate,
  readAccounts,
  readConfig,
  readJournalMonth,
  removeBookDir,
  writeAccounts,
  writeConfig,
} from "../utils/files/accounting-io.js";
import { findActiveOpening, validateOpening } from "./openingBalances.js";
import { localDateString, makeEntry, makeVoidEntries, validateEntry, voidedIdSet } from "./journal.js";
import { aggregateBalances, buildBalanceSheet, buildLedger, buildProfitLoss } from "./report.js";
import { awaitRebuildIdle, balancesAtEndOf, cancelRebuild, getOrBuildSnapshot, rebuildAllSnapshots, scheduleRebuild } from "./snapshotCache.js";
import { publishBookChange, publishBooksChanged } from "./eventPublisher.js";
import { DEFAULT_ACCOUNTS } from "./defaultAccounts.js";
import { log } from "../system/logger/index.js";
import { ACCOUNTING_BOOK_EVENT_KINDS } from "../../src/config/pubsubChannels.js";
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

const DEFAULT_CURRENCY = "USD";
const GENERATED_ID_RETRIES = 8;

function emptyConfig(): AccountingConfig {
  return { books: [] };
}

async function loadOrInitConfig(workspaceRoot?: string): Promise<AccountingConfig> {
  const cfg = await readConfig(workspaceRoot);
  return cfg ?? emptyConfig();
}

function findBook(config: AccountingConfig, bookId: string): BookSummary | null {
  return config.books.find((book) => book.id === bookId) ?? null;
}

function resolveBookId(config: AccountingConfig, requested: string | undefined): string {
  // Every book-touching action now requires an explicit `bookId` —
  // there's no server-side "active book" to fall back on. Callers
  // are the LLM (which is told to pass bookId on each call) and the
  // View (which tracks the current selection in localStorage).
  if (!requested) {
    throw new AccountingError(400, "bookId is required");
  }
  if (!findBook(config, requested)) {
    throw new AccountingError(404, `book ${JSON.stringify(requested)} not found`);
  }
  return requested;
}

async function generateBookId(config: AccountingConfig, workspaceRoot?: string): Promise<string> {
  // 8 hex chars × small N → collision odds are negligible, but a
  // bounded retry keeps the generator total even if one happens.
  for (let attempt = 0; attempt < GENERATED_ID_RETRIES; attempt += 1) {
    const candidate = `book-${randomUUID().slice(0, 8)}`;
    if (!findBook(config, candidate) && !(await bookExists(candidate, workspaceRoot))) return candidate;
  }
  throw new AccountingError(500, "could not generate a unique book id after several attempts");
}

/** Read every journal entry across every month, in period-sorted
 *  order. Used by paths that need a full-history view (opening
 *  balance lookups, P/L date filtering). */
async function readAllEntries(bookId: string, workspaceRoot?: string): Promise<JournalEntry[]> {
  const periods = await listJournalPeriods(bookId, workspaceRoot);
  const all: JournalEntry[] = [];
  for (const monthKey of periods) {
    const { entries, skipped } = await readJournalMonth(bookId, monthKey, workspaceRoot);
    for (const entry of entries) all.push(entry);
    if (skipped > 0) {
      // Aggregations and reports built from a partial parse are
      // misleading — log so an operator can spot a corrupted
      // jsonl file. Reads still proceed with what we could parse;
      // refusing here would lock the user out of the whole book
      // for a single bad line.
      log.warn("accounting", "journal month had unparseable lines", { bookId, period: monthKey, skipped });
    }
  }
  return all;
}

// ── books ──────────────────────────────────────────────────────────

export async function listBooks(workspaceRoot?: string): Promise<{ books: BookSummary[] }> {
  const config = await loadOrInitConfig(workspaceRoot);
  return { books: config.books };
}

export async function createBook(input: { id?: string; name: string; currency?: string }, workspaceRoot?: string): Promise<{ book: BookSummary }> {
  if (typeof input.name !== "string" || input.name.trim() === "") {
    throw new AccountingError(400, "name is required");
  }
  const config = await loadOrInitConfig(workspaceRoot);
  // Auto-generate when no caller id is supplied — every book,
  // including the very first one, gets a generated id. Explicit
  // caller-supplied ids (from a custom config import or a CLI tool)
  // are kept verbatim so users with their own naming scheme can
  // adopt it.
  const bookId = input.id ?? (await generateBookId(config, workspaceRoot));
  // Guard against caller-supplied path-traversal ids before any
  // fs touch (createBook → ensureBookDir → writeAccounts →
  // writeConfig). Auto-generated ids always pass.
  if (!isSafeBookId(bookId)) {
    throw new AccountingError(400, `invalid book id ${JSON.stringify(bookId)} — allowed characters are A-Z a-z 0-9 _ - (1-64 chars; cannot start with _ or -)`);
  }
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
  const nextConfig: AccountingConfig = { books: [...config.books, book] };
  await writeConfig(nextConfig, workspaceRoot);
  publishBooksChanged();
  return { book };
}

export async function deleteBook(
  input: { bookId: string; confirm: boolean },
  workspaceRoot?: string,
): Promise<{ deletedBookId: string; deletedBookName: string }> {
  if (!input.confirm) {
    throw new AccountingError(400, "deleteBook requires confirm: true");
  }
  const config = await loadOrInitConfig(workspaceRoot);
  const target = findBook(config, input.bookId);
  if (!target) {
    throw new AccountingError(404, `book ${JSON.stringify(input.bookId)} not found`);
  }
  // Stop any in-flight rebuild before removing the directory; otherwise
  // writeSnapshot could re-create the tree via mkdir-recursive after
  // we delete it, leaving an orphaned book folder on disk.
  cancelRebuild(input.bookId);
  await awaitRebuildIdle(input.bookId);
  await removeBookDir(input.bookId, workspaceRoot);
  const remaining = config.books.filter((book) => book.id !== input.bookId);
  await writeConfig({ books: remaining }, workspaceRoot);
  publishBooksChanged();
  // Capture the name BEFORE the splice so the LLM-facing message
  // can reference the human-readable book the user just deleted.
  return { deletedBookId: input.bookId, deletedBookName: target.name };
}

// ── accounts ───────────────────────────────────────────────────────

export async function listAccounts(input: { bookId?: string }, workspaceRoot?: string): Promise<{ bookId: string; accounts: Account[] }> {
  const config = await loadOrInitConfig(workspaceRoot);
  const bookId = resolveBookId(config, input.bookId);
  return { bookId, accounts: await readAccounts(bookId, workspaceRoot) };
}

export async function upsertAccount(
  input: { bookId?: string; account: Account },
  workspaceRoot?: string,
): Promise<{ bookId: string; account: Account; accounts: Account[] }> {
  const config = await loadOrInitConfig(workspaceRoot);
  const bookId = resolveBookId(config, input.bookId);
  // Account codes starting with `_` are reserved for synthetic
  // rows that the report layer injects (e.g. the
  // `_currentEarnings` row added to the Equity section by
  // buildBalanceSheet). Forbid user accounts in that namespace so
  // a B/S can't display two rows with the same code or
  // accidentally lose a real account behind the synthetic label.
  if (typeof input.account?.code !== "string" || input.account.code.length === 0) {
    throw new AccountingError(400, "account code is required");
  }
  if (input.account.code.startsWith("_")) {
    throw new AccountingError(400, `account code ${JSON.stringify(input.account.code)} is reserved (codes starting with _ are used for synthetic report rows)`);
  }
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
    scheduleRebuild(bookId, "0000-00", workspaceRoot);
    await invalidateAllSnapshots(bookId, workspaceRoot);
  }
  publishBookChange(bookId, { kind: ACCOUNTING_BOOK_EVENT_KINDS.accounts });
  return { bookId, account: { ...input.account }, accounts: next };
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
  // scheduleRebuild first (sync, sets pendingFromPeriod) so any
  // in-flight rebuild's `isInvalidatedDuringRebuild` check sees the
  // new pending mark before our invalidate races with its write.
  scheduleRebuild(bookId, period, workspaceRoot);
  await invalidateSnapshotsFrom(bookId, period, workspaceRoot);
  publishBookChange(bookId, { kind: ACCOUNTING_BOOK_EVENT_KINDS.journal, period });
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
  const voidDate = input.voidDate ?? localDateString();
  const { reverse, marker } = makeVoidEntries(target, input.reason, voidDate);
  await appendJournal(bookId, reverse, workspaceRoot);
  await appendJournal(bookId, marker, workspaceRoot);
  // Period whose snapshot is now stale = the older of the
  // original entry's month and the void's month.
  const fromPeriod = target.date < voidDate ? periodFromDate(target.date) : periodFromDate(voidDate);
  scheduleRebuild(bookId, fromPeriod, workspaceRoot);
  await invalidateSnapshotsFrom(bookId, fromPeriod, workspaceRoot);
  publishBookChange(bookId, { kind: ACCOUNTING_BOOK_EVENT_KINDS.journal, period: fromPeriod });
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

export async function listEntries(
  input: ListEntriesInput,
  workspaceRoot?: string,
): Promise<{ bookId: string; entries: JournalEntry[]; voidedEntryIds: string[] }> {
  const config = await loadOrInitConfig(workspaceRoot);
  const bookId = resolveBookId(config, input.bookId);
  const periods = await listJournalPeriods(bookId, workspaceRoot);
  const entries: JournalEntry[] = [];
  // Collect voided ids from the *unfiltered* set across every month —
  // an account-filtered query drops void-marker rows (they have no
  // lines), so deriving voided ids from the filtered list misses
  // them and the View loses the strikeout on the cancelled original.
  const allVoidedIds = new Set<string>();
  for (const monthKey of periods) {
    const { entries: monthEntries } = await readJournalMonth(bookId, monthKey, workspaceRoot);
    for (const voidedId of voidedIdSet(monthEntries)) allVoidedIds.add(voidedId);
    if (input.from && monthKey < input.from.slice(0, 7)) continue;
    if (input.to && monthKey > input.to.slice(0, 7)) continue;
    for (const entry of monthEntries) {
      if (entryMatchesFilters(entry, input)) entries.push(entry);
    }
  }
  return { bookId, entries, voidedEntryIds: Array.from(allVoidedIds).sort() };
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
    const today = localDateString();
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
  scheduleRebuild(bookId, "0000-00", workspaceRoot);
  await invalidateAllSnapshots(bookId, workspaceRoot);
  publishBookChange(bookId, { kind: ACCOUNTING_BOOK_EVENT_KINDS.opening });
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
  const balances = await balancesAsOf(bookId, input.period, workspaceRoot);
  return {
    bookId,
    balanceSheet: buildBalanceSheet({
      accounts,
      balances,
      asOf: endDateOfPeriod(input.period),
    }),
  };
}

/** Resolve closing balances at the end of a `ReportPeriod`. Month
 *  periods hit the snapshot cache; range periods with a mid-month
 *  `to` date have to filter the journal directly because the
 *  end-of-month snapshot would include activity past `to`. */
async function balancesAsOf(bookId: string, period: ReportPeriod, workspaceRoot?: string): Promise<ReturnType<typeof aggregateBalances>> {
  if (period.kind === "month") {
    const snap = await getOrBuildSnapshot(bookId, period.period, workspaceRoot);
    return [...snap.balances];
  }
  const all = await readAllEntries(bookId, workspaceRoot);
  const filtered = all.filter((entry) => entry.date <= period.to);
  return aggregateBalances(filtered);
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
  publishBookChange(bookId, { kind: ACCOUNTING_BOOK_EVENT_KINDS.snapshotsReady });
  return { bookId, rebuilt: result.rebuilt };
}

// Direct access for tests / lazy paths that want to bypass the
// snapshot cache.
export { aggregateBalances, balancesAtEndOf };
