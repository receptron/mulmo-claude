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
  appendJournalBatch,
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
} from "./io.js";
import { findActiveOpening, validateOpening } from "./openingBalances.js";
import { normalizeStoredAccount } from "./accountNormalize.js";
import { isValidCalendarDate, localDateString, makeEntry, makeVoidEntries, validateEntry, voidedIdSet } from "./journal.js";
import { aggregateBalances, buildBalanceSheet, buildLedger, buildProfitLoss } from "./report.js";
import {
  bucketize,
  buildTimeSeries,
  TIME_SERIES_GRANULARITIES,
  TIME_SERIES_METRICS,
  type TimeSeriesGranularity,
  type TimeSeriesMetric,
  type TimeSeriesPoint,
} from "./timeSeries.js";
import { awaitRebuildIdle, balancesAtEndOf, cancelRebuild, getOrBuildSnapshot, rebuildAllSnapshots, scheduleRebuild } from "./snapshotCache.js";
import { publishBookChange, publishBooksChanged } from "./eventPublisher.js";
import { DEFAULT_ACCOUNTS } from "./defaultAccounts.js";
import { log } from "./context.js";
import { BOOK_EVENT_KINDS as ACCOUNTING_BOOK_EVENT_KINDS } from "../shared";
import {
  isSupportedCountryCode,
  SUPPORTED_COUNTRY_CODES,
  type SupportedCountryCode,
  DEFAULT_FISCAL_YEAR_END,
  FISCAL_YEAR_END_MONTHS,
  isFiscalYearEnd,
  resolveFiscalYearEnd,
  type FiscalYearEnd,
} from "../shared";
import type { AccountingConfig } from "./types.js";
import type { Account, BookSummary, JournalEntry, JournalLine, ReportPeriod } from "../shared/types.js";

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

function unsupportedCountryError(received: unknown): AccountingError {
  return new AccountingError(400, `unsupported country code ${JSON.stringify(received)} — must be one of: ${SUPPORTED_COUNTRY_CODES.join(", ")}`);
}

function unsupportedFiscalYearEndError(received: unknown): AccountingError {
  return new AccountingError(
    400,
    `unsupported fiscalYearEnd ${JSON.stringify(received)} — must be a closing-month number ${FISCAL_YEAR_END_MONTHS.join(", ")} (1 = January … 12 = December)`,
  );
}

/** Coerce + validate a free-form `fiscalYearEnd` from any ingress path
 *  (REST body, MCP tool args, direct callers). The service is the
 *  validation boundary, so this is deliberately tolerant of input SHAPE
 *  but strict about the resulting value:
 *    - absent / null / empty string → `undefined` (field omitted; the
 *      caller decides default-vs-no-op);
 *    - a number, or a numeric string ("8") from a hand-rolled client →
 *      that month;
 *    - a legacy calendar-quarter token ("Q1".."Q4") from a stale client
 *      → its closing month (same Q1→3 mapping the read side applies);
 *    - anything else non-empty (a typo, garbage, an out-of-range or
 *      non-integer number) → 400, echoing the ORIGINAL value so the
 *      bad payload can't be silently mistaken for the default. */
function coerceFiscalYearEndInput(raw: unknown): FiscalYearEnd | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  let month: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "") return undefined;
    if (/^Q[1-4]$/.test(trimmed)) return resolveFiscalYearEnd(trimmed);
    month = /^-?\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
  }
  if (!isFiscalYearEnd(month)) throw unsupportedFiscalYearEndError(raw);
  return month;
}

/** Boundary checks shared by updateBook (name / country only —
 *  fiscalYearEnd is coerced + validated separately via
 *  `coerceFiscalYearEndInput`). Throws on the first failure so the
 *  surrounding function stays under the cognitive-complexity threshold;
 *  each rule is also unit-testable independently via the service entry
 *  point. */
