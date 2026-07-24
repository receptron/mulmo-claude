// Time-series aggregation for the accounting plugin: bucketise a
// date range by month / fiscal quarter / fiscal year and roll up a
// metric (revenue / expense / net income / closing balance of a
// specific account) into a chart-ready `(label, value)[]` series.
//
// LLM-facing only — the in-canvas Accounting `<View>` keeps using
// `getReport` for its tab-driven UI. `getTimeSeries` exists so a
// single tool round-trip can answer "chart my quarterly revenue
// over the last two years" without the LLM fanning out N calls and
// stitching the buckets itself.
//
// Pure module: no I/O, no service-layer awareness. Caller hands in
// the entries / accounts already loaded; we return the points.

import type { Account, AccountType, JournalEntry } from "../shared/types.js";
import { aggregateBalances } from "./report.js";
import {
  fiscalYearEndMonth,
  type FiscalYearEnd,
  TIME_SERIES_GRANULARITIES,
  TIME_SERIES_METRICS,
  type TimeSeriesGranularity,
  type TimeSeriesMetric,
} from "../shared";

export { TIME_SERIES_GRANULARITIES, TIME_SERIES_METRICS };
export type { TimeSeriesGranularity, TimeSeriesMetric };

export interface Bucket {
  /** Inclusive YYYY-MM-DD lower bound. */
  from: string;
  /** Inclusive YYYY-MM-DD upper bound. */
  to: string;
  /** Chart x-axis label. Format depends on granularity:
   *  "YYYY-MM" / "FY{endYear}-Q{1..4}" / "FY{endYear}". For fiscal
   *  years that don't align with the calendar year (Q1/Q2/Q3 books)
   *  the FY is named by its END calendar year — matches Japanese
   *  "令和7年度" convention (Apr 2025 - Mar 2026 = FY2026). */
  label: string;
}

export interface TimeSeriesPoint {
  label: string;
  from: string;
  to: string;
  /** Single number, natural-sign per metric. Revenue and net income
   *  positive when income exceeds expense; expense reported as a
   *  positive cost; account balance follows the account's display
   *  sign (assets debit-positive, liabilities/equity credit-positive). */
  value: number;
}

// ── date arithmetic (pure, no Date for parsing/formatting) ─────────

function pad2(num: number): string {
  return String(num).padStart(2, "0");
}

