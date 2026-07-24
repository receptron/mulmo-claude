// Read / write item files for schema-driven collections. Records live at
// `<dataDir>/<itemId>.json`, one JSON object per file. Writes are
// atomic; deletes are idempotent enough to expose a clear 404 when
// the file is missing.

import { lstat, mkdir, open, readdir, readFile, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { getWorkspaceRoot, log, publishCollectionChange } from "./host";
import { writeFileAtomic } from "../../files/atomic.js";
import { isContainedInRoot, itemFilePath, safeRecordId } from "./paths";
import type { CollectionItem, CollectionSchema } from "../core/schema";

export interface IoOptions {
  /** Override the workspace root for containment checks. Default:
   *  the live `workspacePath`. Tests point this at a `mkdtempSync`
   *  tree so the realpath-based escape detection can be exercised
   *  without touching `~/mulmoclaude/`. Same pattern as
   *  `server/workspace/skills/catalog.ts#CatalogOptions`. */
  workspaceRoot?: string;
  /** Collection slug this write/delete belongs to. When provided, a
   *  successful write/delete publishes a record-change event (see
   *  `publishCollectionChange`) so live views refetch. `writeItem` has no
   *  slug of its own (it's keyed by `dataDir`), so callers thread it through;
   *  omitting it just means no event is published (internal / test writes). */
  slug?: string;
}

/** True iff `filePath` exists and is a regular file (NOT a symlink).
 *  Defends `listItems` / `readItem` against `*.json` symlinks placed
 *  inside an otherwise-contained data dir — without this, a record
 *  file could symlink to /etc/passwd and the detail endpoint would
 *  happily serve it. Returns false on ENOENT and on any other lstat
 *  failure so the caller's "missing" branch covers those cases too.
 *  Exported so `ontology.ts`'s record COUNT classifies entries with the
 *  SAME lstat logic — the two must agree on what a record file is. */
export async function isRegularFile(filePath: string): Promise<boolean> {
  try {
    const info = await lstat(filePath);
    return info.isFile();
  } catch {
    return false;
  }
}

/** Read one JSON record file. Returns null when the file is missing,
 *  is a symlink (file-disclosure defense), parses to a non-object,
 *  or has a read/parse error. Caller logs the per-entry skip — this
 *  helper just classifies. Split out to keep `listItems` under the
 *  `sonarjs/cognitive-complexity` threshold. */
/** Parse a record file's text into a plain-object `CollectionItem`, or
 *  null when it isn't a JSON object (array / scalar / null). */
function parseRecordJson(raw: string): CollectionItem | null {
  const parsed: unknown = JSON.parse(raw);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as CollectionItem;
  }
  return null;
}

async function tryReadRecord(filePath: string): Promise<CollectionItem | null> {
  if (!(await isRegularFile(filePath))) return null;
  try {
    return parseRecordJson(await readFile(filePath, "utf-8"));
  } catch {
    return null;
  }
}

/** Read every record under `dataDir`. Returns [] if the dir doesn't
 *  exist yet (legitimate first-use state). Malformed JSON files and
 *  symlinked records are skipped (the latter is a file-disclosure
 *  defense — see `isRegularFile`). Re-validates the realpath
 *  containment to defend against a symlinked data dir appearing
 *  between discovery and use. */
export async function listItems(dataDir: string, opts: IoOptions = {}): Promise<CollectionItem[]> {
  const workspaceRoot = opts.workspaceRoot ?? getWorkspaceRoot();
  if (!isContainedInRoot(dataDir, workspaceRoot)) {
    log.warn("collections", "listItems refused: dataDir escapes workspace via symlink", { dataDir });
    return [];
  }
  let entries: string[];
  try {
    entries = await readdir(dataDir);
  } catch (err) {
    const error = err as { code?: string };
    if (error.code === "ENOENT") return [];
    throw err;
  }
  const results: CollectionItem[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    if (name.startsWith(".")) continue;
    const filePath = path.join(dataDir, name);
    const record = await tryReadRecord(filePath);
    if (record === null) {
      log.warn("collections", "skipping record (missing, symlink, or unreadable)", { path: filePath });
      continue;
    }
    results.push(record);
  }
  return results;
}

/** Read one record by id. Returns null when the file is missing,
 *  when the resolved path escapes the workspace via a symlink, or
 *  when the record file itself is a symlink (file-disclosure
 *  defense — see `isRegularFile`). */
export async function readItem(dataDir: string, itemId: string, opts: IoOptions = {}): Promise<CollectionItem | null> {
  const safeId = safeRecordId(itemId);
  if (safeId === null) return null;
  const workspaceRoot = opts.workspaceRoot ?? getWorkspaceRoot();
  if (!isContainedInRoot(dataDir, workspaceRoot)) return null;
  const filePath = itemFilePath(dataDir, safeId);
  if (!(await isRegularFile(filePath))) return null;
  try {
    return parseRecordJson(await readFile(filePath, "utf-8"));
  } catch (err) {
    const error = err as { code?: string };
    if (error.code === "ENOENT") return null;
    throw err;
  }
}

export interface WriteItemOptions extends IoOptions {
  /** When true (POST/create), refuse to overwrite an existing file
   *  and return `kind: "conflict"`. Update flow (PUT) leaves it false. */
  refuseOverwrite?: boolean;
}

