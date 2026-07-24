// Single source of truth for the accounting domain + report shapes that
// cross the server ↔ Vue boundary. Isomorphic (browser-safe): no `node:`
// or Vue imports reach this graph, so both surfaces `import type` the SAME
// declaration instead of hand-mirroring it. Adding a field here is seen by
// server tsc and Vue tsc at once — the drift that lets an API response grow
// while the frontend type stays stale (#2334) cannot happen.
//
// Server-only persistence shapes (AccountingConfig, MonthSnapshot) stay in
// ./server/types.ts; those never reach the browser.

import type { SupportedCountryCode } from "./countries";
import type { FiscalYearEnd } from "./fiscalYear";

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** B/S accounts (assets / liabilities / equity). Used by opening
 *  balance validation: opening entries reference balance-sheet
 *  accounts only. */
export const BALANCE_SHEET_ACCOUNT_TYPES: readonly AccountType[] = ["asset", "liability", "equity"];

export interface Account {
  /** Stable identifier the journal lines reference. Typically a
   *  numeric string ("1000" / "2000" …) but free-form is allowed
   *  so the user can adopt their existing numbering. */
  code: string;
  name: string;
  type: AccountType;
  /** Optional free-form note (tax bucket, parent group, …). Not
   *  interpreted by the engine — passes through verbatim. */
  note?: string;
  /** Soft-delete flag. When `false`, the account is hidden from
   *  entry/ledger dropdowns but stays visible in Manage Accounts
   *  and historical entries — accounting integrity requires that
   *  a code referenced by a journal line never disappears. Omitted
   *  (treated as active) by default to keep the JSON files clean
   *  for books created before this field existed. */
  active?: boolean;
}

export interface BookSummary {
  id: string;
  name: string;
  /** ISO 4217 (e.g. "USD" / "JPY"). Single-currency per book — no
   *  cross-book aggregation. */
  currency: string;
  /** ISO 3166-1 alpha-2 country code (e.g. "US" / "JP" / "GB").
   *  Identifies the tax jurisdiction the book is kept under so the
   *  Accounting role can give country-aware advice (Japanese T-number
   *  under インボイス制度, EU VAT ID, GSTIN, ABN, etc.). Constrained
   *  to `SupportedCountryCode` (the curated list shared with the UI
   *  dropdown and the LLM tool's JSON-schema enum) so a typo from any
   *  ingress path is rejected at the service layer rather than silently
   *  persisted. Optional for backward compatibility with books created
   *  before the field was introduced; the UI prompts existing books
   *  to set it. */
  country?: SupportedCountryCode;
  /** Calendar month (1-12) on whose LAST DAY the book's fiscal year
   *  closes — e.g. 8 = August 31, 12 = December 31 (calendar year).
   *  Drives the UI's "current quarter / current year" date-range
   *  shortcuts. Optional in the persisted shape for backward
   *  compatibility with books written before this field existed (and
   *  with the earlier "Q1".."Q4" token form) — read-side code
   *  normalises both via `resolveFiscalYearEnd`, treating an absent
   *  value as December. New books require it at the create boundary;
   *  the default is 12 (December). */
  fiscalYearEnd?: FiscalYearEnd;
  createdAt: string;
}

export type JournalEntryKind = "normal" | "opening" | "void" | "void-marker";

export interface JournalLine {
  accountCode: string;
  /** Use exactly one of debit / credit per line, both as positive
   *  numbers. The engine treats them as separate fields rather than
   *  a single signed amount so the input matches a standard
   *  bookkeeping form. */
  debit?: number;
  credit?: number;
  /** Per-line memo (the entry-level memo lives on JournalEntry). */
  memo?: string;
  /** Counterparty's tax-authority-issued registration ID for this
   *  line — Japanese 適格請求書発行事業者登録番号 (T-number), EU
   *  VAT identification number, UK VAT registration number, India
   *  GSTIN, Australia ABN, etc. Required for input-tax-credit
   *  eligibility under the Japanese インボイス制度 (effective
   *  2023-10-01) and equivalent regimes elsewhere. Free-form string;
   *  format validation belongs upstream (per-jurisdiction). */
  taxRegistrationId?: string;
}

