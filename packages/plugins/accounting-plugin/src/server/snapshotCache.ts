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
// Rebuild policy: writes call `scheduleRebuild(bookId, fromPeriod)`
// after invalidating stale snapshot files. Each book has at most one
// rebuild in flight; additional writes during a running rebuild merge
// into a single queued follow-up (so a burst of N writes runs at most
// two rebuilds). `getOrBuildSnapshot` keeps a lazy fallback so a
// report requested before the rebuild reaches that month is still
// correct — it just builds inline.
//
// Test API: `awaitRebuildIdle(bookId)` and `inspectRebuildQueue(bookId)`
// are diagnostics that let tests assert on queue state without
// sleep-and-poll. Production code never needs them.

import {
  invalidateSnapshotsFrom as ioInvalidateFrom,
  invalidateAllSnapshots as ioInvalidateAll,
  listJournalPeriods,
  readJournalMonth,
  readSnapshot,
  writeSnapshot,
} from "./io.js";
import { aggregateBalances, sortedBalancesFromMap } from "./report.js";
import { publishBookChange } from "./eventPublisher.js";
import { log } from "./context.js";
import { errorMessage, BOOK_EVENT_KINDS as ACCOUNTING_BOOK_EVENT_KINDS } from "../shared";
import type { MonthSnapshot } from "./types.js";
import type { AccountBalance, JournalEntry } from "../shared/types.js";

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
  return sortedBalancesFromMap(map);
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

// ── async rebuild queue ────────────────────────────────────────────
//
// Per-book queue. A `running` promise represents the in-flight
// rebuild. While it's running, additional `scheduleRebuild` calls
// merge their `fromPeriod` into `pendingFromPeriod` (taking the
// minimum so the next pass covers everyone's invalidation), and we
// kick off a follow-up once the current one resolves.

interface RebuildQueueEntry {
  running: Promise<void>;
  pendingFromPeriod: string | null;
  pendingWorkspaceRoot: string | undefined;
  coalescedWriteCount: number;
  runningFromPeriod: string;
  /** Set by `cancelRebuild` (called from `deleteBook`). The runRebuild
   *  loop checks before each write so a rebuild cannot resurrect the
   *  book directory after `removeBookDir` has run. */
  cancelled: boolean;
}

const rebuildQueues = new Map<string, RebuildQueueEntry>();

function minPeriod(lhs: string | null, rhs: string): string {
  if (lhs === null) return rhs;
  return lhs < rhs ? lhs : rhs;
}

function isInvalidatedDuringRebuild(bookId: string, period: string): boolean {
  // A pending invalidation that covers `period` means the queued
  // follow-up rebuild will redo this period. Skip the in-flight
  // write so we don't pollute the cache with stale data while a
  // fresher computation is queued. Without this guard, the
  // sequence "rebuild reads journal → caller writes a new entry →
  // caller invalidates → rebuild writes (stale) snapshot" leaves
  // the cache lying about the latest state.
  const queue = rebuildQueues.get(bookId);
  return queue !== undefined && queue.pendingFromPeriod !== null && period >= queue.pendingFromPeriod;
}

function isCancelled(bookId: string): boolean {
  return rebuildQueues.get(bookId)?.cancelled === true;
}

async function runRebuild(bookId: string, fromPeriod: string, workspaceRoot: string | undefined): Promise<void> {
  const startedAt = Date.now();
  log.info("accounting", "snapshot rebuild started", { bookId, fromPeriod });
  publishBookChange(bookId, { kind: ACCOUNTING_BOOK_EVENT_KINDS.snapshotsRebuilding, period: fromPeriod });
  const periods = await listJournalPeriods(bookId, workspaceRoot);
  const targets = periods.filter((monthKey) => monthKey >= fromPeriod);
  let written = 0;
  for (const monthKey of targets) {
    if (isCancelled(bookId)) break;
    if (isInvalidatedDuringRebuild(bookId, monthKey)) break;
    // Compute fresh from journal — bypasses getOrBuildSnapshot's
    // own write side-effect so the staleness check below is the
    // only writer in the rebuild path.
    const balances = await balancesAtEndOf(bookId, monthKey, workspaceRoot);
    if (isCancelled(bookId)) break;
    if (isInvalidatedDuringRebuild(bookId, monthKey)) break;
    await writeSnapshot(bookId, { period: monthKey, balances, builtAt: new Date().toISOString() }, workspaceRoot);
    if (isCancelled(bookId)) {
      // The book was deleted between our last check and the write —
      // `writeSnapshot` will have re-created the book directory tree
      // via mkdir-recursive. Undo it so we don't leave an orphaned
      // directory after `deleteBook` has run.
      await ioInvalidateFrom(bookId, monthKey, workspaceRoot);
      break;
    }
    if (isInvalidatedDuringRebuild(bookId, monthKey)) {
      // A concurrent invalidate raced ahead between our last check
      // and the disk write. The data we just wrote may be stale
      // relative to the latest journal — undo so the queued
      // follow-up rebuild starts from a clean slate.
      await ioInvalidateFrom(bookId, monthKey, workspaceRoot);
      break;
    }
    written += 1;
    publishBookChange(bookId, { kind: ACCOUNTING_BOOK_EVENT_KINDS.snapshotsReady, period: monthKey });
  }
  log.info("accounting", "snapshot rebuild done", { bookId, periods: written, durationMs: Date.now() - startedAt });
}

