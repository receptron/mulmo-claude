// Server-only persistence shapes for the accounting plugin. The
// browser-crossing domain + report types live in ../shared/types.ts and
// are imported by both surfaces; this file holds only the shapes that
// never reach the Vue client.
//
// Source-of-truth files on disk:
//   data/accounting/config.json                 ← AccountingConfig
//   data/accounting/books/<id>/accounts.json    ← Account[]
//   data/accounting/books/<id>/journal/YYYY-MM.jsonl  ← JournalEntry per line
//   data/accounting/books/<id>/snapshots/YYYY-MM.json ← MonthSnapshot (cache)
//
// Snapshots are cache only — journal is the single source of truth.

import type { AccountBalance, BookSummary } from "../shared/types.js";

export interface AccountingConfig {
  books: BookSummary[];
}

export interface MonthSnapshot {
  /** "YYYY-MM" — the closing month covered. */
  period: string;
  /** Closing balances at end of `period`. */
  balances: AccountBalance[];
  /** ISO timestamp the snapshot file was written. */
  builtAt: string;
}