function validateUpdateBookInput(input: { name?: string; country?: string }): void {
  if (input.name !== undefined && (typeof input.name !== "string" || input.name.trim() === "")) {
    throw new AccountingError(400, "name must be a non-empty string when supplied");
  }
  // Empty string is the explicit "clear the field" sentinel from the
  // settings UI; anything else has to land in the curated list, same
  // contract as createBook.
  if (input.country !== undefined && input.country !== "" && !isSupportedCountryCode(input.country)) {
    throw unsupportedCountryError(input.country);
  }
}

export async function createBook(
  input: { id?: string; name: string; currency?: string; country?: string; fiscalYearEnd?: unknown },
  workspaceRoot?: string,
): Promise<{ book: BookSummary }> {
  if (typeof input.name !== "string" || input.name.trim() === "") {
    throw new AccountingError(400, "name is required");
  }
  // Country, when supplied, must be one of the curated codes — keeps
  // the UI dropdown, the role prompt's per-jurisdiction guidance, and
  // the on-disk JSON in sync. A typo from the LLM or an untrusted
  // client is rejected here rather than silently persisted.
  if (input.country !== undefined && !isSupportedCountryCode(input.country)) {
    throw unsupportedCountryError(input.country);
  }
  const fiscalYearEnd = coerceFiscalYearEndInput(input.fiscalYearEnd) ?? DEFAULT_FISCAL_YEAR_END;
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
    // Narrowed by the isSupportedCountryCode check above.
    ...(input.country ? { country: input.country as SupportedCountryCode } : {}),
    fiscalYearEnd,
    createdAt: new Date().toISOString(),
  };
  await ensureBookDir(bookId, workspaceRoot);
  await writeAccounts(bookId, [...DEFAULT_ACCOUNTS], workspaceRoot);
  const nextConfig: AccountingConfig = { books: [...config.books, book] };
  await writeConfig(nextConfig, workspaceRoot);
  publishBooksChanged();
  return { book };
}

export async function updateBook(
  input: { bookId: string; name?: string; country?: string; fiscalYearEnd?: unknown },
  workspaceRoot?: string,
): Promise<{ book: BookSummary }> {
  const config = await loadOrInitConfig(workspaceRoot);
  const target = findBook(config, input.bookId);
  if (!target) {
    throw new AccountingError(404, `book ${JSON.stringify(input.bookId)} not found`);
  }
  validateUpdateBookInput(input);
  // Coerce + validate up front so a malformed value 400s before any
  // write (undefined = the field was omitted → leave it untouched).
  const fiscalYearEnd = coerceFiscalYearEndInput(input.fiscalYearEnd);
  // Currency intentionally absent — once entries reference per-book
  // amounts, switching currency would silently re-interpret every
  // historical figure. Country / name / fiscalYearEnd are pure metadata;
  // safe to swap. Changing fiscalYearEnd does not move any entries —
  // it only changes how the date-range shortcuts resolve from now on.
  const next: BookSummary = {
    ...target,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.country !== undefined && input.country !== "" ? { country: input.country as SupportedCountryCode } : {}),
    ...(fiscalYearEnd !== undefined ? { fiscalYearEnd } : {}),
  };
  // Strip an explicitly-cleared country so the JSON file stays clean
  // (matches the createBook policy of omitting the field when unset).
  if (input.country === "") delete next.country;
  const nextConfig: AccountingConfig = {
    books: config.books.map((book) => (book.id === input.bookId ? next : book)),
  };
  await writeConfig(nextConfig, workspaceRoot);
  publishBooksChanged();
  return { book: next };
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
  // Whitelist + active-flag policy lives in normalizeStoredAccount
  // (see ./accountNormalize.ts) so the rules are unit-testable in
  // isolation and this service function stays focused on the
  // file-IO + snapshot-invalidation orchestration.
  const stored = normalizeStoredAccount(input.account, existingIdx >= 0 ? accounts[existingIdx] : undefined);
  if (existingIdx >= 0) {
    next[existingIdx] = stored;
  } else {
    next.push(stored);
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

export interface AddEntriesItem {
  date: string;
  lines: JournalLine[];
  memo?: string;
  replacesEntryId?: string;
}

interface BatchValidationFailure {
  index: number;
  errors: unknown;
}

// All-or-nothing validation: collect failures across every entry
// so the whole batch can be rejected before any write touches disk
// (a half-applied batch can never end up persisted).
function collectBatchValidationFailures(items: readonly AddEntriesItem[], accounts: readonly Account[]): BatchValidationFailure[] {
  const failures: BatchValidationFailure[] = [];
  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    const validation = validateEntry({ date: item.date, lines: item.lines, accounts });
    if (!validation.ok) failures.push({ index: idx, errors: validation.errors });
  }
  return failures;
}

