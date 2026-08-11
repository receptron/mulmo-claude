// `manageCollection` is the agent's data plane for schema-driven
// collections — the paved road over the same record files that raw
// Read/Write/Edit reach (the workspace stays the database; this tool is
// a convenience + gate, not a second store):
//
//   - getItems: records WITH the host-computed fields the stored JSON
//     never contains — `derived` formulas evaluated (cross-collection
//     derefs included), `toggle` projected, `embed` resolved — i.e. the
//     same numbers the user sees rendered. One call instead of N file
//     Reads plus a mental join.
//   - putItems: rows validated against the schema BEFORE the write
//     (primaryKey↔id, required fields, enum membership, no computed
//     keys), written atomically, with per-row accept/reject results the
//     model can fix and retry — instead of writing a broken file and
//     meeting it later in the presentCollection repair loop.
//   - deleteItems: removal by id, so a collection whose records aren't
//     files (or whose caller shouldn't be handed raw unlink) still has a
//     delete. A missing id rejects rather than reporting success.
//   - getOntology: the machine-readable workspace ontology — every
//     collection with its record count and outbound ref/embed relations,
//     so a cross-collection question starts from the map instead of
//     re-reading every schema.
//
// It is also the paved road for a collection's STRUCTURE — so an edit
// gets the same authoring reference + validation a create does:
//
//   - schemaDocs: the collection-authoring reference (`collection-skills.md`)
//     delivered as a method, so the agent never needs to know the help
//     file's path or that it exists — the gap that made schema EDITS fail
//     (create-time prompts point at the doc; edit-time had no pointer).
//     Sectioned via `topic` (see schemaDocs.ts): the full doc outgrew the
//     agent's per-tool-result limit.
//   - getSchema / putSchema: read the raw schema.json, and validate it
//     against `CollectionSchemaZ` BEFORE writing the canonical staging
//     copy + mirroring it active (an internal write skips the skill-bridge
//     hook, so the mirror is explicit). Edit-only; creation stays the
//     normal "write SKILL.md + schema.json under data/skills/" flow.
//
// Shared by both hosts (MulmoClaude's mcp-tools shim + MulmoTerminal):
// everything host-specific rides in `ManageCollectionDeps` — the
// workspace root falls back to the configured collection host
// (`getWorkspaceRoot`), the post-putSchema UI refresh and the
// evaluation-only validation ablation are injected, and tests point the
// whole tool at a tmpdir workspace via the same deps.

import { isRecord, isStringArray, isUnknownArray } from "@mulmoclaude/common";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { COMPUTED_TYPES } from "../core/schema";
import type { CollectionItem, CollectionSchema } from "../core/schema";
import { CollectionSchemaZ } from "../core/schemaZ";
import { CollectionQueryZ } from "../core/queryZ";
import { defangForPrompt } from "../core/promptSafety";
import { loadCollection, resolvePrimaryField, type DiscoveryOptions } from "./discovery";
import type { LoadedCollection } from "./discoveredCollection";
import { resolveCreateItemId } from "./io";
import { readOnlyRefusal, storeFor, type CollectionStore } from "./store";
import { isBackendUnavailable } from "./backendAvailability";
import { runCollectionQuery } from "./queryRunner";
import { enrichItems } from "./derive";
import { validateCollectionRecords, validateRecordObject } from "./validate";
import { publishApp } from "./publish";
import { buildWorkspaceOntology } from "./ontology";
import { resolveDataDir } from "./paths";
import { getWorkspaceRoot, stagingSkillDir } from "./host";
import { writeFileAtomic } from "../../files/atomic.js";
import { mirrorSkillWrite } from "../../skill-bridge/index.js";
import { renderSchemaDocs, type AuthoringVariant } from "./schemaDocs";
// NOTE: only the browser-safe `slug` module — workspace-setup's assets.ts uses
// `import.meta.url` and is ESM-only (build pass 2), while this entry builds
// dual ESM+CJS. The bundled-docs dir is injected instead (`bundledHelpsDir`).
import { isPresetSlug } from "../../workspace-setup/slug";

/** Refuse an unselective getItems beyond this many records — a silent
 *  truncation would read as "covered everything", and an unbounded dump
 *  of a large collection is a token bomb. `ids` or `fields` lifts it. */
export const MAX_UNSELECTIVE_ITEMS = 200;

/** schema.json basename under a skill dir (canonical staging + active mirror). */
const SCHEMA_FILE = "schema.json";
/** The collection-authoring reference, served by the `schemaDocs` action. */
const SCHEMA_DOCS_FILE = "collection-skills.md";
/** Cap the rejected-schema issue list so a deeply-broken schema can't flood the result. */
export const MAX_SCHEMA_ISSUES = 20;
/** The workspace help-docs dir both hosts seed (`@mulmoclaude/core/workspace-setup`
 *  syncs the bundled assets here) — the user-editable copy schemaDocs prefers. */
const HELPS_DIR = "config/helps";
/** `schemaDocs` names no collection, but the authoring layout is resolved per
 *  slug (staging is `<staging>/<slug>`). This stands in, so the doc variant and
 *  a later `putSchema` on any slug in this root cannot disagree. */
const SCHEMA_DOCS_PROBE_SLUG = "_";

/** Workspace-targeting overrides, threaded to every collections call.
 *  Production: `{}` (the configured collection host's workspace).
 *  Tests: a tmpdir + empty user skills dir. `refreshAfterWrite` is the
 *  best-effort UI-refresh fired after a `putSchema` write — hosts with
 *  schema-driven side state (MulmoClaude's scheduled skills / user
 *  tasks) inject their refreshers; omitted, no refresh runs (discovery
 *  re-reads schema.json on every call, so only a live UI update is
 *  delayed, never the data). */
