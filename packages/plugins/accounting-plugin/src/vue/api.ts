// Typed wrapper around POST /api/accounting. Centralises the action
// names and the response shapes so the View / sub-components don't
// repeat the cast at every call site.
//
// Every helper returns `ApiResult<T>` (the discriminated union mirrored
// in hostContext.ts) — callers pattern-match on `.ok`. There is no
// separate error-throwing path; all surfaces (network, HTTP, app
// validation) flow through the same shape. The actual network client is
// host-injected (see hostContext.ts) so the package stays host-agnostic.

import { hostApiCall as apiCall, type ApiResult } from "./hostContext";
import {
  ACCOUNTING_ACTIONS,
  ACCOUNTING_API,
  type SupportedCountryCode,
  type FiscalYearEnd,
  type TimeSeriesGranularity,
  type TimeSeriesMetric,
  type Account,
  type AccountBalance,
  type AccountType,
  type BalanceSheet,
  type BalanceSheetSection,
  type BookSummary,
  type JournalEntry,
  type JournalEntryKind,
  type JournalLine,
  type Ledger,
  type LedgerRow,
  type ProfitLoss,
  type ReportPeriod,
} from "../shared";

// The domain + report shapes are single-sourced in ../shared/types.ts so
// the server and this client can't drift (see #2411). Re-exported here so
// the View / sub-components keep importing both the API function and its
// result type from this one module (`../api`).
export type {
  Account,
  AccountBalance,
  AccountType,
  BalanceSheet,
  BalanceSheetSection,
  BookSummary,
  JournalEntry,
  JournalEntryKind,
  JournalLine,
  Ledger,
  LedgerRow,
  ProfitLoss,
  ReportPeriod,
};

export interface OpenAppPayload {
  kind: "accounting-app";
  /** `null` when the workspace has zero books — the View renders the
   *  empty state and prompts for book creation. */
  bookId: string | null;
  initialTab?: string;
}

// The single dispatch route this plugin owns — shared with the server
// router via `ACCOUNTING_API` so the two can't drift.
const DISPATCH_URL = ACCOUNTING_API.dispatch.path;
const DISPATCH_METHOD = ACCOUNTING_API.dispatch.method;

function call<T>(action: string, args: Record<string, unknown> = {}): Promise<ApiResult<T>> {
  return apiCall<T>(DISPATCH_URL, { method: DISPATCH_METHOD, body: { action, ...args } });
}

// ── Books ────────────────────────────────────────────────────────────

export function getBooks(): Promise<ApiResult<{ books: BookSummary[] }>> {
  return call(ACCOUNTING_ACTIONS.getBooks);
}

export function createBook(input: {
  name: string;
  currency?: string;
  country?: SupportedCountryCode;
  /** Closing month 1-12 — required at the form boundary, but the
   *  server silently defaults an absent value to 12 (December). */
  fiscalYearEnd?: FiscalYearEnd;
}): Promise<ApiResult<{ book: BookSummary }>> {
  return call(ACCOUNTING_ACTIONS.createBook, input);
}

export function updateBook(input: {
  bookId: string;
  name?: string;
  /** Pass `""` to explicitly clear the country (server treats it as
   *  the "drop the field" sentinel). Any other value must be one of
   *  the curated `SupportedCountryCode`s. */
  country?: SupportedCountryCode | "";
  /** Closing month 1-12 — pure metadata, only changes how the
   *  date-range shortcuts resolve. No "clear" path; absence leaves the
   *  existing value untouched. */
  fiscalYearEnd?: FiscalYearEnd;
}): Promise<ApiResult<{ book: BookSummary }>> {
  return call(ACCOUNTING_ACTIONS.updateBook, input);
}

export function deleteBook(bookId: string): Promise<ApiResult<{ deletedBookId: string; deletedBookName: string }>> {
  return call(ACCOUNTING_ACTIONS.deleteBook, { bookId, confirm: true });
}

// ── Accounts ─────────────────────────────────────────────────────────

export function getAccounts(bookId: string): Promise<ApiResult<{ bookId: string; accounts: Account[] }>> {
  return call(ACCOUNTING_ACTIONS.getAccounts, { bookId });
}

export function upsertAccount(account: Account, bookId: string): Promise<ApiResult<{ bookId: string; account: Account; accounts: Account[] }>> {
  return call(ACCOUNTING_ACTIONS.upsertAccount, { account, bookId });
}

// ── Entries ──────────────────────────────────────────────────────────

