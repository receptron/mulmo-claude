// Validate a collection's record files and report problems back to the
// authoring LLM. The host SILENTLY skips unparseable records at read time
// (see `listItems`), so without this a single malformed file looks like
// "records vanished." `presentCollection` — which the LLM is told to call
// after every write — runs this and surfaces the problems in its result,
// closing the loop so the model fixes the file instead of a human noticing
// missing rows much later.

import { fieldText } from "../core/fieldText";
import { readdir, readFile, lstat } from "node:fs/promises";
import path from "node:path";
import { getWorkspaceRoot, log } from "./host";
import { isContainedInRoot } from "./paths";
import { storeFor } from "./store";
import { firstRecordProblem, type RecordCheckTier } from "../core/recordZ";
import type { LoadedCollection } from "./discoveredCollection";
import type { CollectionItem, CollectionSchema } from "../core/schema";

// The compiled record validators (and COMPUTED_TYPES, which moved next to
// them) live in the isomorphic ../core/recordZ; re-exported here so the
// existing `collection/server` importers resolve unchanged and future
// consumers (the reserved `mutate` action's `params` form) share the
// same compiler.
export { COMPUTED_TYPES, compileRecordZ, recordFieldProblem, type RecordCheckTier } from "../core/recordZ";

export interface RecordIssue {
  /** Record filename, e.g. `lesson-003.json`. */
  file: string;
  /** Human-readable problem, written to be actionable by the LLM. */
  problem: string;
}

// Don't flood the result; the first batch is enough to act on.
const MAX_ISSUES = 25;

/** Read every `<id>.json` under the collection's dataDir and report the
 *  ones that won't load or violate the schema. An empty list means every
 *  record is fine. */
/** List entries under the data dir, guarding realpath containment (against a
 *  symlinked dir swapped in after discovery, like `listItems`) and treating a
 *  missing dir as empty while surfacing real I/O faults. */
async function listRecordFilenames(dataDir: string, workspaceRoot: string): Promise<string[]> {
  if (!isContainedInRoot(dataDir, workspaceRoot)) {
    log.warn("collections", "validate refused: dataDir escapes workspace via symlink", { dataDir });
    return [];
  }
  try {
    return await readdir(dataDir);
  } catch (err) {
    const error = err as { code?: string };
    if (error.code === "ENOENT") return []; // no dir yet = no records
    throw err; // surface permission / I/O faults instead of silently passing
  }
}

export async function validateCollectionRecords(collection: LoadedCollection, opts: { workspaceRoot?: string } = {}): Promise<RecordIssue[]> {
  // A `dataSource` collection has no record FILES to validate — its rows
  // come from the external data file (type mismatches there surface as
  // raw values in the views, not as repairable record files).
  if (collection.schema.dataSource !== undefined) return [];
  // A `storage` collection's records live in its database, not as files —
  // validate what the store serves instead of scanning the phantom dataDir.
  if (collection.schema.storage !== undefined) return validateStoreRecords(collection, opts);
  const workspaceRoot = opts.workspaceRoot ?? getWorkspaceRoot();
  const entries = await listRecordFilenames(collection.dataDir, workspaceRoot);
  const issues: RecordIssue[] = [];
  for (const name of entries.sort()) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    if (issues.length >= MAX_ISSUES) break;
    const issue = await inspectRecord(path.join(collection.dataDir, name), name, collection.schema);
    if (issue) issues.push(issue);
  }
  return issues;
}

/** Store-backed twin of the file scan: list every record through the
 *  collection's store and lint it with the same "strict" report-only tier.
 *  A row the store can't even parse is invisible here (the store skips
 *  it), so the read/parse classifications of the file scan don't apply —
 *  schema violations are what this catches. `file` carries the record id
 *  (there is no per-record filename). */