export type ManageCollectionDeps = DiscoveryOptions & {
  refreshAfterWrite?: (() => Promise<void>) | undefined;
  /** Evaluation-only: skip pre-write record validation in putItems and
   *  the getItems record-issue scan. MulmoClaude's production singleton
   *  binds this from its ablation env; leave unset everywhere else. */
  ablateValidation?: boolean | undefined;
  /** The host's bundled help-docs dir (workspace-setup's `helpsAssetDir()`)
   *  — the `schemaDocs` fallback when the workspace has no `config/helps`
   *  copy. Injected because that module is ESM-only (`import.meta.url`)
   *  while this entry builds dual ESM+CJS. Omitted, only the workspace
   *  copy is tried. */
  bundledHelpsDir?: (() => string) | undefined;
  /** Does THIS root author collection skills through a `data/skills/` staging
   *  tree that a skill-bridge hook mirrors into `.claude/skills/`?
   *
   *  `true` (the default, and the managed-workspace behaviour) serves the
   *  authoring reference telling the agent to write under `data/skills/<slug>/`
   *  — correct there, because `.claude/` is gated and the bridge mirrors across.
   *
   *  `false` is for a root with NO bridge (a plain project folder). There the
   *  same instruction fails silently and completely: the agent writes
   *  `data/skills/<slug>/schema.json`, nothing mirrors it, discovery only scans
   *  `<root>/.claude/skills`, and the collection is never discovered — with no
   *  error anywhere. The unstaged text tells the agent to author directly under
   *  `.claude/skills/<slug>/` instead.
   *
   *  A host that binds one root per project passes this per call, alongside
   *  `workspaceRoot`; it is deliberately NOT derived from `skillsStagingDir`
   *  returning null, because the doc variant is a statement the host makes, not
   *  something the package should infer. */
  stagedSkillAuthoring?: boolean | undefined;
};

/** Resolve the workspace root the same way every collections call does:
 *  the injected override (tests) or the configured collection host. */
function resolveBase(deps: ManageCollectionDeps): string {
  return deps.workspaceRoot ?? getWorkspaceRoot();
}

/** Where a collection skill is authored in THIS root, and therefore both which
 *  authoring guide `schemaDocs` serves and where `getSchema` / `putSchema`
 *  read and write. `null` staging means "author in the active skill dir".
 *
 *  ONE predicate on purpose. Two knobs describe this — the host's
 *  `stagedSkillAuthoring` and its `skillsStagingDir` — and either alone can
 *  disagree with the other: a host that says `stagedSkillAuthoring: false`
 *  while still returning a staging path would have the agent told to write
 *  `.claude/skills/<slug>/` while `putSchema` wrote `data/skills/` and mirrored
 *  from there, so the tool would silently contradict its own documentation.
 *  Staged requires BOTH to agree; anything else is direct. */
function authoringTarget(deps: ManageCollectionDeps, slug: string): { variant: AuthoringVariant; stagingDir: string | null } {
  const stagingDir = deps.stagedSkillAuthoring === false ? null : stagingSkillDir(resolveBase(deps), slug);
  return { variant: stagingDir === null ? "direct" : "staged", stagingDir };
}

/** Shared "unknown collection" message — its schema.json is missing or
 *  failed validation, so discovery skipped it. */
function unknownCollection(slug: string): string {
  return `manageCollection: unknown collection '${defangForPrompt(slug)}' — its schema.json is missing or failed validation.`;
}

interface GetItemsArgs {
  slug: string;
  ids?: string[] | undefined;
  fields?: string[] | undefined;
}

type PutMode = "upsert" | "create" | "merge";

interface PutItemsArgs {
  slug: string;
  items: CollectionItem[];
  mode: PutMode;
}

function optionalStringArray(value: unknown, name: string): { ok: true; value?: string[] } | { ok: false; error: string } {
  if (value === undefined) return { ok: true };
  if (!isStringArray(value) || !value.every((entry) => entry.length > 0)) {
    return { ok: false, error: `manageCollection: \`${name}\` must be an array of non-empty strings when present.` };
  }
  return { ok: true, value };
}

/** Project a record down to the requested fields. The primary key is
 *  always kept so every returned record stays addressable for a
 *  follow-up getItems/putItems. */
function projectFields(record: CollectionItem, fields: string[], primaryKey: string): CollectionItem {
  const keys = fields.includes(primaryKey) ? fields : [primaryKey, ...fields];
  // Own-property only: a requested field named `toString` / `constructor`
  // must project as absent, not pull an inherited prototype function that
  // `JSON.stringify` then drops — leaving the LLM to read the field as empty.
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(record, key)).map((key) => [key, record[key]]));
}

/** The validation warning appended to a getItems result when stored
 *  record files are malformed (they're silently skipped at read time,
 *  so without this they'd just look missing). Issue strings quote
 *  record-controlled text → defanged, mirroring the presentCollection
 *  dispatch. The record VALUES in `items` ride verbatim, like a raw
 *  file Read — only host-composed report strings are defanged. */
async function recordIssuesWarning(collection: LoadedCollection, deps: ManageCollectionDeps): Promise<string | undefined> {
  if (deps.ablateValidation) return undefined;
  const issues = await validateCollectionRecords(collection, { workspaceRoot: deps.workspaceRoot });
  if (issues.length === 0) return undefined;
  const lines = issues.map((issue) => `- ${defangForPrompt(issue.file)}: ${defangForPrompt(issue.problem)}`).join("\n");
  return `${issues.length} record file(s) have data problems and are missing from this result. Fix each (Read → correct → Write):\n${lines}`;
}