export type WriteItemResult =
  | { kind: "ok"; itemId: string; item: CollectionItem }
  | { kind: "invalid-id"; itemId: string }
  | { kind: "conflict"; itemId: string }
  | { kind: "path-escape"; itemId: string };

/** Write a record. Ensures the directory exists, validates the id,
 *  re-checks symlink containment after mkdir, and writes atomically.
 *
 *  Create path (`refuseOverwrite: true`) uses an O_EXCL `wx` open
 *  rather than `stat` + `writeFileAtomic` to close a check-then-write
 *  race: two concurrent POSTs would otherwise both pass the existence
 *  check and one would silently overwrite the other. The trade-off
 *  is that the create path is not crash-atomic (a partial file could
 *  remain if the process dies mid-write); acceptable here because
 *  records are small JSON blobs and the next read either parses or
 *  is skipped via the "malformed JSON" branch in `listItems`.
 *
 *  Update path (`refuseOverwrite: false`) uses `writeFileAtomic` so
 *  PUT remains crash-atomic. No race there — the URL pins the id. */
export async function writeItem(dataDir: string, itemId: string, item: CollectionItem, opts: WriteItemOptions = {}): Promise<WriteItemResult> {
  const safeId = safeRecordId(itemId);
  if (safeId === null) return { kind: "invalid-id", itemId };
  const workspaceRoot = opts.workspaceRoot ?? getWorkspaceRoot();
  // Containment check runs BEFORE mkdir so we never create
  // directories outside the workspace even if a symlink ancestor
  // was swapped after discovery. We re-check AFTER mkdir to catch
  // a symlink racing in between the two — belt + suspenders, cheap
  // and the only honest defense against TOCTOU on directory creation.
  if (!isContainedInRoot(dataDir, workspaceRoot)) {
    log.warn("collections", "writeItem refused: dataDir escapes workspace via symlink (pre-mkdir)", { dataDir, itemId: safeId });
    return { kind: "path-escape", itemId: safeId };
  }
  await mkdir(dataDir, { recursive: true });
  if (!isContainedInRoot(dataDir, workspaceRoot)) {
    log.warn("collections", "writeItem refused: dataDir escapes workspace via symlink (post-mkdir)", { dataDir, itemId: safeId });
    return { kind: "path-escape", itemId: safeId };
  }
  const filePath = itemFilePath(dataDir, safeId);
  const payload = `${JSON.stringify(item, null, 2)}\n`;

  if (opts.refuseOverwrite) {
    let handle;
    try {
      handle = await open(filePath, "wx");
    } catch (err) {
      const error = err as { code?: string };
      if (error.code === "EEXIST") return { kind: "conflict", itemId: safeId };
      throw err;
    }
    try {
      await handle.writeFile(payload);
    } finally {
      await handle.close();
    }
  } else {
    await writeFileAtomic(filePath, payload);
  }
  // Publish AFTER the write lands so a live subscriber that refetches always
  // sees the new record (never a read-before-write race).
  if (opts.slug) publishCollectionChange({ slug: opts.slug, ids: [safeId], op: "upsert" });
  return { kind: "ok", itemId: safeId, item };
}

export type DeleteItemResult =
  { kind: "ok"; itemId: string } | { kind: "invalid-id"; itemId: string } | { kind: "not-found"; itemId: string } | { kind: "path-escape"; itemId: string };

export async function deleteItem(dataDir: string, itemId: string, opts: IoOptions = {}): Promise<DeleteItemResult> {
  const safeId = safeRecordId(itemId);
  if (safeId === null) return { kind: "invalid-id", itemId };
  const workspaceRoot = opts.workspaceRoot ?? getWorkspaceRoot();
  if (!isContainedInRoot(dataDir, workspaceRoot)) {
    log.warn("collections", "deleteItem refused: dataDir escapes workspace via symlink", { dataDir, itemId: safeId });
    return { kind: "path-escape", itemId: safeId };
  }
  const filePath = itemFilePath(dataDir, safeId);
  try {
    await unlink(filePath);
    if (opts.slug) publishCollectionChange({ slug: opts.slug, ids: [safeId], op: "delete" });
    return { kind: "ok", itemId: safeId };
  } catch (err) {
    const error = err as { code?: string };
    if (error.code === "ENOENT") return { kind: "not-found", itemId: safeId };
    throw err;
  }
}

/** Generate a short random hex id. Used by POST when the form doesn't
 *  carry a primary-key value (UI shortcut — Claude normally derives a
 *  semantic id from the record's name). */
export function generateItemId(): string {
  return randomBytes(4).toString("hex");
}

/** The item id a CREATE should use for `schema`, or null when the
 *  caller should generate one. A singleton collection pins every
 *  create to its fixed `schema.singleton` id, so the "at most one
 *  record" contract is enforced server-side (a second create targets
 *  the same file and hits `writeItem`'s refuseOverwrite conflict) —
 *  not only in the UI. Otherwise the record's own primaryKey value
 *  wins, falling back to a generated id (null = "generate"). */
export function resolveCreateItemId(schema: CollectionSchema, record: CollectionItem): string | null {
  if (schema.singleton) return schema.singleton;
  const primaryRaw = record[schema.primaryKey];
  return typeof primaryRaw === "string" && primaryRaw.length > 0 ? primaryRaw : null;
}
