// DuckDB-backed read-only store over an external CSV file (schema
// `dataSource`, v1). The user's file is the source of truth and is NEVER
// modified: non-UTF-8 files (Shift_JIS rosters are the primary use case)
// are decoded to a content-addressed UTF-8 cache copy under os.tmpdir()
// and DuckDB reads that copy.
//
// Row → record contract:
//   - the schema's `primaryKey` names the CSV column whose value becomes
//     the record id; CSV columns map to fields by NAME;
//   - a key value that isn't a safe record id (Japanese, spaces, …) is
//     hex-encoded (`id0x…`) so detail URLs / remote-view addressing keep
//     working — `displayField` covers presentation;
//   - duplicate key values: LAST row wins (a warn is logged); rows with an
//     empty/missing key are skipped (warn);
//   - `list()` is capped at MAX_CSV_ROWS — the whole existing UI
//     materializes every record, so an uncapped 2M-row file would be a
//     memory bomb. v2 replaces the cap with paging + native aggregation.
//
// SQL safety: the row-value comparison is a prepared-statement parameter,
// never string concatenation; the key column is identifier-quoted. The
// file path itself is host-resolved (workspace containment in discovery)
// and also bound as a parameter.
//
// DuckDB is a native module; `import()` failures (unsupported platform,
// broken install) degrade to a thrown, clearly-worded error so ONLY
// dataSource collections break — see
// packages/core/assets/helps/error-recovery.md.

import { fieldTextOrNull } from "../core/fieldText";
import { BackendUnavailableError } from "./backendAvailability";
import { lstat, mkdir, open, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import iconv from "iconv-lite";
import type { CollectionItem } from "../core/schema";
import type { CollectionQuery } from "../core/queryZ";
import { compileCsvQuery, quoteIdent, readCsvArgs } from "./csvQuery";
import { getWorkspaceRoot, log } from "./host";
import { isContainedInRoot, safeRecordId } from "./paths";

/** `list()` row cap. Over-cap files are truncated with a warn — the v1
 *  contract is "browse + per-record views", not full-table analytics. */
export const MAX_CSV_ROWS = 5000;

/** Record ids minted from non-safe key values: `id0x` + utf-8 hex. Raw key
 *  values that themselves match this pattern are ALSO encoded, so the
 *  encoded namespace never collides with a raw value (injective mapping). */
const ENCODED_ID_PATTERN = /^id0x([0-9a-f]+)$/;

/** A CSV key value → the record id it's addressed by. Safe values pass
 *  through untouched; everything else (and anything shaped like an encoded
 *  id) becomes `id0x<hex>`. Pure + exported for unit tests. */
export function encodeCsvRecordId(rawKey: string): string {
  if (safeRecordId(rawKey) === rawKey && !ENCODED_ID_PATTERN.test(rawKey)) return rawKey;
  return `id0x${Buffer.from(rawKey, "utf-8").toString("hex")}`;
}

/** A record id → the CSV key value to look up. Inverse of
 *  `encodeCsvRecordId` for encoded ids; anything else is already the raw
 *  value. Pure + exported for unit tests. */
export function decodeCsvRecordId(itemId: string): string {
  const match = ENCODED_ID_PATTERN.exec(itemId);
  if (!match) return itemId;
  return Buffer.from(match[1], "hex").toString("utf-8");
}

/** Normalize one DuckDB JS value into a JSON-safe record value: BigInt →
 *  number (string beyond the safe range), DATE/TIMESTAMP → ISO string
 *  (date-only when the clock is exactly UTC midnight, matching the `date`
 *  field contract), exotic DuckDB values → their string form. Pure +
 *  exported for unit tests. */
/** `JSON.stringify` restricted to what a CSV cell can survive. Returns the
 *  serialised value, or `String(value)` when serialisation is impossible —
 *  losing the content of one cell is bad, failing the entire query is worse. */
function safeJsonCell(value: object): string {
  try {
    const json = JSON.stringify(value, (_key, entry: unknown) => (typeof entry === "bigint" ? entry.toString() : entry));
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- last resort: JSON.stringify returned undefined (an object whose toJSON does). "[object Object]" at least says "this cell held an object"; "" would erase that it existed.
    return json ?? String(value);
  } catch {
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- the serialiser threw (circular ref). Same reasoning as above: a placeholder beats losing the cell entirely.
    return String(value);
  }
}

export function normalizeCsvValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(-Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
  }
  if (value instanceof Date) {
    const iso = value.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
  }
  // A DuckDB STRUCT / LIST / MAP arrives as an object. `String(...)` renders it
  // "[object Object]" — the cell's content is simply gone. Serialise instead:
  // this is a data cell, not an id or a matcher key, so preserving what the
  // column holds beats reducing it to a placeholder.
  //
  // Guarded, because `JSON.stringify` is not total on what DuckDB can hand us:
  // it throws on a BIGINT nested in a struct (the branch above only unwraps a
  // top-level bigint) and on a circular ref, and returns undefined when an
  // object's `toJSON` does. A cell that cannot be serialised falls back to the
  // old rendering rather than aborting the whole read.
  if (value !== null && typeof value === "object") return safeJsonCell(value);
  return value;
}