async function loadRequestedItems(
  collection: LoadedCollection,
  ids: string[] | undefined,
  deps: ManageCollectionDeps,
): Promise<{ items: CollectionItem[]; missing: string[] }> {
  const store = storeFor(collection, { workspaceRoot: deps.workspaceRoot });
  if (!ids) return { items: await store.list(), missing: [] };
  const items: CollectionItem[] = [];
  const missing: string[] = [];
  for (const recordId of ids) {
    // The file store's read THROWS on a malformed record file (only ENOENT
    // is null) — for the tool that's a `missing` entry, not a failed call:
    // the warning scan that runs whenever something is missing then names
    // the broken file and how to fix it.
    const item = await store.read(recordId).catch((err: unknown) => {
      // An UNAVAILABLE backend is not an absent record. Flattening it into
      // `missing` would have the agent hunt a data problem that doesn't
      // exist — and the repair scan then blames files that are fine.
      if (isBackendUnavailable(err)) throw err;
      return null;
    });
    if (item) items.push(item);
    else missing.push(recordId);
  }
  return { items, missing };
}

async function handleGetItems(collection: LoadedCollection, args: GetItemsArgs, deps: ManageCollectionDeps): Promise<string> {
  const { ids, fields } = args;
  const { items, missing } = await loadRequestedItems(collection, ids, deps);
  if (!ids && !fields && items.length > MAX_UNSELECTIVE_ITEMS) {
    return `manageCollection: refused — '${collection.slug}' has ${items.length} records, over the unselective limit of ${MAX_UNSELECTIVE_ITEMS}. Pass \`ids\` for specific records or \`fields\` to project only the columns you need.`;
  }
  const enriched = await enrichItems(collection, items, deps);
  const projected = fields ? enriched.map((item) => projectFields(item, fields, collection.schema.primaryKey)) : enriched;
  // The warning scan reads every record file, so don't pay it on a
  // selective read that found everything it asked for — only a full
  // listing (where a malformed file silently looks absent) or a missing
  // requested id (where the scan explains WHY it's missing) needs it.
  const warning = !ids || missing.length > 0 ? await recordIssuesWarning(collection, deps) : undefined;
  return JSON.stringify({
    collection: collection.slug,
    count: projected.length,
    items: projected,
    ...(missing.length > 0 ? { missing: missing.map((recordId) => defangForPrompt(recordId)) } : {}),
    ...(warning ? { warning } : {}),
  });
}

/** Reject writes that set host-computed keys, with a pointer at the
 *  writable source of truth (the toggle's enum) where one exists. */
function computedKeyProblem(record: CollectionItem, schema: CollectionSchema): string | null {
  for (const key of Object.keys(record)) {
    const spec = schema.fields[key];
    if (!spec || !COMPUTED_TYPES.has(spec.type)) continue;
    if (spec.type === "toggle" && spec.field) return `'${key}' is a toggle projection — write the enum field '${spec.field}' instead`;
    const kindLabel: Record<string, string> = { derived: "derived", embed: "an embed", backlinks: "a backlinks view", rollup: "a rollup" };
    return `'${key}' is ${kindLabel[spec.type] ?? "computed"} — computed by the host, remove it from the record`;
  }
  return null;
}

interface RejectedRow {
  id: string;
  problem: string;
}

/** `mode: "merge"` resolves the row against the EXISTING record —
 *  a partial row updates just the fields it carries, instead of a
 *  whole-record upsert silently erasing the optional fields it omits
 *  (an upsert of `{id, status}` would pass validation yet drop
 *  `notes`/`lesson`/…). Merge is a partial UPDATE by definition, so a
 *  missing record is a reject, not an implicit create — a merged-over-
 *  nothing partial record is exactly the data shape this mode exists
 *  to prevent.
 *
 *  Computed keys found in the STORED record are stripped before the
 *  merge: the caller's own row was already computed-key-rejected, but a
 *  raw-written / legacy record can carry a stale `derived`/`embed`/
 *  `toggle` value, and re-writing it would perpetuate a forged
 *  host-computed value. A merge heals the record instead.
 *
 *  the store read THROWS on a malformed stored file (only ENOENT is null) —
 *  downgraded to a per-row rejection here, like loadRequestedItems'
 *  `missing`, so one broken file can't abort the whole putItems batch. */
async function mergeWithExisting(
  collection: LoadedCollection,
  store: CollectionStore,
  record: CollectionItem,
  itemId: string,
): Promise<CollectionItem | string> {
  let existing: CollectionItem | null;
  try {
    existing = await store.read(itemId);
  } catch (err) {
    // Same distinction as loadRequestedItems: an unreachable backend is not a
    // broken record, and telling the agent to "fix the file" points it at a
    // file that may not even exist for this backend.
    if (isBackendUnavailable(err)) throw err;
    return `'${itemId}' has a malformed stored file — mode "merge" needs to read it; fix the file (Read → correct → Write) or replace it whole with "upsert"`;
  }
  if (!existing) return `'${itemId}' not found — mode "merge" updates an existing record; use "upsert" or "create" to add it`;
  const stored = Object.entries(existing).filter(([key]) => {
    const spec = collection.schema.fields[key];
    return !spec || !COMPUTED_TYPES.has(spec.type);
  });
  return { ...Object.fromEntries(stored), ...record };
}

