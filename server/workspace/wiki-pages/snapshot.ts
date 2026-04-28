// Per-wiki-page edit-history snapshot pipeline (#763 PR 2).
//
// Every meaningful save through `writeWikiPage` deposits a
// snapshot under `data/wiki/.history/<slug>/<stamp>-<shortId>.md`.
// The file content is byte-identical to what was just written; the
// snapshot's frontmatter carries `_snapshot_*` keys describing the
// save itself (timestamp, editor, sessionId, reason).
//
// "Restore" reads the snapshot and writes it back through the
// normal `writeWikiPage` path — no special restore primitive
// needed, just frontmatter cleanup before the round-trip. This
// makes restore a *safe, reversible* operation: it adds a new
// snapshot rather than tearing the history apart.
//
// Garbage collection runs on every snapshot append. The retention
// rule is **OR-keyed**: a snapshot survives as long as it is in
// the newest 100 OR younger than 180 days; only entries failing
// BOTH conditions get unlinked. There is no hard cap.

import path from "node:path";
import { promises as fsp, constants as fsConstants, type Dirent } from "node:fs";
import { writeFileAtomic } from "../../utils/files/atomic.js";
import { mergeFrontmatter, parseFrontmatter, serializeWithFrontmatter } from "../../utils/markdown/frontmatter.js";
import { shortId } from "../../utils/id.js";
import { workspacePath as defaultWorkspacePath } from "../workspace.js";
import { WORKSPACE_DIRS } from "../paths.js";
import type { WikiPageEditor, WikiWriteMeta } from "./io.js";

export const SNAPSHOT_RETAIN_COUNT = 100;
export const SNAPSHOT_RETAIN_DAYS = 180;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface SnapshotPathOptions {
  workspaceRoot?: string;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
  /** Injectable id for deterministic tests. */
  shortId?: () => string;
}

/** Directory holding all snapshots for a single slug. Returned even
 *  when the dir doesn't exist yet; callers that read should tolerate
 *  ENOENT (treat as "no history yet"). */
export function historyDir(slug: string, opts: SnapshotPathOptions = {}): string {
  const root = opts.workspaceRoot ?? defaultWorkspacePath;
  return path.join(root, WORKSPACE_DIRS.wikiHistory, slug);
}

/** Snapshot summary as surfaced by `listSnapshots` and the history
 *  routes. The body is intentionally NOT included so a 100-entry
 *  page doesn't blow the response payload — call `readSnapshot` to
 *  fetch a single snapshot's full content. */
export interface SnapshotSummary {
  /** Unique identifier for this snapshot, used as the `:stamp`
   *  route param. Shape: `<filenameStamp>-<shortId>`, e.g.
   *  `2026-04-28T01-23-45-789Z-abc12345`. The shortId tail is
   *  REQUIRED — two saves landing in the same millisecond would
   *  otherwise share an identifier and listSnapshots / readSnapshot
   *  could return either one nondeterministically (codex iter-1
   *  finding). */
  stamp: string;
  /** Bytes of the snapshot file (frontmatter + body, after write). */
  bytes: number;
  ts: string;
  editor: WikiPageEditor;
  sessionId?: string;
  reason?: string;
}

export interface SnapshotContent extends SnapshotSummary {
  /** Frontmatter of the saved page at this snapshot's instant —
   *  with `_snapshot_*` keys *included*. Restore strips them. */
  meta: Record<string, unknown>;
  /** Body of the page at the snapshot instant. */
  body: string;
}