function fmtYmd(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

interface YmdParts {
  year: number;
  month: number;
  day: number;
}

function parseYmd(value: string): YmdParts {
  const [year, month, day] = value.split("-").map((segment) => parseInt(segment, 10));
  return { year, month, day };
}

function lastDayOf(year: number, month: number): number {
  // UTC day 0 of next month = last day of this month, immune to TZ.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addDay(date: YmdParts): YmdParts {
  const stepped = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
  return {
    year: stepped.getUTCFullYear(),
    month: stepped.getUTCMonth() + 1,
    day: stepped.getUTCDate(),
  };
}

// ── fiscal-year arithmetic (year-month, no Date) ───────────────────

interface FyAnchor {
  /** Calendar year the fiscal year STARTED in. */
  fyStartYear: number;
  /** Calendar year the fiscal year ENDS in (used for labelling). */
  fyEndYear: number;
  /** First calendar month of the fiscal year (1-based). */
  startMonth: number;
}

function fyAnchorFor(date: YmdParts, end: FiscalYearEnd): FyAnchor {
  const closingMonth = fiscalYearEndMonth(end);
  const startMonth = (closingMonth % 12) + 1; // month after the close
  // FY containing date: started this calendar year if date.month is
  // at-or-after startMonth, else previous calendar year. Q4 books
  // (startMonth = 1) always land in the same calendar year — covered
  // by the same predicate.
  const fyStartYear = date.month >= startMonth ? date.year : date.year - 1;
  const fyEndYear = closingMonth === 12 ? fyStartYear : fyStartYear + 1;
  return { fyStartYear, fyEndYear, startMonth };
}

// ── per-granularity bucket lookup ──────────────────────────────────

function monthBucketContaining(date: YmdParts): Bucket {
  return {
    from: fmtYmd(date.year, date.month, 1),
    to: fmtYmd(date.year, date.month, lastDayOf(date.year, date.month)),
    label: `${date.year}-${pad2(date.month)}`,
  };
}

function quarterBucketContaining(date: YmdParts, end: FiscalYearEnd): Bucket {
  const anchor = fyAnchorFor(date, end);
  const offset = (date.month - anchor.startMonth + 12) % 12; // 0..11
  const qIdx = Math.floor(offset / 3); // 0..3
  // Flat month-index from the calendar epoch makes year rollover
  // arithmetic trivial.
  const startFlat = anchor.fyStartYear * 12 + (anchor.startMonth - 1) + qIdx * 3;
  const endFlat = startFlat + 2;
  const qStartYear = Math.floor(startFlat / 12);
  const qStartMonth = (startFlat % 12) + 1;
  const qEndYear = Math.floor(endFlat / 12);
  const qEndMonth = (endFlat % 12) + 1;
  return {
    from: fmtYmd(qStartYear, qStartMonth, 1),
    to: fmtYmd(qEndYear, qEndMonth, lastDayOf(qEndYear, qEndMonth)),
    label: `FY${anchor.fyEndYear}-Q${qIdx + 1}`,
  };
}

function yearBucketContaining(date: YmdParts, end: FiscalYearEnd): Bucket {
  const anchor = fyAnchorFor(date, end);
  const startFlat = anchor.fyStartYear * 12 + (anchor.startMonth - 1);
  const endFlat = startFlat + 11;
  const yStartYear = Math.floor(startFlat / 12);
  const yStartMonth = (startFlat % 12) + 1;
  const yEndYear = Math.floor(endFlat / 12);
  const yEndMonth = (endFlat % 12) + 1;
  return {
    from: fmtYmd(yStartYear, yStartMonth, 1),
    to: fmtYmd(yEndYear, yEndMonth, lastDayOf(yEndYear, yEndMonth)),
    label: `FY${anchor.fyEndYear}`,
  };
}

function bucketContaining(date: YmdParts, granularity: TimeSeriesGranularity, end: FiscalYearEnd): Bucket {
  if (granularity === "month") return monthBucketContaining(date);
  if (granularity === "quarter") return quarterBucketContaining(date, end);
  return yearBucketContaining(date, end);
}

/** Walk inclusive `[from, to]` and return every bucket that overlaps
 *  it, ordered ascending by `from`. The first bucket is the one
 *  CONTAINING `from` — it can extend earlier than `from`; the last
 *  bucket is the one CONTAINING `to` — it can extend past `to`. The
 *  caller's response echoes the input range so the LLM can label the
 *  chart truthfully ("Revenue Apr 2025 – Sep 2026" even though the
 *  outermost buckets cover Apr-Jun 2025 and Jul-Sep 2026). */
export function bucketize(input: { from: string; to: string; granularity: TimeSeriesGranularity; fiscalYearEnd: FiscalYearEnd }): Bucket[] {
  if (input.from > input.to) return [];
  const start = parseYmd(input.from);
  const result: Bucket[] = [];
  let bucket = bucketContaining(start, input.granularity, input.fiscalYearEnd);
  // Buckets are contiguous; once a bucket's `from` is past `input.to`
  // every subsequent bucket is too.
  while (bucket.from <= input.to) {
    result.push(bucket);
    const next = addDay(parseYmd(bucket.to));
    bucket = bucketContaining(next, input.granularity, input.fiscalYearEnd);
  }
  return result;
}

// ── value computation ──────────────────────────────────────────────

/** Convert raw netDebit to natural-sign presentation per account
 *  type. Mirrors the helper in `report.ts` (kept private there). */
function naturalSign(type: AccountType, netDebit: number): number {
  if (type === "asset" || type === "expense") return netDebit;
  return -netDebit;
}

interface PresentationTotals {
  income: number;
  expense: number;
}

/** Sum presented income and expense values across the supplied
 *  entries. Used for window-based metrics (revenue / expense /
 *  netIncome). Opening entries reference B/S accounts only and so
 *  contribute zero to either total — including them is harmless. */
function presentedPlTotals(entries: readonly JournalEntry[], accountTypeByCode: ReadonlyMap<string, AccountType>): PresentationTotals {
  const balances = aggregateBalances(entries);
  let income = 0;
  let expense = 0;
  for (const row of balances) {
    const type = accountTypeByCode.get(row.accountCode);
    if (!type) continue;
    if (type === "income") income += naturalSign(type, row.netDebit);
    else if (type === "expense") expense += naturalSign(type, row.netDebit);
  }
  return { income, expense };
}

function entriesInWindow(entries: readonly JournalEntry[], from: string, toDate: string): JournalEntry[] {
  return entries.filter((entry) => entry.date >= from && entry.date <= toDate);
}

function entriesUpTo(entries: readonly JournalEntry[], toDate: string): JournalEntry[] {
  return entries.filter((entry) => entry.date <= toDate);
}

function valueForBucket(input: {
  bucket: Bucket;
  entries: readonly JournalEntry[];
  accounts: readonly Account[];
  metric: TimeSeriesMetric;
  accountCode?: string;
}): number {
  const accountTypeByCode = new Map(input.accounts.map((acct) => [acct.code, acct.type]));
  if (input.metric === "accountBalance") {
    const code = input.accountCode;
    if (!code) return 0; // guarded at the route — defensive zero.
    const type = accountTypeByCode.get(code);
    if (!type) return 0;
    const cumulative = entriesUpTo(input.entries, input.bucket.to);
    const balances = aggregateBalances(cumulative);
    const row = balances.find((balance) => balance.accountCode === code);
    return row ? naturalSign(type, row.netDebit) : 0;
  }
  const window = entriesInWindow(input.entries, input.bucket.from, input.bucket.to);
  const totals = presentedPlTotals(window, accountTypeByCode);
  if (input.metric === "revenue") return totals.income;
  if (input.metric === "expense") return totals.expense;
  return totals.income - totals.expense; // netIncome
}

export function buildTimeSeries(input: {
  buckets: readonly Bucket[];
  entries: readonly JournalEntry[];
  accounts: readonly Account[];
  metric: TimeSeriesMetric;
  accountCode?: string;
}): TimeSeriesPoint[] {
  return input.buckets.map((bucket) => ({
    label: bucket.label,
    from: bucket.from,
    to: bucket.to,
    value: valueForBucket({
      bucket,
      entries: input.entries,
      accounts: input.accounts,
      metric: input.metric,
      accountCode: input.accountCode,
    }),
  }));
}
