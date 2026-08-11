// Discover schema-driven collections. A "collection" is a skill
// directory that ships a `schema.json` alongside its `SKILL.md`.
// Scans both user (`~/.claude/skills/`) and project
// (`<workspace>/.claude/skills/`) scopes; project wins on slug
// collision (mirrors the rule in
// `server/workspace/skills/discovery.ts`). A host may declare a root to
// have NO user scope (`paths.userSkillsDir` → null), and then there is no
// shadowing to reason about: that root sees its own collections and feeds,
// and nothing else.
//
// The schema validator itself lives in `../core/schemaZ` (the zod single
// source of truth every `../core/schema` type derives from); this module
// applies it, plus the post-Zod acceptance gates below.

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { log, getWorkspaceRoot, userSkillsDir, projectSkillsDir, feedsRoot } from "./host";
import { CollectionSchemaZ } from "../core/schemaZ";
import { SCHEMA_FILE, resolveDataDir, safeSlugName } from "./paths";
import { appManifestReason, loadAppManifest } from "./appManifest";
import { subscribedCollections } from "./subscribedCollections";
import type { LoadedCollection } from "./discoveredCollection";
import type { CollectionDetail, CollectionSchema, CollectionSource, CollectionSummary } from "../core/schema";
import { isErrorWithCode, isRecord } from "@mulmoclaude/common";

// Re-exported for the existing `collection/server` importers (manageCollection's
// putSchema, the registry importWriter) that validate schemas the same way
// discovery does.
export { CollectionSchemaZ };

// The LoadedCollection shape now lives in @mulmoclaude/core/collection/server
// (imported at the top, re-exported below) so discovery stays its producer and
// the many `from "./discovery.js"` importers resolve it unchanged.

// Normalize an agent-authored feed schema (no register tool to do it):
// default `icon`, and **force** `dataPath` to the feed-owned namespace
// `data/feeds/<slug>`. Forcing dataPath (rather than trusting the file) is
// a safety boundary — a feed can only ever read/write/delete records under
// its own folder, never another app's data (e.g. `data/wiki`). Non-object
// input passes through so the Zod error stays clear.
function applyFeedSchemaDefaults(parsed: unknown, slug: string): unknown {
  if (!isRecord(parsed)) return parsed;
  const icon = typeof parsed.icon === "string" && parsed.icon.trim().length > 0 ? parsed.icon : "dynamic_feed";
  return { ...parsed, icon, dataPath: `data/feeds/${slug}` };
}

/** Result of the post-Zod acceptance gates: the resolved record dir (and,
 *  for a `dataSource` schema, the resolved data file) on success, or a
 *  one-line reason discovery would skip the schema. */
export type SchemaAcceptance = { ok: true; dataDir: string; dataSourceFile?: string; storageFile?: string; appId?: string } | { ok: false; reason: string };

/** The conventional per-slug records dir a `dataSource` / `storage` collection
 *  gets as its `dataDir` (records never live there, but archive/delete paths
 *  stay well-defined — same shape the registry's R3 normalization uses).
 *
 *  INVARIANT — this is NOT a default `dataPath`, and must not be used as one.
 *  It applies only to the two backends whose records are not per-file JSON. A
 *  normal collection declares its own location and exactly one of `dataPath` /
 *  `dataSource` / `storage`; a schema with none of the three is REJECTED, not
 *  quietly pointed here. Handing a per-file collection this path would silently
 *  relocate its records away from the folder the user (and its SKILL.md) sees. */
export function conventionalDataPath(slug: string): string {
  return `data/collections/${slug}/items`;
}

/** The declared field named by `primaryKey`, or `undefined` when the schema
 *  declares no such field. Own-property guarded: a `primaryKey` of `toString`
 *  / `constructor` / `__proto__` must miss here, not read an Object.prototype
 *  member and slip past the "is it a declared field?" gate into the wrong
 *  "add `primary: true`" advice. Shared with manageCollection's putSchema
 *  gate so both report the SAME reason. */
export function resolvePrimaryField(fields: CollectionSchema["fields"], primaryKey: string): CollectionSchema["fields"][string] | undefined {
  return Object.hasOwn(fields, primaryKey) ? fields[primaryKey] : undefined;
}

