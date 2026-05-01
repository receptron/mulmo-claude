// Monthly balance snapshot cache.
//
// Source of truth: the journal JSONL files. Snapshots are derived
// state — `data/accounting/books/<id>/snapshots/YYYY-MM.json` is
// only ever a perf optimization. The invariant we maintain:
//
//   for any (book, period) pair,
//     getOrBuildSnapshot(book, period)
//   ===
//     aggregateBalances(<all entries up to period end>)
//
// I.e. running with snapshots and running without snapshots must
// produce byte-identical results. The unit test for this lives in
// `test/accounting/test_snapshotCache.ts`.
//
// Concurrency: the route handlers run on a single Node process, and
// `getOrBuildSnapshot` is async — concurrent calls may race and
// produce duplicate work. The duplicate writes are idempotent
// (writeFileAtomic, same input → same output) so the worst case is
// extra CPU. If contention becomes an issue, gating by a per-book
// promise map would add serialization. Today's volume doesn't need
// it.

import {
  invalidateSnapshotsFrom as ioInvalidateFrom,
  invalidateAllSnapshots as ioInvalidateAll,
  listJournalPeriods,
  readJournalMonth,
  readSnapshot,
  writeSnapshot,
} from "../utils/files/accounting-io.js";
import { aggregateBalances } from "./report.js";
import type { AccountBalance, JournalEntry, MonthSnapshot } from "./types.js";

function previousPeriod(period: string): string {
  // YYYY-MM → previous YYYY-MM. December rolls back to the previous
  // year's December.
  const [year, month] = period.split("-").map((segment) => parseInt(segment, 10));
  if (month === 1) return `${(year - 1).toString().padStart(4, "0")}-12`;
  return `${year.toString().padStart(4, "0")}-${(month - 1).toString().padStart(2, "0")}`;
}

function mergeBalances(base: readonly AccountBalance[], delta: readonly AccountBalance[]): AccountBalance[] {
  const map = new Map<string, number>();
  for (const row of base) map.set(row.accountCode, row.netDebit);
  for (const row of delta) {
    map.set(row.accountCode, (map.get(row.accountCode) ?? 0) + row.netDebit);
  }
  return Array.from(map.entries())
    .map(([accountCode, netDebit]) => ({ accountCode, netDebit }))
    .sort((lhs, rhs) => lhs.accountCode.localeCompare(rhs.accountCode));
}

async function buildEmptySnapshot(bookId: string, period: string, workspaceRoot?: string): Promise<MonthSnapshot> {
  const empty: MonthSnapshot = { period, balances: [], builtAt: new Date().toISOString() };
  await writeSnapshot(bookId, empty, workspaceRoot);
  return empty;
}

/** Build a snapshot at end-of-`period` for one book, lazily relying
 *  on the previous month's snapshot if it exists. Falls all the way
 *  back to the earliest journal month if no upstream snapshot is
 *  available. Always writes the result to disk before returning. */
export async function getOrBuildSnapshot(bookId: string, period: string, workspaceRoot?: string): Promise<MonthSnapshot> {
  const cached = await readSnapshot(bookId, period, workspaceRoot);
  if (cached) return cached;

  // Earliest journal month determines where the recursion stops.
  // If the book has no journal at all, return an empty snapshot.
  const periods = await listJournalPeriods(bookId, workspaceRoot);
  if (periods.length === 0 || period < periods[0]) {
    return buildEmptySnapshot(bookId, period, workspaceRoot);
  }

  const { entries } = await readJournalMonth(bookId, period, workspaceRoot);
  const monthDelta = aggregateBalances(entries);

  // Get the prior month's closing snapshot — recurse, which will
  // either hit cache or build the chain back to the start.
  let priorBalances: readonly AccountBalance[] = [];
  if (period > periods[0]) {
    const prior = previousPeriod(period);
    const priorSnap = await getOrBuildSnapshot(bookId, prior, workspaceRoot);
    priorBalances = priorSnap.balances;
  }
  const merged = mergeBalances(priorBalances, monthDelta);
  const snap: MonthSnapshot = {
    period,
    balances: merged,
    builtAt: new Date().toISOString(),
  };
  await writeSnapshot(bookId, snap, workspaceRoot);
  return snap;
}

/** Compute closing balances at end-of-`period` from journal alone,
 *  bypassing the snapshot cache. Used by the byte-equality
 *  invariant test, and as a safety net for "compute without
 *  trusting cache" paths. */
export async function balancesAtEndOf(bookId: string, period: string, workspaceRoot?: string): Promise<AccountBalance[]> {
  const periods = await listJournalPeriods(bookId, workspaceRoot);
  const all: JournalEntry[] = [];
  for (const monthKey of periods) {
    if (period < monthKey) break;
    const { entries } = await readJournalMonth(bookId, monthKey, workspaceRoot);
    for (const entry of entries) all.push(entry);
  }
  return aggregateBalances(all);
}

/** Drop snapshots for `fromPeriod` and later. Re-export from
 *  accounting-io for callers that conceptually live in the cache
 *  layer (so they don't reach into the IO module). */
export async function invalidateSnapshotsFrom(bookId: string, fromPeriod: string, workspaceRoot?: string): Promise<{ removed: string[] }> {
  return ioInvalidateFrom(bookId, fromPeriod, workspaceRoot);
}

/** Drop all snapshots and rebuild from scratch. Used by the
 *  `rebuildSnapshots` admin action. Returns the periods that were
 *  rebuilt. */
export async function rebuildAllSnapshots(bookId: string, workspaceRoot?: string): Promise<{ rebuilt: string[] }> {
  await ioInvalidateAll(bookId, workspaceRoot);
  const periods = await listJournalPeriods(bookId, workspaceRoot);
  for (const monthKey of periods) {
    await getOrBuildSnapshot(bookId, monthKey, workspaceRoot);
  }
  return { rebuilt: periods };
}