export interface AddEntriesItemInput {
  date: string;
  lines: JournalLine[];
  memo?: string;
  /** When set, marks this entry as the replacement posted via the
   *  "edit" flow. The caller is expected to have voided
   *  `replacesEntryId` separately just before this call — there is
   *  no atomic transaction. */
  replacesEntryId?: string;
}

export function addEntries(input: {
  bookId: string;
  /** One or more entries to post. The server validates every entry
   *  before any write, so a single bad entry rejects the whole
   *  batch. Pass a single-element array to post just one entry. */
  entries: AddEntriesItemInput[];
}): Promise<ApiResult<{ bookId: string; entries: JournalEntry[] }>> {
  return call(ACCOUNTING_ACTIONS.addEntries, input);
}

export function voidEntry(input: {
  entryId: string;
  reason?: string;
  bookId: string;
}): Promise<ApiResult<{ bookId: string; reverseEntry: JournalEntry; markerEntry: JournalEntry }>> {
  return call(ACCOUNTING_ACTIONS.voidEntry, input);
}

export function getJournalEntries(input: {
  from?: string;
  to?: string;
  accountCode?: string;
  bookId: string;
}): Promise<ApiResult<{ bookId: string; entries: JournalEntry[]; voidedEntryIds: string[] }>> {
  return call(ACCOUNTING_ACTIONS.getJournalEntries, input);
}

// ── Opening balances ─────────────────────────────────────────────────

export function getOpeningBalances(bookId: string): Promise<ApiResult<{ bookId: string; opening: JournalEntry | null }>> {
  return call(ACCOUNTING_ACTIONS.getOpeningBalances, { bookId });
}

export function setOpeningBalances(input: {
  asOfDate: string;
  lines: JournalLine[];
  memo?: string;
  bookId: string;
}): Promise<ApiResult<{ bookId: string; openingEntry: JournalEntry; replacedExisting: boolean }>> {
  return call(ACCOUNTING_ACTIONS.setOpeningBalances, input);
}

// ── Reports ──────────────────────────────────────────────────────────

export function getBalanceSheet(period: ReportPeriod, bookId: string): Promise<ApiResult<{ bookId: string; balanceSheet: BalanceSheet }>> {
  return call(ACCOUNTING_ACTIONS.getReport, { kind: "balance", period, bookId });
}

export function getProfitLoss(period: ReportPeriod, bookId: string): Promise<ApiResult<{ bookId: string; profitLoss: ProfitLoss }>> {
  return call(ACCOUNTING_ACTIONS.getReport, { kind: "pl", period, bookId });
}

export function getLedger(accountCode: string, period: ReportPeriod | undefined, bookId: string): Promise<ApiResult<{ bookId: string; ledger: Ledger }>> {
  return call(ACCOUNTING_ACTIONS.getReport, { kind: "ledger", accountCode, period, bookId });
}

export interface TimeSeriesPoint {
  label: string;
  from: string;
  to: string;
  value: number;
}

export interface TimeSeriesInput {
  bookId: string;
  metric: TimeSeriesMetric;
  granularity: TimeSeriesGranularity;
  /** Inclusive YYYY-MM-DD lower bound. The first bucket is the one
   *  CONTAINING this date — it can extend earlier. */
  from: string;
  /** Inclusive YYYY-MM-DD upper bound. The last bucket is the one
   *  CONTAINING this date — it can extend later. */
  to: string;
  /** Required when metric === "accountBalance"; forbidden otherwise.
   *  The server returns a 400 either way. */
  accountCode?: string;
}

export interface TimeSeriesResult {
  bookId: string;
  metric: TimeSeriesMetric;
  granularity: TimeSeriesGranularity;
  from: string;
  to: string;
  accountCode?: string;
  points: TimeSeriesPoint[];
}

export function getTimeSeries(input: TimeSeriesInput): Promise<ApiResult<TimeSeriesResult>> {
  // Spread so the named interface is widened into a fresh object
  // literal — `call()` takes `Record<string, unknown>` which a
  // declared interface doesn't satisfy structurally in TS.
  return call(ACCOUNTING_ACTIONS.getTimeSeries, { ...input });
}

// ── Admin ────────────────────────────────────────────────────────────

export function rebuildSnapshots(bookId: string): Promise<ApiResult<{ bookId: string; rebuilt: string[] }>> {
  return call(ACCOUNTING_ACTIONS.rebuildSnapshots, { bookId });
}