export interface JournalEntry {
  /** Globally unique within a book — ULID-style; ordering by id
   *  reproduces creation order. */
  id: string;
  /** Calendar date the entry is booked for (YYYY-MM-DD). The month
   *  part decides which `journal/YYYY-MM.jsonl` file the entry lives
   *  in; entries can be for any past / future date. */
  date: string;
  kind: JournalEntryKind;
  lines: JournalLine[];
  /** Entry-level memo. */
  memo?: string;
  /** When `kind === "void-marker"`: id of the entry being voided.
   *  When `kind === "void"`: the system-generated reverse entry
   *  references the original via this field. */
  voidedEntryId?: string;
  /** Reason supplied by the user when voiding. */
  voidReason?: string;
  /** When this entry was posted via the "edit" flow (void-then-add),
   *  this is the id of the entry it replaces. The void + new-entry
   *  pair is *not* atomic on the server — the client issues two
   *  sequential calls — but recording the link here makes the
   *  edit chain queryable later (e.g. "what corrected entry X?"). */
  replacesEntryId?: string;
  /** ISO timestamp the entry was appended to the journal — the
   *  authoritative "when did this hit the books" clock. Distinct
   *  from `date`, which is the user-visible booking date. */
  createdAt: string;
}

/** Aggregated balance per account at a point in time. The signed
 *  number is debit − credit; downstream display logic converts to
 *  natural sign per account type (assets debit-positive, liabilities
 *  credit-positive). */
export interface AccountBalance {
  accountCode: string;
  /** Σ debit − Σ credit across all entries up to and including the
   *  snapshot's period end. */
  netDebit: number;
}

/** Period selector for reports. Either a single closing month or a
 *  date range. Always inclusive on both ends. */
export type ReportPeriod = { kind: "month"; period: string } | { kind: "range"; from: string; to: string };

// ── Report result shapes (server computes, Vue renders) ──────────────

export interface BalanceSheetSection {
  type: AccountType;
  rows: { accountCode: string; accountName: string; balance: number }[];
  total: number;
}

export interface BalanceSheet {
  asOf: string; // ISO date; period end
  sections: BalanceSheetSection[];
  /** Σ assets − Σ (liabilities + equity). Should be 0 (the
   *  accounting equation); a non-zero here indicates either a
   *  rounding artefact or a data problem. */
  imbalance: number;
}

export interface ProfitLoss {
  from: string; // inclusive ISO date
  to: string; // inclusive ISO date
  income: { rows: { accountCode: string; accountName: string; amount: number }[]; total: number };
  expense: { rows: { accountCode: string; accountName: string; amount: number }[]; total: number };
  netIncome: number; // income − expense
}

export interface LedgerRow {
  entryId: string;
  date: string;
  kind: JournalEntryKind;
  memo?: string;
  debit: number;
  credit: number;
  /** Running netDebit balance for this account, in entry order. */
  runningBalance: number;
  /** Counterparty tax-registration ID copied from the source
   *  journal line (T-number / VAT ID / GSTIN / ABN). Surfaced as a
   *  Ledger column when the active account is in the input-tax
   *  band (14xx — see `isTaxAccountCode` in
   *  src/vue/components/accountNumbering.ts). Carried per row even on
   *  non-tax accounts so a future view that wants to show it
   *  elsewhere doesn't need a server change. */
  taxRegistrationId?: string;
}

export interface Ledger {
  accountCode: string;
  accountName: string;
  rows: LedgerRow[];
  /** Closing netDebit balance — the sum at the bottom of `rows`. */
  closingBalance: number;
}