/** The acceptance gates discovery applies AFTER `CollectionSchemaZ` parses,
 *  before a schema becomes a live collection:
 *
 *  - the `primaryKey` must be a declared field flagged `primary: true` —
 *    without the flag CollectionView renders the field editable, and a
 *    rename is silently pinned back to the URL itemId on save, so the user's
 *    edit is dropped with no error;
 *  - a `feed` schema must declare an `ingest` block (else it's a dead,
 *    non-refreshable card);
 *  - `dataPath` — or a `dataSource`'s `path` — must resolve INSIDE the
 *    workspace (same realpath containment for both).
 *
 *  Exported so `manageCollection`'s `putSchema` can run the SAME gates before
 *  it reports success — a schema that passes `CollectionSchemaZ` but fails one
 *  of these would otherwise write cleanly yet be skipped on the next discovery,
 *  hiding the collection (the exact failure that tool exists to prevent). */
export function acceptParsedSchema(schema: CollectionSchema, opts: { source: CollectionSource; workspaceRoot: string; slug: string }): SchemaAcceptance {
  const primaryField = resolvePrimaryField(schema.fields, schema.primaryKey);
  if (!primaryField) return { ok: false, reason: `primaryKey '${schema.primaryKey}' is not one of the declared fields` };
  if (primaryField.primary !== true) return { ok: false, reason: `the primaryKey field '${schema.primaryKey}' must be flagged \`primary: true\`` };
  if (opts.source === "feed" && !schema.ingest) return { ok: false, reason: "a feed schema must declare an `ingest` block" };
  if (schema.dataSource !== undefined) {
    // Same containment math as dataPath — resolveDataDir doesn't require
    // the target to exist, so it validates a file path just as well.
    const dataSourceFile = resolveDataDir(schema.dataSource.path, opts.workspaceRoot);
    if (dataSourceFile === null) return { ok: false, reason: `dataSource.path '${schema.dataSource.path}' escapes the workspace` };
    const dataDir = resolveDataDir(conventionalDataPath(opts.slug), opts.workspaceRoot);
    if (dataDir === null) return { ok: false, reason: `slug '${opts.slug}' yields no workspace-contained data dir` };
    return { ok: true, dataDir, dataSourceFile };
  }
  if (schema.storage !== undefined) return acceptStorageSchema(schema.storage, opts);
  const dataDir = resolveDataDir(schema.dataPath ?? "", opts.workspaceRoot);
  if (dataDir === null) return { ok: false, reason: `dataPath '${schema.dataPath}' escapes the workspace` };
  return { ok: true, dataDir };
}

/** The `storage` arm of the acceptance gate. Every storage backend gets the
 *  conventional phantom dataDir; what differs is what else has to resolve
 *  before the collection can exist at all.
 *
 *  A FILE-backed backend (sqlite) resolves and containment-checks a
 *  `storageFile`. A SHARED one (firestore) has no path on this machine — it
 *  resolves an IDENTITY instead: the `aid` from the repository's `app.json`,
 *  which together with the slug as `cid` names `apps/{aid}/collections/{cid}`.
 *
 *  Resolving it HERE, once, is the point. The store then receives a settled
 *  `(aid, cid)` and never reads `app.json` itself — otherwise the questions of
 *  caching, staleness and what to do when the file is missing would be decided
 *  inside a read path, where the only cheap answer is to return nothing, and
 *  "this collection is misconfigured" would reach the user as "this collection
 *  is empty". A missing or malformed `app.json` is a CONFIGURATION error, so it
 *  is reported the same way an escaping `storage.path` is: the schema is
 *  refused, with a reason naming the file to create. */
function acceptStorageSchema(storage: NonNullable<CollectionSchema["storage"]>, opts: { workspaceRoot: string; slug: string }): SchemaAcceptance {
  const dataDir = resolveDataDir(conventionalDataPath(opts.slug), opts.workspaceRoot);
  if (dataDir === null) return { ok: false, reason: `slug '${opts.slug}' yields no workspace-contained data dir` };
  if (storage.type === "sqlite") {
    const storageFile = resolveDataDir(storage.path, opts.workspaceRoot);
    if (storageFile === null) return { ok: false, reason: `storage.path '${storage.path}' escapes the workspace` };
    return { ok: true, dataDir, storageFile };
  }
  const manifest = loadAppManifest(opts.workspaceRoot);
  if (!manifest.ok) return { ok: false, reason: appManifestReason(manifest, opts.workspaceRoot) };
  return { ok: true, dataDir, appId: manifest.manifest.aid };
}

