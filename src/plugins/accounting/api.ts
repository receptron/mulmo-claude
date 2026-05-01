// Typed wrapper around POST /api/accounting. Centralises the action
// names and the response shapes so the View / sub-components don't
// repeat the cast at every call site.
//
// Every helper returns `ApiResult<T>` (the shared discriminated union
// from src/utils/api.ts) — callers pattern-match on `.ok`. There is
// no separate error-throwing path; all surfaces (network, HTTP, app
// validation) flow through the same shape.

import { apiPost, type ApiResult } from "../../utils/api";
import { API_ROUTES } from "../../config/apiRoutes";

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";
export type JournalEntryKind = "normal" | "opening" | "void" | "void-marker";

export interface Account {
  code: string;
  name: string;
  type: AccountType;
  note?: string;
}

export interface JournalLine {
  accountCode: string;
  debit?: number;
  credit?: number;
  memo?: string;
}

export interface JournalEntry {
  id: string;
  date: string;
  kind: JournalEntryKind;
  lines: JournalLine[];
  memo?: string;
  voidedEntryId?: string;
  voidReason?: string;
  createdAt: string;
}

export interface BookSummary {
  id: string;
  name: string;
  currency: string;
  createdAt: string;
}

export interface OpenAppPayload {
  kind: "accounting-app";
  bookId: string;
  initialTab?: string;
}

export interface AccountBalance {
  accountCode: string;
  netDebit: number;
}

export interface BalanceSheetSection {
  type: AccountType;
  rows: { accountCode: string; accountName: string; balance: number }[];
  total: number;
}

export interface BalanceSheet {
  asOf: string;
  sections: BalanceSheetSection[];
  imbalance: number;
}

export interface ProfitLoss {
  from: string;
  to: string;
  income: { rows: { accountCode: string; accountName: string; amount: number }[]; total: number };
  expense: { rows: { accountCode: string; accountName: string; amount: number }[]; total: number };
  netIncome: number;
}

export interface LedgerRow {
  entryId: string;
  date: string;
  kind: JournalEntryKind;
  memo?: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface Ledger {
  accountCode: string;
  accountName: string;
  rows: LedgerRow[];
  closingBalance: number;
}

export type ReportPeriod = { kind: "month"; period: string } | { kind: "range"; from: string; to: string };

function call<T>(action: string, args: Record<string, unknown> = {}): Promise<ApiResult<T>> {
  return apiPost<T>(API_ROUTES.accounting.dispatch, { action, ...args });
}

// ── Books ────────────────────────────────────────────────────────────

export function listBooks(): Promise<ApiResult<{ activeBookId: string; books: BookSummary[] }>> {
  return call("listBooks");
}

export function createBook(input: { name: string; currency?: string; id?: string }): Promise<ApiResult<{ book: BookSummary }>> {
  return call("createBook", input);
}

export function setActiveBook(bookId: string): Promise<ApiResult<{ activeBookId: string }>> {
  return call("setActiveBook", { bookId });
}

export function deleteBook(bookId: string): Promise<ApiResult<{ deletedBookId: string; activeBookId: string }>> {
  return call("deleteBook", { bookId, confirm: true });
}

// ── Accounts ─────────────────────────────────────────────────────────

export function listAccounts(bookId?: string): Promise<ApiResult<{ bookId: string; accounts: Account[] }>> {
  return call("listAccounts", { bookId });
}

export function upsertAccount(account: Account, bookId?: string): Promise<ApiResult<{ bookId: string; accounts: Account[] }>> {
  return call("upsertAccount", { account, bookId });
}

// ── Entries ──────────────────────────────────────────────────────────

export function addEntry(input: {
  date: string;
  lines: JournalLine[];
  memo?: string;
  bookId?: string;
}): Promise<ApiResult<{ bookId: string; entry: JournalEntry }>> {
  return call("addEntry", input);
}

export function voidEntry(input: {
  entryId: string;
  reason?: string;
  bookId?: string;
}): Promise<ApiResult<{ bookId: string; reverseEntry: JournalEntry; markerEntry: JournalEntry }>> {
  return call("voidEntry", input);
}

export function listEntries(input: {
  from?: string;
  to?: string;
  accountCode?: string;
  bookId?: string;
}): Promise<ApiResult<{ bookId: string; entries: JournalEntry[] }>> {
  return call("listEntries", input);
}

// ── Opening balances ─────────────────────────────────────────────────

export function getOpeningBalances(bookId?: string): Promise<ApiResult<{ bookId: string; opening: JournalEntry | null }>> {
  return call("getOpeningBalances", { bookId });
}

export function setOpeningBalances(input: {
  asOfDate: string;
  lines: JournalLine[];
  memo?: string;
  bookId?: string;
}): Promise<ApiResult<{ bookId: string; openingEntry: JournalEntry; replacedExisting: boolean }>> {
  return call("setOpeningBalances", input);
}

// ── Reports ──────────────────────────────────────────────────────────

export function getBalanceSheet(period: ReportPeriod, bookId?: string): Promise<ApiResult<{ bookId: string; balanceSheet: BalanceSheet }>> {
  return call("getReport", { kind: "balance", period, bookId });
}

export function getProfitLoss(period: ReportPeriod, bookId?: string): Promise<ApiResult<{ bookId: string; profitLoss: ProfitLoss }>> {
  return call("getReport", { kind: "pl", period, bookId });
}

export function getLedger(accountCode: string, period?: ReportPeriod, bookId?: string): Promise<ApiResult<{ bookId: string; ledger: Ledger }>> {
  return call("getReport", { kind: "ledger", accountCode, period, bookId });
}

// ── Admin ────────────────────────────────────────────────────────────

export function rebuildSnapshots(bookId?: string): Promise<ApiResult<{ bookId: string; rebuilt: string[] }>> {
  return call("rebuildSnapshots", { bookId });
}