async function putOneItem(
  collection: LoadedCollection,
  store: CollectionStore,
  write: NonNullable<CollectionStore["write"]>,
  record: CollectionItem,
  mode: PutMode,
  deps: ManageCollectionDeps,
): Promise<{ written?: string; rejected?: RejectedRow }> {
  const { schema } = collection;
  const itemId = resolveCreateItemId(schema, record);
  const reject = (about: string, problem: string): { rejected: RejectedRow } => ({
    rejected: { id: defangForPrompt(about), problem: defangForPrompt(problem) },
  });
  if (itemId === null) return reject("(no id)", `record has no '${schema.primaryKey}' value — set it (it doubles as the filename)`);
  const computed = computedKeyProblem(record, schema);
  if (computed) return reject(itemId, computed);
  let toWrite = record;
  if (mode === "merge") {
    const merged = await mergeWithExisting(collection, store, record, itemId);
    if (typeof merged === "string") return reject(itemId, merged);
    toWrite = merged;
  }
  if (!deps.ablateValidation) {
    const invalid = validateRecordObject(toWrite, itemId, schema);
    if (invalid) return reject(itemId, invalid);
  }
  const result = await write(itemId, toWrite, { refuseOverwrite: mode === "create" });
  if (result.kind === "ok") return { written: result.itemId };
  if (result.kind === "invalid-id")
    return reject(itemId, `'${itemId}' is not a valid record id (letters/digits at the ends; -, _, or . inside; no '..' or path characters)`);
  if (result.kind === "conflict") return reject(itemId, `'${itemId}' already exists — mode "create" refuses overwrite; use "upsert" to update it`);
  return reject(itemId, "write refused: the collection's data dir escapes the workspace");
}

/** Aggregation over a collection via the structured query DSL
 *  (`core/queryZ.ts`) — the paved road for counts / sums / group-bys
 *  that a row listing can't answer honestly. The engine choice (native
 *  store query vs enrich-then-JSONL fallback) lives in
 *  `runCollectionQuery`, shared with the desktop custom view's `/query`
 *  route so the two surfaces can never drift. */
async function handleQueryItems(collection: LoadedCollection, queryArg: unknown, deps: ManageCollectionDeps): Promise<string> {
  const parsed = CollectionQueryZ.safeParse(queryArg);
  if (!parsed.success) {
    const lines = parsed.error.issues
      .slice(0, MAX_SCHEMA_ISSUES)
      .map((issue) => `- ${issue.path.map(String).join(".") || "(root)"}: ${defangForPrompt(issue.message)}`);
    return `manageCollection: \`query\` rejected — fix and retry:\n${lines.join("\n")}`;
  }
  const rows = await runCollectionQuery(collection, parsed.data, { workspaceRoot: deps.workspaceRoot });
  return JSON.stringify({ collection: collection.slug, count: rows.length, rows });
}

async function handlePutItems(collection: LoadedCollection, args: PutItemsArgs, deps: ManageCollectionDeps): Promise<string> {
  // Server-enforced read-only: a `dataSource` collection's rows live in
  // the external data file — point the agent at the real update path
  // instead of writing phantom record files. The store encodes this as an
  // absent `write` method.
  const store = storeFor(collection, { workspaceRoot: deps.workspaceRoot });
  const { write } = store;
  if (!write) {
    return `manageCollection: ${readOnlyRefusal(collection.slug)} (its records are the rows of '${collection.schema.dataSource?.path}'; edit that file to change the data).`;
  }
  const written: string[] = [];
  const rejected: RejectedRow[] = [];
  for (const record of args.items) {
    const outcome = await putOneItem(collection, store, write, record, args.mode, deps);
    if (outcome.written) written.push(outcome.written);
    if (outcome.rejected) rejected.push(outcome.rejected);
  }
  return JSON.stringify({ collection: collection.slug, written, rejected });
}

/** Delete records by id, through the store — so it works on any writable
 *  backend, not just file records. Same read-only refusal as putItems (an
 *  absent `delete` IS the refusal), and the same per-id result shape so a
 *  partially-bad batch reports per id instead of failing whole. */
async function handleDeleteItems(collection: LoadedCollection, ids: string[], deps: ManageCollectionDeps): Promise<string> {
  const { delete: removeItem } = storeFor(collection, { workspaceRoot: deps.workspaceRoot });
  if (!removeItem) {
    return `manageCollection: ${readOnlyRefusal(collection.slug)} (its records are the rows of '${collection.schema.dataSource?.path}'; edit that file to change the data).`;
  }
  const deleted: string[] = [];
  const rejected: RejectedRow[] = [];
  for (const itemId of ids) {
    const outcome = await deleteOneItem(removeItem, itemId);
    if (outcome.deleted) deleted.push(outcome.deleted);
    if (outcome.rejected) rejected.push(outcome.rejected);
  }
  return JSON.stringify({ collection: collection.slug, deleted, rejected });
}

/** A missing id is a rejection, not a silent success: deleting by a typo'd
 *  id would otherwise report "done" while the real record survives. */
async function deleteOneItem(removeItem: NonNullable<CollectionStore["delete"]>, itemId: string): Promise<{ deleted?: string; rejected?: RejectedRow }> {
  const result = await removeItem(itemId);
  if (result.kind === "ok") return { deleted: result.itemId };
  const reject = (problem: string): { rejected: RejectedRow } => ({ rejected: { id: defangForPrompt(itemId), problem: defangForPrompt(problem) } });
  if (result.kind === "invalid-id")
    return reject(`'${itemId}' is not a valid record id (letters/digits at the ends; -, _, or . inside; no '..' or path characters)`);
  if (result.kind === "not-found") return reject(`'${itemId}' not found — nothing was deleted; confirm the id with getItems`);
  return reject("delete refused: the collection's data dir escapes the workspace");
}

function parseDeleteIds(args: Record<string, unknown>): string[] | string {
  const { ids } = args;
  const valid = isStringArray(ids) && ids.length > 0 && ids.every((entry) => entry.trim().length > 0);
  if (!valid) return "manageCollection: `ids` is required for deleteItems — a non-empty array of record ids.";
  return ids;
}

