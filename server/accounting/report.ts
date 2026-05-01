// Aggregation: balance sheet, profit & loss, and ledger from journal
// entries. Pure — feeds on the entries and accounts caller has
// already loaded. Snapshot-aware aggregation is layered on top in
// `snapshotCache.ts`, which calls into here.

import type { Account, AccountBalance, AccountType, JournalEntry } from "./types.js";

const ZERO_TOLERANCE = 0.0049; // hide rows that round to 0 at 2dp

/** Returns net (debit − credit) per account across the supplied
 *  entries. Voids work by having an original + reverse pair that
 *  cancel mathematically — both are included in aggregation (their
 *  contributions sum to zero). The `void-marker` entries carry no
 *  lines, so excluding them is just a formality.
 *
 *  Why not "exclude original via voidedIdSet"? Because then the
 *  reverse half would remain unmatched, and the net would be the
 *  original's amount with the wrong sign. Letting the math cancel
 *  naturally is simpler and impossible to get wrong. */
export function aggregateBalances(entries: readonly JournalEntry[]): AccountBalance[] {
  const map = new Map<string, number>();
  for (const entry of entries) {
    if (entry.kind === "void-marker") continue;
    for (const line of entry.lines) {
      const cur = map.get(line.accountCode) ?? 0;
      const debit = line.debit ?? 0;
      const credit = line.credit ?? 0;
      map.set(line.accountCode, cur + debit - credit);
    }
  }
  return Array.from(map.entries())
    .map(([accountCode, netDebit]) => ({ accountCode, netDebit }))
    .sort((lhs, rhs) => lhs.accountCode.localeCompare(rhs.accountCode));
}

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

function naturalSign(type: AccountType, netDebit: number): number {
  // Assets / expenses are debit-positive (positive netDebit reads
  // as a positive presentation balance). Liabilities / equity /
  // income are credit-positive — flip the sign for display.
  if (type === "asset" || type === "expense") return netDebit;
  return -netDebit;
}

/** Sentinel `accountCode` for the synthetic "Current period
 *  earnings" row added to the Equity section by `buildBalanceSheet`.
 *  The View detects this code and substitutes a localised label
 *  for the fixed English fallback. */
export const CURRENT_EARNINGS_ACCOUNT_CODE = "_currentEarnings";

function computeCurrentEarnings(accounts: readonly Account[], balanceByCode: ReadonlyMap<string, number>): number {
  // Σ income − Σ expense, in natural-sign presentation. Without
  // this synthetic Equity row the B/S would be off by exactly net
  // income during the period, because closing entries that fold
  // income/expense into Retained Earnings haven't been booked yet.
  let earnings = 0;
  for (const account of accounts) {
    if (account.type !== "income" && account.type !== "expense") continue;
    const presented = naturalSign(account.type, balanceByCode.get(account.code) ?? 0);
    earnings += account.type === "income" ? presented : -presented;
  }
  return earnings;
}

export function buildBalanceSheet(input: { accounts: readonly Account[]; balances: readonly AccountBalance[]; asOf: string }): BalanceSheet {
  const balanceByCode = new Map(input.balances.map((row) => [row.accountCode, row.netDebit]));
  const currentEarnings = computeCurrentEarnings(input.accounts, balanceByCode);
  const sections: BalanceSheetSection[] = [];
  for (const type of ["asset", "liability", "equity"] as const) {
    const rows: BalanceSheetSection["rows"] = [];
    let total = 0;
    for (const account of input.accounts) {
      if (account.type !== type) continue;
      const netDebit = balanceByCode.get(account.code) ?? 0;
      const presented = naturalSign(type, netDebit);
      if (Math.abs(presented) <= ZERO_TOLERANCE) continue;
      rows.push({ accountCode: account.code, accountName: account.name, balance: presented });
      total += presented;
    }
    if (type === "equity" && Math.abs(currentEarnings) > ZERO_TOLERANCE) {
      rows.push({ accountCode: CURRENT_EARNINGS_ACCOUNT_CODE, accountName: "Current period earnings", balance: currentEarnings });
      total += currentEarnings;
    }
    sections.push({ type, rows, total });
  }
  const assetTotal = sections[0].total;
  const liabEquityTotal = sections[1].total + sections[2].total;
  return {
    asOf: input.asOf,
    sections,
    imbalance: assetTotal - liabEquityTotal,
  };
}