// Filenames look like `<filenameStamp>-<shortId>.md`. The
// filenameStamp is `YYYY-MM-DDTHH-mm-ss-sssZ` (colons swapped to
// hyphens). The shortId tail disambiguates same-millisecond
// writes. The public `stamp` identifier (route param) joins both
// — codex iter-1 noted that exposing only the time part would
// alias two simultaneous writes.
const FILENAME_RE = /^(?<filenameStamp>\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-[a-z0-9]+\.md$/i;

function timestampToFilenameStamp(date: Date): string {
  // 2026-04-28T01:23:45.789Z → 2026-04-28T01-23-45-789Z. Swap the
  // colons (forbidden on Windows / awkward in URLs) and the period
  // before milliseconds. Result is still strict-monotonic and
  // sortable lexicographically.
  return date.toISOString().replace(/:/g, "-").replace(".", "-");
}

function filenameStampToTimestamp(filenameStamp: string): string | null {
  // Inverse of `timestampToFilenameStamp`. Returns the canonical
  // ISO 8601 form (with colons + period) for use in the
  // _snapshot_ts frontmatter and the JSON wire shape. Returns null
  // when the filenameStamp doesn't match the expected shape —
  // callers can skip the entry rather than throwing on a stray
  // file.
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(filenameStamp);
  if (!match) return null;
  const [, date, hour, min, sec, milli] = match;
  return `${date}T${hour}:${min}:${sec}.${milli}Z`;
}

/** Path-safety check for the `:stamp` route param. Accepts the
 *  full `<filenameStamp>-<shortId>` form; the bare time-only stamp
 *  is rejected because it would alias same-millisecond writes
 *  (codex iter-1 finding). */
export function isSafeStamp(stamp: string): boolean {
  return FILENAME_RE.test(`${stamp}.md`);
}

// Snapshot-meta keys carry strings only, so a plain
// `Record<string, unknown>` matches `mergeFrontmatter`'s parameter
// shape exactly. A named interface here would require a cast at
// the merge call site without buying any extra type safety —
// snapshot consumers re-validate the shape on read anyway.
function buildSnapshotMetaPatch(meta: WikiWriteMeta, timestamp: string): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    _snapshot_ts: timestamp,
    _snapshot_editor: meta.editor,
  };
  if (meta.sessionId !== undefined) patch._snapshot_session = meta.sessionId;
  if (meta.reason !== undefined && meta.reason.length > 0) patch._snapshot_reason = meta.reason;
  return patch;
}

const SNAPSHOT_KEYS = ["_snapshot_ts", "_snapshot_editor", "_snapshot_session", "_snapshot_reason"] as const;

/** Strip `_snapshot_*` keys from a snapshot's frontmatter so the
 *  resulting content can be written back through the normal
 *  `writeWikiPage` path without polluting the live page with
 *  history-internal metadata. */
export function stripSnapshotMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if ((SNAPSHOT_KEYS as readonly string[]).includes(key)) continue;
    out[key] = value;
  }
  return out;
}

/** Refuse to operate on a slug whose history dir is a symlink.
 *  Returns true when the dir doesn't exist yet (mkdir on first
 *  write is fine) OR when it exists as a real directory; returns
 *  false when it exists as a symlink (or any other non-dir kind).
 *
 *  Both reads AND writes go through this — a directory symlink
 *  could otherwise redirect snapshot writes outside the history
 *  tree, and reads through it would surface contents from the
 *  symlink target (codex review iter-3 / iter-4 #917). */
async function historyDirIsSafe(dir: string): Promise<boolean> {
  try {
    const stat = await fsp.lstat(dir);
    return stat.isDirectory();
  } catch (err) {
    // Missing dir is fine — appendSnapshot's writeFileAtomic will
    // mkdir-p it on first write. Any other error means we shouldn't
    // touch this path.
    return isErrnoCode(err, "ENOENT");
  }
}

function isErrnoCode(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === code;
}

/** Write a snapshot file for a page that just changed. The
 *  snapshot's content == the page's new content (byte-identical
 *  body), with `_snapshot_*` meta merged in. The `_oldContent`
 *  parameter is intentionally unused — kept in the signature for
 *  symmetry with the call site so a future "diff snapshot" mode
 *  doesn't have to thread a new parameter. */