const PUT_MODES: readonly PutMode[] = ["upsert", "create", "merge"];

/** The requested write mode, defaulting when absent, or null when the caller
 *  named a mode that doesn't exist. */
function parsePutMode(mode: unknown): PutMode | null {
  if (mode === undefined) return "upsert";
  return PUT_MODES.find((candidate) => candidate === mode) ?? null;
}

function isRecordArray(value: unknown): value is CollectionItem[] {
  return isUnknownArray(value) && value.every(isRecord);
}

function parsePutItems(args: Record<string, unknown>, slug: string): PutItemsArgs | string {
  const { items, mode } = args;
  if (!isRecordArray(items) || items.length === 0) return "manageCollection: `items` is required for putItems — a non-empty array of record objects.";
  const putMode = parsePutMode(mode);
  if (putMode === null) return 'manageCollection: `mode` must be "upsert" (default), "create", or "merge".';
  return { slug, items, mode: putMode };
}

/** The machine-readable workspace ontology: every collection with its
 *  identity, record count, and outbound `ref`/`embed` relations. Slugs
 *  are discovery-sanitized; titles/labels are workspace-authored schema
 *  text and ride verbatim — the same trust class as the record values
 *  getItems returns. */
async function handleGetOntology(deps: ManageCollectionDeps): Promise<string> {
  const collections = await buildWorkspaceOntology(deps);
  return JSON.stringify({ count: collections.length, collections });
}

/** Publish this repository's `app.json` + shared schemas to its Firestore app.
 *
 *  Named as a whole-app action because it IS one: publish takes the repository
 *  as its unit (one roster, one public config, every shared collection), so it
 *  carries no `slug` and refusing one is not a limitation to work around.
 *
 *  The reply is prose rather than a status code on purpose. This is the one
 *  operation in the collection surface that changes what every member sees the
 *  moment it lands, and the two things the caller has to relay — what will
 *  break, and that `confirm` is how it proceeds anyway — are sentences, not
 *  fields. */
async function handlePublishApp(deps: ManageCollectionDeps, confirm: boolean): Promise<string> {
  const result = await publishApp({ ...deps, confirm });
  if (!result.ok) {
    const bullets = result.problems.map((problem) => `- ${problem}`).join("\n");
    // "nothing was written" is true of nearly every failure, and it is most of
    // what a refusal is worth saying. It is NOT true of a write that failed
    // part-way, and printing it there would tell the caller the app is
    // untouched while its roster is already live — the one case where being
    // wrong sends someone to look at the wrong thing.
    const headline = result.partial ? "publish FAILED PART-WAY — some documents are already live:" : "publish refused — nothing was written:";
    return `${headline}\n${bullets}`;
  }
  const dirtyNote = result.dirty ? " (WORKING TREE DIRTY — the commit does not describe what was published)" : "";
  const stamp = result.commit ? `commit ${result.commit.slice(0, 12)}${dirtyNote}` : "no commit (not a git repository, or no HEAD)";
  // "at least" when the scan hit its per-collection cap. The refusal path
  // already says so, and the confirmed path is the one where saying otherwise
  // costs something: the records are published over, and an understated count
  // is an understated repair.
  const brokenCount = result.recordIssuesCapped ? `at least ${result.recordIssues}` : `${result.recordIssues}`;
  const forced =
    result.recordIssues > 0 ? ` Published over ${brokenCount} record(s) that do not satisfy the new schema — repair them now; members are reading them.` : "";
  return (
    `${result.created ? "Created" : "Updated"} app '${result.aid}' and published ${result.cids.length} collection(s): ${result.cids.join(", ")}. ` +
    `Signed ${stamp}. The previous app document is kept in \`previousPublished\` for rollback.${forced}`
  );
}

/** Return the collection-authoring reference (`collection-skills.md`),
 *  rendered by `renderSchemaDocs` — the full doc overflows the agent's
 *  per-result limit, so the default reply is the core guide + a table of
 *  contents, and `topic` fetches individual sections. Workspace copy
 *  first (reflects user edits), bundled asset as the always-present
 *  fallback. Both reads guarded; if neither resolves the agent still
 *  gets an actionable message instead of a thrown call. */
async function handleSchemaDocs(deps: ManageCollectionDeps, topic?: string): Promise<string> {
  // The slug is irrelevant to the doc variant — only the root's layout is — so
  // any placeholder resolves the same branch `getSchema` / `putSchema` take.
  const { variant } = authoringTarget(deps, SCHEMA_DOCS_PROBE_SLUG);
  const candidates = [
    path.join(resolveBase(deps), HELPS_DIR, SCHEMA_DOCS_FILE),
    ...(deps.bundledHelpsDir ? [path.join(deps.bundledHelpsDir(), SCHEMA_DOCS_FILE)] : []),
  ];
  for (const candidate of candidates) {
    try {
      return renderSchemaDocs(await readFile(candidate, "utf-8"), topic, variant);
    } catch {
      // try the next source
    }
  }
  return `manageCollection: could not read the collection-authoring reference (${SCHEMA_DOCS_FILE}).`;
}

/** Return the raw schema.json of an existing collection, for editing.
 *  Staging (the canonical writable copy) first, the active mirror as a
 *  fallback for user-scope skills that have no staging copy. Raw text —
 *  not the parsed schema — so the agent edits the true on-disk source. */