/** One raw DuckDB row → a CollectionItem, or null when the key cell is
 *  missing/empty (the row can't be addressed). The primaryKey field is
 *  OVERWRITTEN with the (possibly encoded) record id so `item[primaryKey]`
 *  and the record's address never drift — same invariant the file store's
 *  write path enforces. Pure + exported for unit tests. */
export function csvRowToItem(row: Record<string, unknown>, primaryKey: string): CollectionItem | null {
  const normalized = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalizeCsvValue(value)]));
  const rawKey = normalized[primaryKey];
  // Identity: same rule as every other primaryKey read. `normalizeCsvValue` has
  // already flattened objects to JSON, so anything without a text form here is
  // genuinely unaddressable.
  const keyText = fieldTextOrNull(rawKey);
  if (keyText === null || keyText === "") return null;
  return { ...normalized, [primaryKey]: encodeCsvRecordId(keyText) };
}

/** Dedupe by record id, LAST row wins (matches `csvRead`'s last-match
 *  pick). Returns the surviving items in first-seen order. Pure +
 *  exported for unit tests. */
export function dedupeByRecordId(items: CollectionItem[], primaryKey: string): { items: CollectionItem[]; duplicates: number } {
  const byId = new Map<string, CollectionItem>();
  for (const item of items) byId.set(String(item[primaryKey]), item);
  return { items: [...byId.values()], duplicates: items.length - byId.size };
}

/** True when a thrown DuckDB error is the `types` pin naming a column the
 *  CSV doesn't have — the schema/file-mismatch case the caller downgrades
 *  to "empty collection + warn" instead of a 500. */
function isMissingKeyColumnError(err: unknown): boolean {
  return String(err).includes("do not exist in the CSV");
}

// ---------------------------------------------------------------------------
// Encoding: never touch the user's file — decode to a tmpdir cache copy
// ---------------------------------------------------------------------------

/** Bytes sniffed for UTF-8 validity. The trailing 3 bytes of the sample
 *  are dropped so a multibyte char split at the boundary can't produce a
 *  false negative on a valid file. */
const SNIFF_BYTES = 1024 * 1024;

function isValidUtf8(buf: Buffer): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

/** Detect the (best-effort) encoding of a non-UTF-8 buffer. BOMs decide
 *  UTF-16; otherwise cp932 (the Shift_JIS superset — Excel-exported
 *  Japanese CSVs are the primary non-UTF-8 case this feature serves). */
function fallbackEncoding(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return "utf-16le";
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return "utf-16be";
  return "cp932";
}

export function cacheDir(): string {
  return path.join(tmpdir(), "mulmoclaude-csv-utf8");
}