async function validateStoreRecords(collection: LoadedCollection, opts: { workspaceRoot?: string }): Promise<RecordIssue[]> {
  let items: CollectionItem[];
  try {
    items = await storeFor(collection, { workspaceRoot: opts.workspaceRoot }).list();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return [{ file: "(store)", problem: `records could not be read from the storage backend: ${reason}` }];
  }
  const issues: RecordIssue[] = [];
  for (const item of items) {
    if (issues.length >= MAX_ISSUES) break;
    const itemId = fieldText(item[collection.schema.primaryKey]);
    const problem = validateRecordObject(item, itemId, collection.schema, "strict");
    if (problem) issues.push({ file: itemId, problem });
  }
  return issues;
}

// Read a record file's text, or classify why it can't be read (missing /
// symlink / unreadable). Split out to keep `inspectRecord` under the line limit.
async function readRecordText(fullPath: string, name: string): Promise<{ raw: string } | RecordIssue> {
  try {
    const stat = await lstat(fullPath);
    if (!stat.isFile()) return { file: name, problem: "not a regular file (symlink?) — skipped, won't appear" };
    return { raw: await readFile(fullPath, "utf-8") };
  } catch {
    return { file: name, problem: "could not be read — skipped, won't appear" };
  }
}

/** Classify a single record file: unreadable / unparseable / non-object /
 *  schema violation, or null when it's fine. */
async function inspectRecord(fullPath: string, name: string, schema: CollectionSchema): Promise<RecordIssue | null> {
  const read = await readRecordText(fullPath, name);
  if ("problem" in read) return read;
  let parsed: unknown;
  try {
    parsed = JSON.parse(read.raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      file: name,
      problem: `invalid JSON (${reason}) — SKIPPED, won't appear. Usual cause: an unescaped " inside a string value; use 「」/『』 or write \\" instead.`,
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { file: name, problem: "not a JSON object — skipped, won't appear" };
  }
  // "strict" tier: the file scan is REPORT-ONLY (surfaced through
  // presentCollection / the detail response), so it lints the per-type
  // rules the write gate does not yet enforce — legacy records written
  // under the loose rules get reported here, never rejected on write.
  const problem = validateRecordObject(parsed as CollectionItem, name.replace(/\.json$/, ""), schema, "strict");
  return problem ? { file: name, problem } : null;
}

/** What a non-string primary key actually is, for the error message. Names the
 *  shape rather than stringifying the value — "[object Object]" tells the reader
 *  nothing about what is wrong. */
function describeIdType(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "missing";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}

/** First schema problem on an in-memory record (primaryKey↔id mismatch,
 *  then the compiled per-field checks — see `../core/recordZ` for the two
 *  tiers), or null when it's fine. One issue per record keeps the report
 *  short and the fix obvious. Pure + exported so write paths
 *  (manageCollection putItems) can gate on the SAME enforced rules the
 *  post-hoc file scan reports — `itemId` is the id the record is (or
 *  would be) stored under. The default `"enforced"` tier keeps every
 *  write gate on the historical three checks; only pass `"strict"` from
 *  report-only surfaces. */
export function validateRecordObject(record: CollectionItem, itemId: string, schema: CollectionSchema, tier: RecordCheckTier = "enforced"): string | null {
  const idValue = record[schema.primaryKey];
  // Two distinct failures, reported distinctly. A non-string id used to be
  // rendered with `String(...)`, so an object arrived in the message as
  // "[object Object]" — which reads like a value the user typed rather than a
  // type error, and no longer matched the (now text-derived) `itemId` it was
  // being compared against.
  if (typeof idValue !== "string") {
    return `'${schema.primaryKey}' must be a string, but is ${describeIdType(idValue)} — must equal the filename ('${itemId}'), or the record can't be opened`;
  }
  if (idValue !== itemId) {
    return `'${schema.primaryKey}' is '${idValue}' but must equal the filename ('${itemId}'), or the record can't be opened`;
  }
  return firstRecordProblem(record, schema, tier);
}
