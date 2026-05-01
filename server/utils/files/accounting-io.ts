// Single fs gateway for the accounting plugin. Every read / write
// against `data/accounting/...` lives here so callers don't sprinkle
// raw `fs` / path concatenation across the codebase (CLAUDE.md rule:
// raw `fs.readFile` / `fs.writeFile` is forbidden in route handlers).
//
// Snapshot cache rule: snapshots are derived state. Any write that
// touches past data must call `invalidateSnapshotsFrom(...)` to drop
// stale snapshot files; the next read regenerates lazily via
// `server/accounting/snapshotCache.ts`. The journal JSONL files are
// the single source of truth.

import { promises as fsPromises } from "node:fs";
import path from "node:path";

import { workspacePath, WORKSPACE_DIRS } from "../../workspace/paths.js";
import { writeFileAtomic } from "./atomic.js";
import type { AccountingConfig, Account, JournalEntry, MonthSnapshot } from "../../accounting/types.js";

const root = (workspaceRoot?: string): string => workspaceRoot ?? workspacePath;

function accountingRoot(workspaceRoot?: string): string {
  return path.join(root(workspaceRoot), WORKSPACE_DIRS.accounting);
}

function configPath(workspaceRoot?: string): string {
  return path.join(accountingRoot(workspaceRoot), "config.json");
}

/** Allowed shape for a book id used as a directory name. Defense
 *  against path traversal: a crafted id like "../../config" or
 *  "/tmp/x" would otherwise let `bookRoot` escape the
 *  `data/accounting/books/` tree, since every write path joins
 *  `bookId` directly into the filesystem. The first character is
 *  alphanumeric to forbid leading dashes / underscores that some
 *  shells / docs render confusingly; `_` and `-` are allowed inside.
 *  64 chars is plenty for any reasonable book name. */
const SAFE_BOOK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function isSafeBookId(bookId: string): boolean {
  return typeof bookId === "string" && SAFE_BOOK_ID_RE.test(bookId);
}

function assertSafeBookId(bookId: string): void {
  if (!isSafeBookId(bookId)) {
    throw new Error(`accounting: invalid bookId ${JSON.stringify(bookId)} (allowed: alphanumeric / _ / -; 1-64 chars; cannot start with _ or -)`);
  }
}

export function bookRoot(bookId: string, workspaceRoot?: string): string {
  assertSafeBookId(bookId);
  return path.join(root(workspaceRoot), WORKSPACE_DIRS.accountingBooks, bookId);
}

function accountsPath(bookId: string, workspaceRoot?: string): string {
  return path.join(bookRoot(bookId, workspaceRoot), "accounts.json");
}

function journalDir(bookId: string, workspaceRoot?: string): string {
  return path.join(bookRoot(bookId, workspaceRoot), "journal");
}

function journalFileFor(bookId: string, period: string, workspaceRoot?: string): string {
  return path.join(journalDir(bookId, workspaceRoot), `${period}.jsonl`);
}

function snapshotsDir(bookId: string, workspaceRoot?: string): string {
  return path.join(bookRoot(bookId, workspaceRoot), "snapshots");
}

function snapshotFileFor(bookId: string, period: string, workspaceRoot?: string): string {
  return path.join(snapshotsDir(bookId, workspaceRoot), `${period}.json`);
}

interface ErrnoLike {
  code?: string;
}

function isMissingFile(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as ErrnoLike).code === "ENOENT";
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fsPromises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonOrNull<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fsPromises.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch (err) {
    if (isMissingFile(err)) return null;
    throw err;
  }
}

// ── config.json ────────────────────────────────────────────────────

export async function readConfig(workspaceRoot?: string): Promise<AccountingConfig | null> {
  return readJsonOrNull<AccountingConfig>(configPath(workspaceRoot));
}

export async function writeConfig(config: AccountingConfig, workspaceRoot?: string): Promise<void> {
  await writeFileAtomic(configPath(workspaceRoot), JSON.stringify(config, null, 2));
}

// ── accounts.json ──────────────────────────────────────────────────

export async function readAccounts(bookId: string, workspaceRoot?: string): Promise<Account[]> {
  const accounts = await readJsonOrNull<Account[]>(accountsPath(bookId, workspaceRoot));
  return accounts ?? [];
}

export async function writeAccounts(bookId: string, accounts: Account[], workspaceRoot?: string): Promise<void> {
  await writeFileAtomic(accountsPath(bookId, workspaceRoot), JSON.stringify(accounts, null, 2));
}

// ── journal/YYYY-MM.jsonl (append-only) ────────────────────────────

/** Convert a YYYY-MM-DD date string to its YYYY-MM month bucket. The
 *  month bucket dictates which JSONL file the entry lives in. */
export function periodFromDate(date: string): string {
  // YYYY-MM-DD → YYYY-MM. Validate the prefix shape so a malformed
  // input fails early instead of silently bucketing into "1970-01"
  // or similar.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`accounting: invalid date format ${JSON.stringify(date)} (expected YYYY-MM-DD)`);
  }
  return date.slice(0, 7);
}

/** Append one entry to the appropriate month's JSONL.
 *
 *  Uses POSIX append-only semantics (`fs.appendFile` → `O_APPEND`).
 *  Two concurrent callers landing in the same month file are
 *  serialised by the kernel — neither overwrites the other, which
 *  is the bug the previous read-modify-write implementation had.
 *
 *  Crash mid-write: an entry shorter than `PIPE_BUF` (≥ 512 bytes
 *  on every supported platform) writes atomically; a single
 *  serialised `JournalEntry` is comfortably under that. If the
 *  process is killed during the syscall the worst case is a torn
 *  trailing line, which `readJournalMonth` already tolerates by
 *  skipping unparseable lines and surfacing a `skipped` count to
 *  the caller. */