/** Read only the first `bytes` of a file — the encoding sniff must not
 *  pull a multi-hundred-MB CSV into memory on the (common) UTF-8 path. */
async function readHead(absPath: string, bytes: number): Promise<Buffer> {
  const handle = await open(absPath, "r");
  try {
    const { size } = await handle.stat();
    const buf = Buffer.alloc(Math.min(bytes, size));
    await handle.read(buf, 0, buf.length, 0);
    return buf;
  } finally {
    await handle.close();
  }
}

/** Decode the whole file into a UTF-8 cache copy and return its path.
 *  Cache key = (path, mtime, size), so a replaced CSV re-decodes and an
 *  unchanged one never does. */
async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/** Best-effort removal of older decode-cache entries for the same source
 *  path — a frequently-replaced large CSV would otherwise accumulate one
 *  full copy per (mtime, size) forever. Runs AFTER the current copy is
 *  published; a concurrent reader holding an old fd is unaffected
 *  (unlink-while-open is safe on POSIX). */
async function evictSupersededCache(key: string, keepBasename: string): Promise<void> {
  try {
    const entries = await readdir(cacheDir());
    await Promise.all(
      entries.filter((name) => name.startsWith(`${key}-`) && name !== keepBasename).map((name) => unlink(path.join(cacheDir(), name)).catch(() => undefined)),
    );
  } catch {
    // cache dir missing / unreadable — nothing to evict
  }
}

/** Decode the whole file into a UTF-8 cache copy and return its path.
 *  Cache key = (path, mtime, size), so a replaced CSV re-decodes and an
 *  unchanged one never does; superseded copies are evicted. The cache
 *  lives in the SHARED OS tmpdir, so the dir is 0700 and files 0600 —
 *  decoded rows must not be readable by other local users. */