function startRebuild(bookId: string, fromPeriod: string, workspaceRoot: string | undefined): RebuildQueueEntry {
  const entry: RebuildQueueEntry = {
    running: Promise.resolve(),
    pendingFromPeriod: null,
    pendingWorkspaceRoot: undefined,
    coalescedWriteCount: 1,
    runningFromPeriod: fromPeriod,
    cancelled: false,
  };
  entry.running = runRebuild(bookId, fromPeriod, workspaceRoot)
    .catch((err) => {
      // A rebuild failure is logged but does not poison the queue —
      // the next `scheduleRebuild` call will start a fresh promise.
      log.error("accounting", "snapshot rebuild failed", { bookId, fromPeriod, error: errorMessage(err) });
    })
    .then(() => {
      // Drain any work that piled up while we were running.
      const current = rebuildQueues.get(bookId);
      if (!current) return;
      // If the book was cancelled mid-rebuild (e.g. deleteBook ran),
      // drop the queue entry entirely — we must not start a successor
      // that would re-create the deleted book directory.
      if (current.cancelled) {
        rebuildQueues.delete(bookId);
        return;
      }
      if (current.pendingFromPeriod !== null) {
        const nextFrom = current.pendingFromPeriod;
        const nextRoot = current.pendingWorkspaceRoot;
        const carriedCount = current.coalescedWriteCount;
        const successor = startRebuild(bookId, nextFrom, nextRoot);
        successor.coalescedWriteCount += carriedCount;
        rebuildQueues.set(bookId, successor);
      } else {
        rebuildQueues.delete(bookId);
      }
    });
  return entry;
}

/** Schedule a background rebuild for `bookId` starting at `fromPeriod`.
 *  Multiple calls during an in-flight rebuild coalesce into a single
 *  follow-up rebuild that covers the minimum `fromPeriod` seen.
 *  Returns immediately — the rebuild runs on its own promise chain. */
export function scheduleRebuild(bookId: string, fromPeriod: string, workspaceRoot?: string): void {
  const existing = rebuildQueues.get(bookId);
  if (!existing) {
    rebuildQueues.set(bookId, startRebuild(bookId, fromPeriod, workspaceRoot));
    return;
  }
  existing.pendingFromPeriod = minPeriod(existing.pendingFromPeriod, fromPeriod);
  existing.pendingWorkspaceRoot = workspaceRoot;
  existing.coalescedWriteCount += 1;
}

/** Test/diagnostic: resolves when no rebuild is running or queued for
 *  `bookId`. Also called by `deleteBook` after `cancelRebuild` to
 *  ensure a previously running rebuild has fully stopped before the
 *  caller removes the book's directory on disk. */
export async function awaitRebuildIdle(bookId: string): Promise<void> {
  while (rebuildQueues.has(bookId)) {
    const entry = rebuildQueues.get(bookId);
    if (!entry) return;
    await entry.running;
  }
}

/** Mark the book's in-flight rebuild as cancelled. The runRebuild
 *  loop checks before each write and bails out, so a subsequent
 *  `removeBookDir` cannot race with a `writeSnapshot` that would
 *  re-create the directory tree. Pair with `awaitRebuildIdle(bookId)`
 *  to wait for the in-flight rebuild to finish bailing. */
export function cancelRebuild(bookId: string): void {
  const entry = rebuildQueues.get(bookId);
  if (!entry) return;
  entry.cancelled = true;
  // Drop pending too — a cancelled book should not get a successor
  // rebuild after the in-flight one drains.
  entry.pendingFromPeriod = null;
}

/** Test/diagnostic: snapshot of the per-book queue state. Stable
 *  enough to assert against; fields may grow over time. */
export function inspectRebuildQueue(bookId: string): {
  running: boolean;
  runningFromPeriod: string | null;
  pendingFromPeriod: string | null;
  coalescedWriteCount: number;
} {
  const entry = rebuildQueues.get(bookId);
  if (!entry) {
    return { running: false, runningFromPeriod: null, pendingFromPeriod: null, coalescedWriteCount: 0 };
  }
  return {
    running: true,
    runningFromPeriod: entry.runningFromPeriod,
    pendingFromPeriod: entry.pendingFromPeriod,
    coalescedWriteCount: entry.coalescedWriteCount,
  };
}

/** Test-only — drain all in-flight rebuilds, then drop queue state.
 *  Awaiting first means a leftover rebuild can't continue writing
 *  into the next test's tmp dir after we clear the bookkeeping. */
export async function _resetRebuildQueueForTesting(): Promise<void> {
  // Mark everything cancelled so loops bail at their next checkpoint
  // instead of continuing through every period.
  for (const entry of rebuildQueues.values()) {
    entry.cancelled = true;
    entry.pendingFromPeriod = null;
  }
  const pending = Array.from(rebuildQueues.values()).map((entry) => entry.running);
  await Promise.allSettled(pending);
  rebuildQueues.clear();
}