function buildBatchEntries(items: readonly AddEntriesItem[]): JournalEntry[] {
  return items.map((item) => makeEntry({ date: item.date, lines: item.lines, memo: item.memo, kind: "normal", replacesEntryId: item.replacesEntryId }));
}

// Snapshot maintenance is driven from the earliest period in the
// batch — invalidating from that point covers every later month a
// single-entry call would have invalidated individually, while
// collapsing the rebuild + publish work into one round.
function earliestPeriodOf(entries: readonly JournalEntry[]): string {
  return entries.map((entry) => periodFromDate(entry.date)).reduce((min, period) => (period < min ? period : min));
}

export async function addEntries(
  input: { bookId?: string; entries: AddEntriesItem[] },
  workspaceRoot?: string,
): Promise<{ bookId: string; entries: JournalEntry[] }> {
  const config = await loadOrInitConfig(workspaceRoot);
  const bookId = resolveBookId(config, input.bookId);
  if (!Array.isArray(input.entries) || input.entries.length === 0) {
    throw new AccountingError(400, "addEntries: entries must be a non-empty array");
  }
  const accounts = await readAccounts(bookId, workspaceRoot);
  const failures = collectBatchValidationFailures(input.entries, accounts);
  if (failures.length > 0) throw new AccountingError(400, "invalid journal entries", failures);
  const built = buildBatchEntries(input.entries);
  // Two-phase batched write: stage every affected month's full new
  // content, then commit all renames at the end. Same-period
  // batches are fully atomic; multi-period failure window is
  // narrowed to the rename phase only.
  await appendJournalBatch(bookId, built, workspaceRoot);
  const earliestPeriod = earliestPeriodOf(built);
  // scheduleRebuild first (sync, sets pendingFromPeriod) so any
  // in-flight rebuild's `isInvalidatedDuringRebuild` check sees the
  // new pending mark before our invalidate races with its write.
  scheduleRebuild(bookId, earliestPeriod, workspaceRoot);
  await invalidateSnapshotsFrom(bookId, earliestPeriod, workspaceRoot);
  publishBookChange(bookId, { kind: ACCOUNTING_BOOK_EVENT_KINDS.journal, period: earliestPeriod });
  return { bookId, entries: built };
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

// ── time series ────────────────────────────────────────────────────

function ensureValidYmd(label: string, value: unknown): string {
  // Reuse the journal-side helper so impossible days (`2025-02-30`,
  // `2025-13-01`) AND silent year drift (`0099-01-01` → 1999 via
  // `Date.UTC` legacy two-digit handling) are both rejected — rolling
  // a separate regex+lastDay check here missed the latter.
  if (typeof value !== "string" || !isValidCalendarDate(value)) {
    throw new AccountingError(400, `getTimeSeries: ${label} must be a valid YYYY-MM-DD calendar date`);
  }
  return value;
}

function ensureMetric(value: unknown): TimeSeriesMetric {
  if (typeof value !== "string" || !(TIME_SERIES_METRICS as readonly string[]).includes(value)) {
    throw new AccountingError(400, `getTimeSeries: metric must be one of ${TIME_SERIES_METRICS.join(", ")}`);
  }
  return value as TimeSeriesMetric;
}

function ensureGranularity(value: unknown): TimeSeriesGranularity {
  if (typeof value !== "string" || !(TIME_SERIES_GRANULARITIES as readonly string[]).includes(value)) {
    throw new AccountingError(400, `getTimeSeries: granularity must be one of ${TIME_SERIES_GRANULARITIES.join(", ")}`);
  }
  return value as TimeSeriesGranularity;
}

function resolveAccountCode(metric: TimeSeriesMetric, raw: unknown): string | undefined {
  if (metric === "accountBalance") {
    if (typeof raw !== "string" || raw === "") {
      throw new AccountingError(400, "getTimeSeries: accountCode is required when metric is accountBalance");
    }
    return raw;
  }
  if (raw !== undefined && raw !== "") {
    throw new AccountingError(400, "getTimeSeries: accountCode is only allowed when metric is accountBalance");
  }
  return undefined;
}

export interface TimeSeriesReportInput {
  bookId?: string;
  metric: unknown;
  granularity: unknown;
  from: unknown;
  to: unknown;
  accountCode?: unknown;
}

export interface TimeSeriesReport {
  bookId: string;
  metric: TimeSeriesMetric;
  granularity: TimeSeriesGranularity;
  from: string;
  to: string;
  accountCode?: string;
  points: TimeSeriesPoint[];
}

interface ValidatedTimeSeriesInput {
  metric: TimeSeriesMetric;
  granularity: TimeSeriesGranularity;
  from: string;
  toDate: string;
  accountCode: string | undefined;
}

function validateTimeSeriesInput(input: TimeSeriesReportInput): ValidatedTimeSeriesInput {
  const metric = ensureMetric(input.metric);
  const granularity = ensureGranularity(input.granularity);
  const from = ensureValidYmd("from", input.from);
  const toDate = ensureValidYmd("to", input.to);
  if (from > toDate) throw new AccountingError(400, "getTimeSeries: from must be on or before to");
  const accountCode = resolveAccountCode(metric, input.accountCode);
  return { metric, granularity, from, toDate, accountCode };
}

interface TimeSeriesBookContext {
  bookId: string;
  fiscalYearEnd: FiscalYearEnd;
  accounts: Account[];
}

async function loadTimeSeriesBookContext(requestedBookId: string | undefined, workspaceRoot?: string): Promise<TimeSeriesBookContext> {
  const config = await loadOrInitConfig(workspaceRoot);
  const bookId = resolveBookId(config, requestedBookId);
  const book = findBook(config, bookId);
  // resolveBookId guarantees the book exists; resolveFiscalYearEnd
  // covers both the type-checker fallback and any legacy token that
  // slipped past the read-side normalisation.
  const fiscalYearEnd: FiscalYearEnd = resolveFiscalYearEnd(book?.fiscalYearEnd);
  const accounts = await readAccounts(bookId, workspaceRoot);
  return { bookId, fiscalYearEnd, accounts };
}

export async function getTimeSeriesReport(input: TimeSeriesReportInput, workspaceRoot?: string): Promise<TimeSeriesReport> {
  const { metric, granularity, from, toDate, accountCode } = validateTimeSeriesInput(input);
  const { bookId, fiscalYearEnd, accounts } = await loadTimeSeriesBookContext(input.bookId, workspaceRoot);
  if (accountCode && !accounts.some((acct) => acct.code === accountCode)) {
    throw new AccountingError(404, `getTimeSeries: account ${JSON.stringify(accountCode)} not found`);
  }
  const entries = await readAllEntries(bookId, workspaceRoot);
  const buckets = bucketize({ from, to: toDate, granularity, fiscalYearEnd });
  const points = buildTimeSeries({ buckets, entries, accounts, metric, accountCode });
  const report: TimeSeriesReport = { bookId, metric, granularity, from, to: toDate, points };
  if (accountCode) report.accountCode = accountCode;
  return report;
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