async function decodeToCache(absPath: string, info: { mtimeMs: number; size: number }): Promise<string> {
  const key = createHash("sha256").update(absPath).digest("hex").slice(0, 16);
  const cached = path.join(cacheDir(), `${key}-${Math.trunc(info.mtimeMs)}-${info.size}.csv`);
  if (!(await pathExists(cached))) {
    const whole = await readFile(absPath);
    const encoding = fallbackEncoding(whole);
    const text = iconv.decode(whole, encoding);
    await mkdir(cacheDir(), { recursive: true, mode: 0o700 });
    // Unique tmp name + rename in the SAME dir — atomic publish, and a
    // concurrent decode of the same file just wins/loses the rename cleanly.
    const tmp = `${cached}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmp, text, { encoding: "utf-8", mode: 0o600 });
    await rename(tmp, cached);
    log.info("collections", "decoded non-UTF-8 dataSource file to cache", { path: absPath, encoding });
    await evictSupersededCache(key, path.basename(cached));
  }
  return cached;
}

/** Re-validate the dataSource file at READ time, mirroring the JSON
 *  store's per-read defenses: realpath containment (a symlink swapped in
 *  after discovery must not walk out of the workspace) and an lstat
 *  regular-file check (a symlink leaf is refused outright, even one
 *  pointing inside the workspace — same rule as `isRegularFile` on
 *  record files). Returns the stat info, or null for "no readable file"
 *  (ENOENT / refused), which callers render as an empty collection. */
async function safeCsvStat(absPath: string, workspaceRoot: string): Promise<{ mtimeMs: number; size: number } | null> {
  if (!isContainedInRoot(absPath, workspaceRoot)) {
    log.warn("collections", "dataSource read refused: path escapes workspace", { path: absPath });
    return null;
  }
  let info;
  try {
    info = await lstat(absPath);
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return null;
    throw err;
  }
  if (!info.isFile()) {
    log.warn("collections", "dataSource read refused: not a regular file (symlink?)", { path: absPath });
    return null;
  }
  return info;
}

/** Return a path DuckDB can read as UTF-8: the original file when it
 *  already is UTF-8 (the cheap, common case — only the head is sniffed),
 *  else a decoded cache copy (see `decodeToCache`). Returns null when
 *  there is no readable file (missing, symlink, or containment-refused —
 *  see `safeCsvStat`), which callers render as an empty collection. */
async function ensureUtf8CsvPath(absPath: string, workspaceRoot: string): Promise<string | null> {
  const info = await safeCsvStat(absPath, workspaceRoot);
  if (info === null) return null;
  const head = await readHead(absPath, SNIFF_BYTES);
  // Drop the tail bytes of a full-length sample so a multibyte char split
  // at the boundary can't read as invalid UTF-8.
  const sample = head.length === SNIFF_BYTES ? head.subarray(0, SNIFF_BYTES - 3) : head;
  const hasUtf16Bom = head.length >= 2 && ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff));
  if (!hasUtf16Bom && isValidUtf8(sample)) return absPath;
  return decodeToCache(absPath, info);
}

// ---------------------------------------------------------------------------
// DuckDB plumbing
// ---------------------------------------------------------------------------

interface DuckDbModule {
  DuckDBInstance: {
    create: (dbPath?: string) => Promise<{
      connect: () => Promise<{
        runAndReadAll: (sql: string, values?: unknown[]) => Promise<{ getRowObjectsJS: () => Record<string, unknown>[] }>;
        disconnectSync: () => void;
      }>;
    }>;
  };
}

let instancePromise: ReturnType<DuckDbModule["DuckDBInstance"]["create"]> | null = null;

/** Lazily create one shared in-memory DuckDB instance. The dynamic import
 *  keeps the native module OUT of core's load path — a platform where the
 *  prebuilt binding is missing degrades to a per-query error on dataSource
 *  collections only, never a broken core. A failed init is retried on the
 *  next call (the promise is reset). */
async function duckDbInstance(): ReturnType<DuckDbModule["DuckDBInstance"]["create"]> {
  if (instancePromise === null) {
    instancePromise = import("@duckdb/node-api").then((mod) => (mod as unknown as DuckDbModule).DuckDBInstance.create(":memory:"));
  }
  try {
    return await instancePromise;
  } catch (err) {
    instancePromise = null;
    throw new BackendUnavailableError(
      `DuckDB is unavailable on this host (@duckdb/node-api failed to load: ${String(err)}) — dataSource collections cannot be read`,
    );
  }
}

export async function queryCsv(sql: string, params: unknown[]): Promise<Record<string, unknown>[]> {
  const instance = await duckDbInstance();
  const connection = await instance.connect();
  try {
    const reader = await connection.runAndReadAll(sql, params);
    return reader.getRowObjectsJS();
  } finally {
    connection.disconnectSync();
  }
}

// ---------------------------------------------------------------------------
// The store operations (consumed by storeFor in ./store)
// ---------------------------------------------------------------------------

/** Every row of the CSV as records — capped, deduped, id-encoded. The
 *  key column is pinned to VARCHAR (see `readCsvArgs`). `workspaceRoot`
 *  drives the per-read containment check; omitted, the configured host
 *  root is used. */
export interface CsvListResult {
  items: CollectionItem[];
  /** True when the scan stopped at `MAX_CSV_ROWS` — `items` is then a
   *  row-capped prefix, not the whole file. Surfaced to `ListPage.truncated`
   *  so callers see the cap instead of inferring it from a warn log. */
  truncated: boolean;
}

export async function csvList(absPath: string, primaryKey: string, workspaceRoot?: string): Promise<CsvListResult> {
  const utf8Path = await ensureUtf8CsvPath(absPath, workspaceRoot ?? getWorkspaceRoot());
  if (utf8Path === null) return { items: [], truncated: false };
  let rows: Record<string, unknown>[];
  try {
    rows = await queryCsv(`SELECT * FROM read_csv(${readCsvArgs(primaryKey)}) LIMIT ${MAX_CSV_ROWS + 1}`, [utf8Path]);
  } catch (err) {
    // The VARCHAR pin names a column the CSV doesn't have — a schema/file
    // mismatch, rendered as an empty collection with a warn (same outcome
    // the pre-pin `primaryKey in row` check produced), not a 500.
    if (!isMissingKeyColumnError(err)) throw err;
    log.warn("collections", "dataSource CSV has no primaryKey column — every row is skipped", { path: absPath, primaryKey });
    return { items: [], truncated: false };
  }
  const truncated = rows.length > MAX_CSV_ROWS;
  if (truncated) {
    log.warn("collections", "dataSource CSV truncated to row cap", { path: absPath, cap: MAX_CSV_ROWS });
    rows.length = MAX_CSV_ROWS;
  }
  const items = rows.map((row) => csvRowToItem(row, primaryKey)).filter((item): item is CollectionItem => item !== null);
  const skipped = rows.length - items.length;
  if (skipped > 0) log.warn("collections", "dataSource CSV rows skipped (empty key cell)", { path: absPath, skipped });
  const deduped = dedupeByRecordId(items, primaryKey);
  if (deduped.duplicates > 0)
    log.warn("collections", "dataSource CSV has duplicate key values (last row wins)", { path: absPath, duplicates: deduped.duplicates });
  return { items: deduped.items, truncated };
}

/** The scan-order ordinal column the last-match read adds. Underscore
 *  prefix keeps it out of any plausible CSV header namespace; it is
 *  stripped from the returned record either way. */
const ROW_ORDINAL = "__mc_row";

/** One record by id. The comparison value rides as a prepared-statement
 *  parameter, and the LAST matching row is selected IN DuckDB (scan-order
 *  ordinal + LIMIT 1) — a CSV with thousands of duplicate keys must not
 *  materialize them all for one detail read. Consistent with csvList's
 *  last-wins dedupe. */
export async function csvRead(absPath: string, primaryKey: string, itemId: string, workspaceRoot?: string): Promise<CollectionItem | null> {
  const utf8Path = await ensureUtf8CsvPath(absPath, workspaceRoot ?? getWorkspaceRoot());
  if (utf8Path === null) return null;
  const rawKey = decodeCsvRecordId(itemId);
  // Errors (missing key column, malformed CSV, DuckDB unavailable)
  // propagate — a clear 500 with the DuckDB message beats a silent 404.
  const sql =
    `SELECT * FROM (SELECT *, row_number() OVER () AS ${quoteIdent(ROW_ORDINAL)} FROM read_csv(${readCsvArgs(primaryKey)})) ` +
    `WHERE CAST(${quoteIdent(primaryKey)} AS VARCHAR) = ? ORDER BY ${quoteIdent(ROW_ORDINAL)} DESC LIMIT 1`;
  const rows = await queryCsv(sql, [utf8Path, rawKey]);
  const last = rows.at(0);
  if (last === undefined) return null;
  const { [ROW_ORDINAL]: __ordinal, ...record } = last;
  return csvRowToItem(record, primaryKey);
}

/** Run a validated aggregation query (the structured DSL — see
 *  `core/queryZ.ts`) over the WHOLE file: no row cap on the scan (a
 *  capped aggregate would be a wrong number), only the result-row LIMIT
 *  the compiler emits. Values are normalized like list/read rows so a
 *  chart consumer gets plain JSON scalars. */
export async function csvRunQuery(absPath: string, primaryKey: string, query: CollectionQuery, workspaceRoot?: string): Promise<Record<string, unknown>[]> {
  const utf8Path = await ensureUtf8CsvPath(absPath, workspaceRoot ?? getWorkspaceRoot());
  if (utf8Path === null) return [];
  const { sql, params } = compileCsvQuery(query, primaryKey);
  const rows = await queryCsv(sql, [utf8Path, ...params]);
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalizeCsvValue(value)])));
}