export async function appendSnapshot(
  slug: string,
  _oldContent: string | null,
  newContent: string,
  meta: WikiWriteMeta,
  opts: SnapshotPathOptions = {},
): Promise<void> {
  const now = (opts.now ?? (() => new Date()))();
  const isoTs = now.toISOString();
  const filenameStamp = timestampToFilenameStamp(now);
  const tail = (opts.shortId ?? shortId)();
  const fileName = `${filenameStamp}-${tail}.md`;

  // The new page already has its own frontmatter (writeWikiPage
  // auto-stamps `created` / `updated` / `editor`). Merge the
  // `_snapshot_*` patch on top so the snapshot file carries both
  // the page's identity AND the save event.
  const parsed = parseFrontmatter(newContent);
  const merged = mergeFrontmatter(parsed.meta, buildSnapshotMetaPatch(meta, isoTs));
  const snapshotContent = serializeWithFrontmatter(merged, parsed.body);

  const dir = historyDir(slug, opts);
  if (!(await historyDirIsSafe(dir))) {
    throw new Error(`refusing to write snapshot: history dir is a symlink or non-directory (${dir})`);
  }
  await writeFileAtomic(path.join(dir, fileName), snapshotContent);
  await gcSnapshots(slug, now, opts);
}

/** Walk `historyDir(slug)` and unlink every snapshot that fails
 *  BOTH retention rules: outside the newest `SNAPSHOT_RETAIN_COUNT`
 *  AND older than `SNAPSHOT_RETAIN_DAYS` from `now`. Idempotent —
 *  safe to run on a directory that doesn't exist (no-op).
 *  Tolerant of stray files whose names don't match the expected
 *  pattern; they are left alone. */
export async function gcSnapshots(slug: string, now: Date, opts: SnapshotPathOptions = {}): Promise<void> {
  const dir = historyDir(slug, opts);
  const entries = await readSnapshotEntries(dir);
  if (entries.length === 0) return;

  // Sort newest-first by filenameStamp (the time part). It's
  // lexicographically sortable because it's zero-padded ISO with
  // colons swapped. Same-millisecond writes resolve via the
  // shortId tail in `stamp` for tie-break consistency.
  entries.sort((left, right) => {
    if (left.filenameStamp !== right.filenameStamp) {
      return left.filenameStamp < right.filenameStamp ? 1 : -1;
    }
    return left.stamp < right.stamp ? 1 : left.stamp > right.stamp ? -1 : 0;
  });

  const cutoffMs = now.getTime() - SNAPSHOT_RETAIN_DAYS * ONE_DAY_MS;

  await Promise.all(
    entries.map(async (entry, index) => {
      const tsIso = filenameStampToTimestamp(entry.filenameStamp);
      if (tsIso === null) return; // shouldn't happen — readSnapshotEntries already filtered
      const entryMs = Date.parse(tsIso);
      const withinCount = index < SNAPSHOT_RETAIN_COUNT;
      const withinAge = entryMs >= cutoffMs;
      if (withinCount || withinAge) return;
      await fsp.unlink(path.join(dir, entry.fileName)).catch(() => {});
    }),
  );
}

interface SnapshotEntry {
  /** The unique public identifier for this snapshot (filename
   *  body without `.md`). Includes the shortId tail so two
   *  same-millisecond writes don't alias. */
  stamp: string;
  /** Just the time part of the filename — used to derive the ISO
   *  `_snapshot_ts` when the frontmatter doesn't carry one. */
  filenameStamp: string;
  fileName: string;
}

