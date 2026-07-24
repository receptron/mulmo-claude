// Aggregation: balance sheet, profit & loss, and ledger from journal
// entries. Pure — feeds on the entries and accounts caller has
// already loaded. Snapshot-aware aggregation is layered on top in
// `snapshotCache.ts`, which calls into here.

import type { Account, AccountBalance, AccountType, BalanceSheet, BalanceSheetSection, JournalEntry, Ledger, LedgerRow, ProfitLoss } from "../shared/types.js";

const ZERO_TOLERANCE = 0.0049; // hide rows that round to 0 at 2dp

/** Collapse an accountCode → netDebit map into the sorted
 *  `AccountBalance[]` wire shape. Shared by `aggregateBalances` and
 *  the snapshot cache's `mergeBalances` so the two produce identical,
 *  deterministically ordered output. */
export function sortedBalancesFromMap(balanceByCode: ReadonlyMap<string, number>): AccountBalance[] {
  return Array.from(balanceByCode.entries())
    .map(([accountCode, netDebit]) => ({ accountCode, netDebit }))
    .sort((lhs, rhs) => lhs.accountCode.localeCompare(rhs.accountCode));
}

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
  return sortedBalancesFromMap(map);
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

interface LedgerLineAccumulator {
  rows: LedgerRow[];
  running: number;
}

/** Concatenate the entry-level memo (the *what-happened*) with the
 *  line-level memo (the *why-this-account*) so a per-account ledger
 *  view shows both. Without this combine, a Sales Tax Receivable
 *  ledger row would show "仮払消費税 10%" but lose the originating
 *  "Starbucks Tokyo — coffee" — and the user can't tell which
 *  transaction the row came from. Identity-collapse handles the
 *  case where someone set both fields to the same string. */
function combineMemo(entryMemo: string | undefined, lineMemo: string | undefined): string | undefined {
  if (!entryMemo) return lineMemo;
  if (!lineMemo) return entryMemo;
  if (entryMemo === lineMemo) return entryMemo;
  return `${entryMemo} · ${lineMemo}`;
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
    const row: LedgerRow = {
      entryId: entry.id,
      date: entry.date,
      kind: entry.kind,
      memo: combineMemo(entry.memo, line.memo),
      debit,
      credit,
      runningBalance: acc.running,
    };
    if (line.taxRegistrationId !== undefined) row.taxRegistrationId = line.taxRegistrationId;
    acc.rows.push(row);
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