async function loadOneCollection(skillsRoot: string, slug: string, source: CollectionSource, workspaceRoot: string): Promise<LoadedCollection | null> {
  const safeName = safeSlugName(slug);
  if (safeName === null) return null;
  const schemaPath = path.join(skillsRoot, safeName, SCHEMA_FILE);
  let raw: string;
  try {
    const fileStat = await stat(schemaPath);
    if (!fileStat.isFile()) return null;
    raw = await readFile(schemaPath, "utf-8");
  } catch (err) {
    if (!isErrorWithCode(err) || err.code !== "ENOENT") {
      log.warn("collections", "failed to read schema.json, skipping", { slug: safeName, path: schemaPath, error: String(err) });
    }
    return null;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    log.warn("collections", "schema.json is not valid JSON, skipping", { slug: safeName, error: String(err) });
    return null;
  }

  // Feeds are authored by the agent as plain files (no register tool), so
  // fill the boilerplate icon / dataPath if omitted before validation.
  const candidate = source === "feed" ? applyFeedSchemaDefaults(parsedJson, safeName) : parsedJson;
  const parsed = CollectionSchemaZ.safeParse(candidate);
  if (!parsed.success) {
    log.warn("collections", "schema.json failed validation, skipping", { slug: safeName, issues: parsed.error.issues });
    return null;
  }

  // Post-Zod acceptance gates (primaryKey flagged primary, feed ingest,
  // workspace-contained dataPath) — shared with manageCollection's putSchema
  // so a validated write and discovery agree on what's a live collection.
  const schema = parsed.data;
  const acceptance = acceptParsedSchema(schema, { source, workspaceRoot, slug: safeName });
  if (!acceptance.ok) {
    log.warn("collections", "schema.json rejected after validation, skipping", { slug: safeName, reason: acceptance.reason });
    return null;
  }

  return {
    slug: safeName,
    source,
    schema,
    dataDir: acceptance.dataDir,
    ...(acceptance.dataSourceFile !== undefined ? { dataSourceFile: acceptance.dataSourceFile } : {}),
    ...(acceptance.storageFile !== undefined ? { storageFile: acceptance.storageFile } : {}),
    ...(acceptance.appId !== undefined ? { appId: acceptance.appId } : {}),
    skillDir: path.join(skillsRoot, safeName),
  };
}

async function collectFromDir(skillsRoot: string, source: CollectionSource, workspaceRoot: string): Promise<LoadedCollection[]> {
  let entries: string[];
  try {
    entries = await readdir(skillsRoot);
  } catch (err) {
    if (isErrorWithCode(err) && err.code === "ENOENT") return [];
    log.warn("collections", "failed to list skills dir, returning empty", { root: skillsRoot, error: String(err) });
    return [];
  }

  const results: LoadedCollection[] = [];
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const safeName = safeSlugName(name);
    if (safeName === null) continue;
    const dirPath = path.join(skillsRoot, safeName);
    let dirStat;
    try {
      dirStat = await stat(dirPath);
    } catch {
      continue;
    }
    if (!dirStat.isDirectory()) continue;
    const collection = await loadOneCollection(skillsRoot, safeName, source, workspaceRoot);
    if (collection) results.push(collection);
  }
  return results;
}

/** The user-scope dir this call should scan, or `null` for none. The single
 *  place the "explicit override beats the host binding, and either may say
 *  none" rule is spelled — `??` cannot express it, because `undefined` there
 *  means "ask the host" and would silently re-enable a scope the caller
 *  passed `null` to switch off. */
function resolveUserDir(opts: DiscoveryOptions, workspaceRoot: string): string | null {
  return opts.userSkillsDir !== undefined ? opts.userSkillsDir : userSkillsDir(workspaceRoot);
}

export interface DiscoveryOptions {
  /** Override the workspace root for project-scope skill discovery.
   *  Default: the live `workspacePath`. Tests point this at a
   *  `mkdtempSync` tree so they don't touch the user's real
   *  `~/mulmoclaude/`. Mirrors the pattern in
   *  `server/workspace/skills/catalog.ts#CatalogOptions`. */
  workspaceRoot?: string | undefined;
  /** Override `~/.claude/skills/` for tests. Production callers
   *  leave this unset. Without an override, even a test-scoped
   *  workspaceRoot still scans the real user home — which can leak
   *  unrelated skills into the result.
   *
   *  Three distinct values, and the difference matters — a caller that
   *  thinks it opted out and did not is exactly the failure the scope
   *  isolation removes:
   *  - `undefined` (or absent): ask the host binding for this root, which
   *    may itself answer `null`.
   *  - a path: scan that dir as user scope.
   *  - `null`: this call has NO user scope. The host is not consulted. */
  userSkillsDir?: string | null | undefined;
}