async function handleGetSchema(slug: string, deps: ManageCollectionDeps): Promise<string> {
  const collection = await loadCollection(slug, deps);
  if (!collection) return unknownCollection(slug);
  // Path from the discovered (sanitized) slug, never the raw arg.
  const { stagingDir } = authoringTarget(deps, collection.slug);
  // A subscribed collection contributes no candidate: its schema is a document
  // in ANOTHER app, published from a repository this machine may not even have
  // a clone of. Reading it out of `publishedSchema` and handing it back would
  // invite an edit that `putSchema` then has nowhere to write.
  const candidates = [stagingDir, collection.skillDir].filter((base): base is string => base !== null).map((base) => path.join(base, SCHEMA_FILE));
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf-8");
    } catch {
      // fall through to the next location
    }
  }
  return `manageCollection: '${defangForPrompt(slug)}' has no readable ${SCHEMA_FILE}.`;
}

/** Where the agent should CREATE a collection skill in this root, named in the
 *  messages that tell it to. Naming `data/skills/` under a root that has no
 *  staging tree sends the agent to a directory nothing reads — the exact
 *  silent failure the root-aware authoring guide exists to prevent, reappearing
 *  in an error string the agent is far more likely to act on immediately. */
function authoringDirLabel(deps: ManageCollectionDeps, slug: string): string {
  return authoringTarget(deps, slug).variant === "staged" ? `data/skills/${slug}/` : `.claude/skills/${slug}/`;
}

/** Refuse a schema edit the host can't honour: user-scope/feed collections
 *  are read-only, and presets (mc-*) re-seed on restart so an edit is lost. */
function schemaEditRefusal(collection: LoadedCollection, slug: string, deps: ManageCollectionDeps): string | null {
  if (collection.source !== "project") {
    return `manageCollection: '${defangForPrompt(slug)}' is ${collection.source}-scope and read-only here — only project collections (${authoringDirLabel(deps, "<slug>")}) can be edited.`;
  }
  if (isPresetSlug(slug)) {
    return `manageCollection: '${defangForPrompt(slug)}' is a preset (mc-*) and re-seeds on restart — copy it under a different slug to customise.`;
  }
  return null;
}

/** Turn a CollectionSchemaZ failure into a short, actionable list the
 *  agent can fix, pointing back at the field reference. */
function formatSchemaIssues(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  const shown = issues.slice(0, MAX_SCHEMA_ISSUES);
  const lines = shown.map((issue) => `- ${issue.path.map(String).join(".") || "(root)"}: ${defangForPrompt(issue.message)}`).join("\n");
  const omitted = issues.length - shown.length;
  const more = omitted > 0 ? `\n- …and ${omitted} more issue(s); fix these first and retry.` : "";
  return `manageCollection: schema rejected — fix and retry (call schemaDocs for the field reference):\n${lines}${more}`;
}

/** Write the validated schema to the canonical staging copy, then mirror
 *  it into the active `.claude/skills/` tree discovery reads — an internal
 *  write doesn't fire the skill-bridge hook, so we mirror explicitly.
 *
 *  A root with NO staging tree has no bridge to mirror through either, so the
 *  active skill dir IS the canonical copy and is written directly. Mirroring
 *  there would read a staging file that never exists. */
async function writeAndMirrorSchema(slug: string, skillDir: string, schema: unknown, deps: ManageCollectionDeps): Promise<void> {
  const base = resolveBase(deps);
  const serialized = `${JSON.stringify(schema, null, 2)}\n`;
  const { stagingDir } = authoringTarget(deps, slug);
  if (stagingDir === null) {
    await writeFileAtomic(path.join(skillDir, SCHEMA_FILE), serialized);
  } else {
    await writeFileAtomic(path.join(stagingDir, SCHEMA_FILE), serialized);
    mirrorSkillWrite(base, { slug, relSegments: [SCHEMA_FILE] });
  }
  try {
    await deps.refreshAfterWrite?.();
  } catch {
    // best-effort — see ManageCollectionDeps.refreshAfterWrite
  }
}

/** The post-Zod acceptance gates discovery applies before a parsed schema
 *  becomes a live collection. Mirrors discovery's checks (`loadOneCollection`)
 *  so a write can't pass here yet be silently skipped on the next load.
 *  putSchema only runs for project-scope collections, so the feed-`ingest`
 *  gate doesn't apply. Returns a one-line reason, or null when the schema
 *  would be accepted. */
function schemaDiscoveryGate(schema: CollectionSchema, base: string): string | null {
  const primaryField = resolvePrimaryField(schema.fields, schema.primaryKey);
  if (!primaryField) return `primaryKey '${schema.primaryKey}' is not one of the declared fields`;
  if (primaryField.primary !== true) return `the primaryKey field '${schema.primaryKey}' must be flagged \`primary: true\``;
  if (schema.dataPath !== undefined && resolveDataDir(schema.dataPath, base) === null) return `dataPath '${schema.dataPath}' escapes the workspace`;
  if (schema.dataSource !== undefined && resolveDataDir(schema.dataSource.path, base) === null) {
    return `dataSource.path '${schema.dataSource.path}' escapes the workspace`;
  }
  return null;
}

/** Validate a schema against CollectionSchemaZ and, on success, persist it.
 *  Edit-only: a new collection is created by writing SKILL.md + schema.json in
 *  the root's authoring dir (the normal create flow), not through here. */