export async function appendJournal(bookId: string, entry: JournalEntry, workspaceRoot?: string): Promise<void> {
  const period = periodFromDate(entry.date);
  const file = journalFileFor(bookId, period, workspaceRoot);
  await fsPromises.mkdir(path.dirname(file), { recursive: true });
  await fsPromises.appendFile(file, `${JSON.stringify(entry)}\n`, { encoding: "utf-8" });
}

/** Read a single month's JSONL. Malformed lines are skipped (logged
 *  by the caller; this layer just returns the parseable subset) so
 *  one bad line doesn't lock the user out of their book. */
export async function readJournalMonth(bookId: string, period: string, workspaceRoot?: string): Promise<{ entries: JournalEntry[]; skipped: number }> {
  const file = journalFileFor(bookId, period, workspaceRoot);
  let raw: string;
  try {
    raw = await fsPromises.readFile(file, "utf-8");
  } catch (err) {
    if (isMissingFile(err)) return { entries: [], skipped: 0 };
    throw err;
  }
  const entries: JournalEntry[] = [];
  let skipped = 0;
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    try {
      entries.push(JSON.parse(line) as JournalEntry);
    } catch {
      skipped += 1;
    }
  }
  return { entries, skipped };
}

/** List the YYYY-MM periods that have a journal file on disk, sorted
 *  ascending. Useful for full-history scans (rebuilding snapshots
 *  from scratch). */
export async function listJournalPeriods(bookId: string, workspaceRoot?: string): Promise<string[]> {
  let names: string[];
  try {
    names = await fsPromises.readdir(journalDir(bookId, workspaceRoot));
  } catch (err) {
    if (isMissingFile(err)) return [];
    throw err;
  }
  return names
    .filter((name) => /^\d{4}-\d{2}\.jsonl$/.test(name))
    .map((name) => name.slice(0, 7))
    .sort();
}

// ── snapshots/YYYY-MM.json (cache, not source of truth) ────────────

export async function readSnapshot(bookId: string, period: string, workspaceRoot?: string): Promise<MonthSnapshot | null> {
  return readJsonOrNull<MonthSnapshot>(snapshotFileFor(bookId, period, workspaceRoot));
}

export async function writeSnapshot(bookId: string, snapshot: MonthSnapshot, workspaceRoot?: string): Promise<void> {
  const file = snapshotFileFor(bookId, snapshot.period, workspaceRoot);
  await fsPromises.mkdir(path.dirname(file), { recursive: true });
  // `uniqueTmp` guards against the lazy fallback in `getOrBuildSnapshot`
  // racing with the background rebuild — both can land in
  // `writeSnapshot` for the same period at once. Distinct tmp file
  // names mean each writer renames its own; the destination
  // overwrites idempotently (both derive from the same journal).
  await writeFileAtomic(file, JSON.stringify(snapshot, null, 2), { uniqueTmp: true });
}

/** Drop snapshot files for all periods >= `fromPeriod`. The next
 *  read regenerates them. Idempotent: missing files are silently
 *  ignored. */
export async function invalidateSnapshotsFrom(bookId: string, fromPeriod: string, workspaceRoot?: string): Promise<{ removed: string[] }> {
  let names: string[];
  try {
    names = await fsPromises.readdir(snapshotsDir(bookId, workspaceRoot));
  } catch (err) {
    if (isMissingFile(err)) return { removed: [] };
    throw err;
  }
  const removed: string[] = [];
  for (const name of names) {
    const match = /^(\d{4}-\d{2})\.json$/.exec(name);
    if (!match) continue;
    const [, period] = match;
    if (period >= fromPeriod) {
      await fsPromises.rm(path.join(snapshotsDir(bookId, workspaceRoot), name), { force: true });
      removed.push(period);
    }
  }
  return { removed: removed.sort() };
}

/** Drop ALL snapshots for a book — used by `rebuildSnapshots()`
 *  with no `from`. Equivalent to `invalidateSnapshotsFrom("0000-00")`
 *  but reads more clearly at call sites. */
export async function invalidateAllSnapshots(bookId: string, workspaceRoot?: string): Promise<{ removed: string[] }> {
  return invalidateSnapshotsFrom(bookId, "0000-00", workspaceRoot);
}

// ── book directory housekeeping ────────────────────────────────────

export async function bookExists(bookId: string, workspaceRoot?: string): Promise<boolean> {
  return fileExists(bookRoot(bookId, workspaceRoot));
}

export async function ensureBookDir(bookId: string, workspaceRoot?: string): Promise<void> {
  await fsPromises.mkdir(bookRoot(bookId, workspaceRoot), { recursive: true });
  await fsPromises.mkdir(journalDir(bookId, workspaceRoot), { recursive: true });
  await fsPromises.mkdir(snapshotsDir(bookId, workspaceRoot), { recursive: true });
}

/** Recursively delete a book's directory. Used by `deleteBook` after
 *  the config has been updated to drop the entry. */
export async function removeBookDir(bookId: string, workspaceRoot?: string): Promise<void> {
  await fsPromises.rm(bookRoot(bookId, workspaceRoot), { recursive: true, force: true });
}
