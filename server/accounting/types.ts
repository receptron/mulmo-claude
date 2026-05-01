// Domain types for the accounting plugin (opt-in, custom-Role only).
//
// Source-of-truth files on disk:
//   data/accounting/config.json                 ← AccountingConfig
//   data/accounting/books/<id>/accounts.json    ← Account[]
//   data/accounting/books/<id>/journal/YYYY-MM.jsonl  ← JournalEntry per line
//   data/accounting/books/<id>/snapshots/YYYY-MM.json ← MonthSnapshot (cache)
//   data/accounting/books/<id>/meta.json        ← BookMeta
//
// Snapshots are cache only — journal is the single source of truth.

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
}

export interface BookMeta {
  /** Fiscal year start as MM-DD (e.g. "01-01" or "04-01"). Cosmetic
   *  for now; report period selectors use the calendar year, not the
   *  fiscal year. */
  fiscalYearStart?: string;
  createdAt: string; // ISO timestamp
  /** Free-form description of the book purpose. */
  description?: string;
}

export interface BookSummary {
  id: string;
  name: string;
  /** ISO 4217 (e.g. "USD" / "JPY"). Single-currency per book — no
   *  cross-book aggregation. */
  currency: string;
  createdAt: string;
}

export interface AccountingConfig {
  /** ID of the book the View should show by default. Always points
   *  at an existing book (createBook sets this if there's none). */
  activeBookId: string;
  books: BookSummary[];
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

export interface MonthSnapshot {
  /** "YYYY-MM" — the closing month covered. */
  period: string;
  /** Closing balances at end of `period`. */
  balances: AccountBalance[];
  /** ISO timestamp the snapshot file was written. */
  builtAt: string;
}

/** Period selector for reports. Either a single closing month or a
 *  date range. Always inclusive on both ends. */
export type ReportPeriod = { kind: "month"; period: string } | { kind: "range"; from: string; to: string };