export interface ProfitLoss {
  from: string; // inclusive ISO date
  to: string; // inclusive ISO date
  income: { rows: { accountCode: string; accountName: string; amount: number }[]; total: number };
  expense: { rows: { accountCode: string; accountName: string; amount: number }[]; total: number };
  netIncome: number; // income − expense
}

export function buildProfitLoss(input: { accounts: readonly Account[]; entries: readonly JournalEntry[]; from: string; to: string }): ProfitLoss {
  const inRange = input.entries.filter((entry) => entry.date >= input.from && entry.date <= input.to);
  const balances = aggregateBalances(inRange);
  const balanceByCode = new Map(balances.map((row) => [row.accountCode, row.netDebit]));
  const incomeRows: ProfitLoss["income"]["rows"] = [];
  const expenseRows: ProfitLoss["expense"]["rows"] = [];
  let incomeTotal = 0;
  let expenseTotal = 0;
  for (const account of input.accounts) {
    const netDebit = balanceByCode.get(account.code) ?? 0;
    const presented = naturalSign(account.type, netDebit);
    if (Math.abs(presented) <= ZERO_TOLERANCE) continue;
    if (account.type === "income") {
      incomeRows.push({ accountCode: account.code, accountName: account.name, amount: presented });
      incomeTotal += presented;
    } else if (account.type === "expense") {
      expenseRows.push({ accountCode: account.code, accountName: account.name, amount: presented });
      expenseTotal += presented;
    }
  }
  return {
    from: input.from,
    to: input.to,
    income: { rows: incomeRows, total: incomeTotal },
    expense: { rows: expenseRows, total: expenseTotal },
    netIncome: incomeTotal - expenseTotal,
  };
}

export interface LedgerRow {
  entryId: string;
  date: string;
  kind: JournalEntry["kind"];
  memo?: string;
  debit: number;
  credit: number;
  /** Running netDebit balance for this account, in entry order. */
  runningBalance: number;
}

export interface Ledger {
  accountCode: string;
  accountName: string;
  rows: LedgerRow[];
  /** Closing netDebit balance — the sum at the bottom of `rows`. */
  closingBalance: number;
}

interface LedgerLineAccumulator {
  rows: LedgerRow[];
  running: number;
}

function accumulateLedgerEntry(
  entry: JournalEntry,
  accountCode: string,
  fromDate: string | undefined,
  toDate: string | undefined,
  acc: LedgerLineAccumulator,
): void {
  if (entry.kind === "void-marker") return;
  for (const line of entry.lines) {
    if (line.accountCode !== accountCode) continue;
    const debit = line.debit ?? 0;
    const credit = line.credit ?? 0;
    acc.running += debit - credit;
    if (fromDate && entry.date < fromDate) continue;
    if (toDate && entry.date > toDate) continue;
    acc.rows.push({
      entryId: entry.id,
      date: entry.date,
      kind: entry.kind,
      memo: line.memo ?? entry.memo,
      debit,
      credit,
      runningBalance: acc.running,
    });
  }
}

export function buildLedger(input: { account: Account; entries: readonly JournalEntry[]; from?: string; to?: string }): Ledger {
  // Same rule as `aggregateBalances`: include original and reverse
  // for the math to cancel; exclude markers. The reverse entry
  // itself carries `kind: "void"` so the row is visually
  // distinguishable in the ledger.
  const sorted = [...input.entries].sort((lhs, rhs) => (lhs.date === rhs.date ? lhs.createdAt.localeCompare(rhs.createdAt) : lhs.date.localeCompare(rhs.date)));
  const acc: LedgerLineAccumulator = { rows: [], running: 0 };
  for (const entry of sorted) {
    accumulateLedgerEntry(entry, input.account.code, input.from, input.to, acc);
  }
  return {
    accountCode: input.account.code,
    accountName: input.account.name,
    rows: acc.rows,
    closingBalance: acc.running,
  };
}