/** Discover every schema-driven collection available to this
 *  workspace. Project-scope collections override user-scope on slug
 *  collision. The `workspaceRoot` override also flows into each
 *  collection's dataDir resolution so a tmpdir-scoped test gets
 *  dataDirs under the same tmpdir (Codex P1 review on PR #1489 —
 *  previously dataDir was always rooted at the live workspacePath
 *  regardless of override). */
export async function discoverCollections(opts: DiscoveryOptions = {}): Promise<LoadedCollection[]> {
  const workspaceRoot = opts.workspaceRoot ?? getWorkspaceRoot();
  const userDir = resolveUserDir(opts, workspaceRoot);
  const projectDir = projectSkillsDir(workspaceRoot);
  // Feeds (the non-skill `<workspace>/feeds/` registry) are scanned as a
  // third root. They merge FIRST so a real skill collection (user or
  // project) always overrides a feed on slug collision — a feed must
  // never shadow a genuine skill-backed collection.
  const feedCollections = await collectFromDir(feedsRoot(workspaceRoot), "feed", workspaceRoot);
  // The second source: apps whose roster carries this address. Merged FIRST,
  // so anything on this disk wins a slug collision — a repository's own copy
  // of a collection is the one its author is editing, and silently serving the
  // published projection instead would make local edits look ineffective.
  const subscribed = await subscribedCollections(workspaceRoot);
  // A root with no user scope skips the pass entirely (not an empty dir scan)
  // — see the `userSkillsDir` contract in `host.ts`.
  const userCollections = userDir === null ? [] : await collectFromDir(userDir, "user", workspaceRoot);
  const projectCollections = await collectFromDir(projectDir, "project", workspaceRoot);
  const merged = new Map<string, LoadedCollection>();
  for (const entry of subscribed) merged.set(entry.slug, entry);
  for (const entry of feedCollections) merged.set(entry.slug, entry);
  for (const entry of userCollections) merged.set(entry.slug, entry);
  for (const entry of projectCollections) merged.set(entry.slug, entry);
  return [...merged.values()].sort((left, right) => left.slug.localeCompare(right.slug));
}

/** Load one collection by slug. Returns null if the slug is invalid,
 *  no matching skill exists, or the schema is malformed. */
export async function loadCollection(slug: string, opts: DiscoveryOptions = {}): Promise<LoadedCollection | null> {
  const safeName = safeSlugName(slug);
  if (safeName === null) return null;
  const workspaceRoot = opts.workspaceRoot ?? getWorkspaceRoot();
  const userDir = resolveUserDir(opts, workspaceRoot);
  const projectDir = projectSkillsDir(workspaceRoot);
  // Project first (overrides user), then user, then the feeds registry
  // last — mirroring the merge precedence in `discoverCollections` so a
  // skill collection always wins over a feed of the same slug.
  const projectCollection = await loadOneCollection(projectDir, safeName, "project", workspaceRoot);
  if (projectCollection) return projectCollection;
  // No user scope for this root: skip the fallback, so a slug that exists
  // ONLY in user scope is a MISS rather than a quiet hop into another world.
  const userCollection = userDir === null ? null : await loadOneCollection(userDir, safeName, "user", workspaceRoot);
  if (userCollection) return userCollection;
  const feedCollection = await loadOneCollection(feedsRoot(workspaceRoot), safeName, "feed", workspaceRoot);
  if (feedCollection) return feedCollection;
  // Last, and only by slug: a subscribed collection is not on this disk, so a
  // name that resolves nowhere locally may still be an app you belong to.
  // Same precedence as the union above — disk first, always.
  const subscribed = await subscribedCollections(workspaceRoot);
  return subscribed.find((entry: LoadedCollection) => entry.slug === safeName) ?? null;
}

export function toSummary(collection: LoadedCollection): CollectionSummary {
  return {
    slug: collection.slug,
    title: collection.schema.title,
    icon: collection.schema.icon,
    source: collection.source,
    ...(collection.schema.dataSource !== undefined ? { readonly: true as const } : {}),
    ...(collection.appId !== undefined ? { appId: collection.appId } : {}),
  };
}

export function toDetail(collection: LoadedCollection): CollectionDetail {
  return { ...toSummary(collection), schema: collection.schema };
}