async function handlePutSchema(slug: string, schemaArg: unknown, deps: ManageCollectionDeps): Promise<string> {
  if (!schemaArg || typeof schemaArg !== "object" || Array.isArray(schemaArg)) {
    return "manageCollection: `schema` is required for putSchema — the full collection schema object.";
  }
  const collection = await loadCollection(slug, deps);
  if (!collection) {
    return `manageCollection: unknown collection '${defangForPrompt(slug)}' — create it by writing SKILL.md + ${SCHEMA_FILE} under ${authoringDirLabel(deps, defangForPrompt(slug))}, then edit it here.`;
  }
  const refusal = schemaEditRefusal(collection, slug, deps);
  if (refusal) return refusal;
  const parsed = CollectionSchemaZ.safeParse(schemaArg);
  if (!parsed.success) return formatSchemaIssues(parsed.error.issues);
  // Run the SAME post-Zod gates discovery applies, so a write can't pass
  // here yet be silently skipped on the next load (hiding the collection).
  const gate = schemaDiscoveryGate(parsed.data, resolveBase(deps));
  if (gate) {
    return `manageCollection: schema rejected — ${gate} (call schemaDocs for the field reference). It passes basic validation but discovery would skip it, hiding the collection.`;
  }
  // A subscribed collection has nowhere here to write: its schema belongs to
  // another app's repository, and publish is what changes it. Refusing by name
  // beats writing a file discovery would then ignore — the author would edit,
  // see "written: true", and watch nothing change.
  if (collection.skillDir === null) {
    return `manageCollection: '${defangForPrompt(slug)}' is subscribed from another app — its schema is published by that app's repository and cannot be edited here.`;
  }
  // Path from the discovered (sanitized) slug, never the raw arg.
  await writeAndMirrorSchema(collection.slug, collection.skillDir, parsed.data, deps);
  return JSON.stringify({ collection: collection.slug, written: true });
}

const MANAGE_COLLECTION_PROMPT =
  "Use `manageCollection` instead of raw Read/Write/Edit when working with a collection's records OR its schema (raw file I/O stays available as the escape hatch). " +
  "Before authoring or changing a collection's `schema.json`, call `schemaDocs` to load the field/DSL reference — the default reply is the core authoring guide plus a table of contents; fetch advanced sections (actions, bells, calendar/kanban views, dataSource, storage) by passing their heading as `topic` rather than dumping `topic: \"all\"`. Then read with `getSchema` and write with `putSchema` — `putSchema` validates the whole schema before writing and returns actionable errors instead of silently failing discovery's validation. " +
  "`getItems` is the only way to see computed values — `derived` fields (e.g. a portfolio's value), `toggle` projections, and `embed` records are host-computed and never present in the stored JSON files. On large collections pass `ids` and/or `fields` to keep the result small. " +
  'For a question that spans collections ("which clients have unpaid invoices?"), start with `getOntology`: it lists every collection with its primaryKey, record count, and outbound `ref`/`embed` relations, so you know which collections to join before reading any records. ' +
  "`putItems` validates every row against the schema before writing (required fields, enum values, primaryKey = record id) and returns `{ written, rejected }`; fix each rejected row using its `problem` text and retry just those rows. Never include computed fields in a row you write. " +
  'To update a few fields of an existing record, use `mode: "merge"` with a partial row ({ id, <changed fields> }) — the default upsert replaces the WHOLE record, so a partial upsert would silently erase every optional field it omits. ' +
  "`deleteItems` removes records by id and returns `{ deleted, rejected }`; an id that doesn't exist comes back rejected rather than counted as deleted, so check `rejected` before reporting a deletion as done. " +
  "`publishApp` publishes the whole repository — its `app.json` (member roster, public read/submit configuration) and every shared collection's schema — to the app's Firestore. It is the ONE operation here that changes what every member sees the moment it runs, and it cannot be undone by reverting a commit: publishing again is the only undo (the previous app document is kept as `previousPublished`). Call it when the user asks to publish, invite, or open an app; never as a follow-up to an edit the user did not ask you to ship. Its refusals are the product, not an obstacle — relay them verbatim, and do not work around one by rewriting `app.json` until the user has said what they actually want. If it reports live records the new schemas would break, show the user that list and ask before re-running with `confirm`. " +
  "Answer aggregation questions (counts, sums, averages, group-bys) with `queryItems` on ANY collection — on a dataSource (CSV) collection it scans the whole file (getItems is row-capped, so aggregates computed from its output can be silently wrong on large files); on a file-backed collection it aggregates the enriched records, so computed fields (derived/rollup/toggle) are queryable columns.";

/** Validate getItems' optional `ids`/`fields` args, then delegate. */
async function dispatchGetItems(collection: LoadedCollection, args: Record<string, unknown>, deps: ManageCollectionDeps): Promise<string> {
  const ids = optionalStringArray(args.ids, "ids");
  if (!ids.ok) return ids.error;
  const fields = optionalStringArray(args.fields, "fields");
  if (!fields.ok) return fields.error;
  return handleGetItems(collection, { slug: collection.slug, ids: ids.value, fields: fields.value }, deps);
}

/** Actions that operate on a collection's RECORDS — i.e. the ones that
 *  need the collection loaded first. Schema/workspace actions don't. */
const RECORD_ACTIONS = new Set(["getItems", "putItems", "deleteItems", "queryItems"]);

/** Record-action dispatch, split from `manageCollectionHandler` to keep
 *  both within the cognitive-complexity budget. */
async function dispatchRecordAction(action: string, collection: LoadedCollection, args: Record<string, unknown>, deps: ManageCollectionDeps): Promise<string> {
  if (action === "getItems") return dispatchGetItems(collection, args, deps);
  if (action === "queryItems") return handleQueryItems(collection, args.query, deps);
  if (action === "deleteItems") {
    const ids = parseDeleteIds(args);
    return typeof ids === "string" ? ids : handleDeleteItems(collection, ids, deps);
  }
  const parsed = parsePutItems(args, collection.slug);
  return typeof parsed === "string" ? parsed : handlePutItems(collection, parsed, deps);
}

