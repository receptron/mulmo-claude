// Opening balance ("year-start B/S") logic. Adoption flow: a user
// migrating from another bookkeeping system enters their existing
// asset / liability / equity balances as of a chosen `asOfDate`,
// instead of replaying their entire historical journal.
//
// Stored as a single `kind: "opening"` entry in the regular journal
// — keeps the journal as the single source of truth, and makes
// reports treat the opening as just an early entry without special
// branches in aggregation.
//
// Replacing an existing opening: void the old, append the new. The
// route handler is responsible for ordering this with snapshot
// invalidation so the "before" snapshots get dropped.

import type { Account, JournalEntry, JournalLine } from "./types.js";
import { BALANCE_SHEET_ACCOUNT_TYPES } from "./types.js";
import { isValidCalendarDate, netBalance, voidedIdSet } from "./journal.js";

const EQUALITY_TOLERANCE = 0.005;

export interface OpeningValidationError {
  field: string;
  message: string;
}

export interface OpeningValidationResult {
  ok: boolean;
  errors: OpeningValidationError[];
}

/** Find the existing opening entry for a book, if any. Multiple
 *  openings shouldn't coexist (the route enforces void-then-append),
 *  but if they do the most recent by `createdAt` wins so callers
 *  always see one canonical opening. */
export function findActiveOpening(entries: readonly JournalEntry[]): JournalEntry | null {
  const voided = voidedIdSet(entries);
  let active: JournalEntry | null = null;
  for (const entry of entries) {
    if (entry.kind !== "opening") continue;
    if (voided.has(entry.id)) continue;
    if (!active || entry.createdAt > active.createdAt) active = entry;
  }
  return active;
}

interface OpeningValidationInput {
  asOfDate: string;
  lines: readonly JournalLine[];
  accounts: readonly Account[];
  existingEntries: readonly JournalEntry[];
}

function validateLineAccountTypes(input: OpeningValidationInput, errors: OpeningValidationError[]): void {
  const accountByCode = new Map(input.accounts.map((account) => [account.code, account]));
  input.lines.forEach((line, idx) => {
    const acct = accountByCode.get(line.accountCode);
    if (!acct) {
      errors.push({ field: `lines[${idx}].accountCode`, message: `unknown account code ${JSON.stringify(line.accountCode)}` });
      return;
    }
    if (!BALANCE_SHEET_ACCOUNT_TYPES.includes(acct.type)) {
      errors.push({
        field: `lines[${idx}].accountCode`,
        message: `account ${acct.code} is type ${acct.type}; opening balances may only reference balance-sheet accounts (asset / liability / equity)`,
      });
    }
  });
}

function validateAsOfPredatesEverything(input: OpeningValidationInput, errors: OpeningValidationError[]): void {
  // The point of the rule is "you can't enter an opening dated
  // 2026-01-01 if you've already booked transactions in December
  // 2025" — that would silently change the meaning of those
  // December transactions. Existing openings (about to be
  // replaced) and already-voided entries are exempt.
  const voided = voidedIdSet(input.existingEntries);
  for (const entry of input.existingEntries) {
    if (entry.kind === "opening") continue;
    if (entry.kind === "void-marker") continue;
    if (voided.has(entry.id)) continue;
    if (entry.date < input.asOfDate) {
      errors.push({
        field: "asOfDate",
        message: `cannot set opening as of ${input.asOfDate}: existing entry ${entry.id} dated ${entry.date} is older. Void it first or pick an earlier asOfDate.`,
      });
      break; // one error is enough — listing every conflicting entry would be noisy
    }
  }
}

/** Validate inputs for `setOpeningBalances`. Caller passes the full
 *  list of journal entries in the book so we can check the
 *  "asOfDate must precede every other entry" rule. */
export function validateOpening(input: OpeningValidationInput): OpeningValidationResult {
  const errors: OpeningValidationError[] = [];
  if (!isValidCalendarDate(input.asOfDate)) {
    errors.push({ field: "asOfDate", message: `expected YYYY-MM-DD calendar date, got ${JSON.stringify(input.asOfDate)}` });
  }
  if (!Array.isArray(input.lines) || input.lines.length < 2) {
    errors.push({ field: "lines", message: "an opening needs at least two lines" });
    return { ok: false, errors };
  }
  validateLineAccountTypes(input, errors);
  const net = netBalance(input.lines);
  if (Math.abs(net) > EQUALITY_TOLERANCE) {
    errors.push({ field: "lines", message: `Σ debit − Σ credit = ${net.toFixed(4)}; opening must balance` });
  }
  validateAsOfPredatesEverything(input, errors);
  return { ok: errors.length === 0, errors };
}