async function readSnapshotEntries(dir: string): Promise<SnapshotEntry[]> {
  // Defence in depth: refuse to read if the directory itself is a
  // symlink (codex review iter-3 / iter-4 #917). See historyDirIsSafe.
  if (!(await historyDirIsSafe(dir))) return [];

  let dirents: Dirent[];
  try {
    dirents = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: SnapshotEntry[] = [];
  for (const dirent of dirents) {
    // Reject anything that isn't a regular file. Symlinks especially —
    // a malicious actor with workspace write access could plant
    // `<stamp>-<id>.md` as a symlink to /etc/passwd, and history
    // reads would then surface the target through the bearer-authed
    // GET routes (codex review iter-2 #917).
    if (!dirent.isFile()) continue;
    const name = dirent.name;
    const match = FILENAME_RE.exec(name);
    if (!match?.groups) continue;
    out.push({
      stamp: name.slice(0, -".md".length),
      filenameStamp: match.groups.filenameStamp,
      fileName: name,
    });
  }
  return out;
}

/** Open a snapshot file with `O_NOFOLLOW` so the read fails if the
 *  path resolves through a symlink. This closes the TOCTOU window
 *  between `readdir` (which Dirent-checks the type) and the actual
 *  read: even if a workspace writer races to swap the entry into
 *  a symlink between the two, the kernel-level open atomically
 *  refuses (codex review iter-4 #917). Returns null on any read
 *  failure (missing file, symlink, decode error) — callers treat
 *  that as "skip this entry". */
async function readSnapshotFileNoFollow(filePath: string): Promise<{ raw: string; size: number } | null> {
  let handle: import("node:fs/promises").FileHandle | null = null;
  try {
    handle = await fsp.open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const raw = await handle.readFile("utf-8");
    const stat = await handle.stat();
    return { raw, size: stat.size };
  } catch {
    return null;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

function entryStringField(meta: Record<string, unknown>, key: string): string | undefined {
  const value = meta[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function entryEditor(meta: Record<string, unknown>): WikiPageEditor {
  const value = meta._snapshot_editor;
  if (value === "llm" || value === "user" || value === "system") return value;
  // Default to "user" for files written by an older version of the
  // pipeline that didn't stamp the field. Better than throwing on a
  // stray legacy entry.
  return "user";
}

/** List snapshots for a slug, newest-first. Returns an empty array
 *  when the slug has no history dir yet. Each entry carries enough
 *  meta (ts, editor, reason, sessionId) to render a list view; the
 *  body is omitted — call `readSnapshot` for full content. */
export async function listSnapshots(slug: string, opts: SnapshotPathOptions = {}): Promise<SnapshotSummary[]> {
  const dir = historyDir(slug, opts);
  const entries = await readSnapshotEntries(dir);
  entries.sort((left, right) => {
    if (left.filenameStamp !== right.filenameStamp) {
      return left.filenameStamp < right.filenameStamp ? 1 : -1;
    }
    return left.stamp < right.stamp ? 1 : left.stamp > right.stamp ? -1 : 0;
  });

  const summaries: SnapshotSummary[] = [];
  for (const entry of entries) {
    const filePath = path.join(dir, entry.fileName);
    const fileData = await readSnapshotFileNoFollow(filePath);
    if (fileData === null) continue;
    const parsed = parseFrontmatter(fileData.raw);
    const tsIso = entryStringField(parsed.meta, "_snapshot_ts") ?? filenameStampToTimestamp(entry.filenameStamp) ?? entry.stamp;
    summaries.push({
      stamp: entry.stamp,
      bytes: fileData.size,
      ts: tsIso,
      editor: entryEditor(parsed.meta),
      sessionId: entryStringField(parsed.meta, "_snapshot_session"),
      reason: entryStringField(parsed.meta, "_snapshot_reason"),
    });
  }
  return summaries;
}

/** Read a single snapshot. Returns null when the file is missing
 *  or the stamp is malformed. */
export async function readSnapshot(slug: string, stamp: string, opts: SnapshotPathOptions = {}): Promise<SnapshotContent | null> {
  if (!isSafeStamp(stamp)) return null;
  const dir = historyDir(slug, opts);
  const entries = await readSnapshotEntries(dir);
  const match = entries.find((entry) => entry.stamp === stamp);
  if (!match) return null;

  const filePath = path.join(dir, match.fileName);
  const fileData = await readSnapshotFileNoFollow(filePath);
  if (fileData === null) return null;

  const parsed = parseFrontmatter(fileData.raw);
  const tsIso = entryStringField(parsed.meta, "_snapshot_ts") ?? filenameStampToTimestamp(match.filenameStamp) ?? match.stamp;
  return {
    stamp: match.stamp,
    bytes: fileData.size,
    ts: tsIso,
    editor: entryEditor(parsed.meta),
    sessionId: entryStringField(parsed.meta, "_snapshot_session"),
    reason: entryStringField(parsed.meta, "_snapshot_reason"),
    meta: parsed.meta,
    body: parsed.body,
  };
}