// The tool's action dispatch. Extracted from the factory's returned object so
// `makeManageCollectionTool` stays under the max-lines threshold; each branch
// already delegates to a handler.
async function manageCollectionHandler(deps: ManageCollectionDeps, args: Record<string, unknown>): Promise<string> {
  try {
    return await dispatchManageCollection(deps, args);
  } catch (err) {
    // An unreachable backend is an ANSWER, not a crash: the tool's contract is
    // actionable text, and the message already says what to do about it.
    // Letting it throw would surface as a tool failure with no guidance.
    if (isBackendUnavailable(err)) return `manageCollection: ${err.message}`;
    throw err;
  }
}

async function dispatchManageCollection(deps: ManageCollectionDeps, args: Record<string, unknown>): Promise<string> {
  const action = typeof args.action === "string" ? args.action : "";
  if (action === "schemaDocs") return handleSchemaDocs(deps, typeof args.topic === "string" ? args.topic : undefined);
  if (action === "getOntology") return handleGetOntology(deps);
  if (action === "publishApp") return handlePublishApp(deps, args.confirm === true);
  const slug = typeof args.slug === "string" ? args.slug.trim() : "";
  if (!slug) return "manageCollection: `slug` is required (the collection's slug).";
  if (action === "getSchema") return handleGetSchema(slug, deps);
  if (action === "putSchema") return handlePutSchema(slug, args.schema, deps);
  if (!RECORD_ACTIONS.has(action)) {
    return 'manageCollection: `action` must be "getItems", "putItems", "deleteItems", "queryItems", "getOntology", "schemaDocs", "getSchema", "putSchema", or "publishApp".';
  }
  const collection = await loadCollection(slug, deps);
  if (!collection) return unknownCollection(slug);
  return dispatchRecordAction(action, collection, args, deps);
}

// Static tool definition, hoisted out of the factory so the function body
// stays within the line budget (the schema only ever grows).
const MANAGE_COLLECTION_DEFINITION = {
  name: "manageCollection",
  description:
    "Read and write a schema-driven collection through the host — both its records and its structure. getItems returns records WITH computed values (derived formulas, toggles, embeds) the stored JSON files don't contain; putItems validates each row against the schema before writing; deleteItems removes records by id. getOntology maps the whole workspace: every collection with its record count and outbound ref/embed relations — call it first for cross-collection questions. schemaDocs returns the collection-authoring reference — the core guide plus a table of contents by default; pass `topic` for a specific section. getSchema/putSchema read and validate-then-write the collection's schema.json. publishApp publishes the repository's app.json + shared schemas to Firestore, where every member sees them immediately -- it refuses declarations that would be silently permissive or silently deny everyone, and refuses to publish over records the new schemas would break unless `confirm` is set. Prefer it over raw file I/O on collections.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["getItems", "putItems", "deleteItems", "queryItems", "getOntology", "schemaDocs", "getSchema", "putSchema", "publishApp"],
        description: "What to do.",
      },
      slug: {
        type: "string",
        description: "The collection's slug (its directory name, e.g. `stock-quotes`). Required for everything except schemaDocs and getOntology.",
      },
      ids: {
        type: "array",
        items: { type: "string" },
        description:
          "getItems: only these record ids (primary-key values); omit for all records. deleteItems: the record ids to delete — required, and never optional there.",
      },
      fields: {
        type: "array",
        items: { type: "string" },
        description: "getItems: only these fields per record (the primary key is always included). Omit for all fields. Use on large collections.",
      },
      items: {
        type: "array",
        items: { type: "object" },
        description: "putItems: the record objects to store. Each must carry the schema's primaryKey value (it doubles as the filename).",
      },
      mode: {
        type: "string",
        enum: ["upsert", "create", "merge"],
        description:
          'putItems: "upsert" (default) replaces existing records WHOLE; "create" rejects rows whose id already exists; "merge" updates only the fields a row carries, keeping the rest of the existing record (rejects unknown ids). Use "merge" when changing a few fields.',
      },
      schema: {
        type: "object",
        description:
          "putSchema: the full collection schema object (same shape as schema.json — title, icon, dataPath, primaryKey, fields, …). Call getSchema first for the current one, and schemaDocs for the field DSL.",
      },
      confirm: {
        type: "boolean",
        description:
          "publishApp: publish even though existing records fail the schemas being published. Omit it first — the refusal lists what would break, and that list is the thing to show the user before asking.",
      },
      topic: {
        type: "string",
        description:
          'schemaDocs: fetch one section of the reference by heading (case-insensitive substring — e.g. "field types", "kanban", "calendar", "dataSource"). Omit for the core authoring guide plus a table of contents of every section; "all" returns the full document (large — it can exceed your tool-result limit).',
      },
      query: {
        type: "object",
        description:
          'queryItems: a structured aggregation query — `{ groupBy?: ["col"], aggregates?: { alias: { op: "count"|"sum"|"avg"|"min"|"max", column? } }, where?: [{ field, op, value }], orderBy?: [{ field, dir? }], limit? }`. At least one of groupBy/aggregates. On a dataSource (CSV) collection it scans the WHOLE file uncapped (unlike getItems); on a file-backed collection it aggregates the ENRICHED records, so computed fields (derived/rollup/toggle) are queryable columns. Use it for counts / sums / averages / group-bys instead of arithmetic over getItems output.',
      },
    },
    required: ["action"],
  },
};

export function makeManageCollectionTool(deps: ManageCollectionDeps = {}) {
  return {
    definition: MANAGE_COLLECTION_DEFINITION,

    // Collections are workspace data every role can already reach via
    // raw Read/Write/Edit — gating the SAFER path per-role would only
    // push unlisted roles back onto unvalidated file I/O.
    alwaysActive: true,

    prompt: MANAGE_COLLECTION_PROMPT,

    handler: (args: Record<string, unknown>): Promise<string> => manageCollectionHandler(deps, args),
  };
}
