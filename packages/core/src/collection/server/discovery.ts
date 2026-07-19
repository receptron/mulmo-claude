// Discover schema-driven collections. A "collection" is a skill
// directory that ships a `schema.json` alongside its `SKILL.md`.
// Scans both user (`~/.claude/skills/`) and project
// (`<workspace>/.claude/skills/`) scopes; project wins on slug
// collision (mirrors the rule in
// `server/workspace/skills/discovery.ts`).
//
// The schema validator itself lives in `../core/schemaZ` (the zod single
// source of truth every `../core/schema` type derives from); this module
// applies it, plus the post-Zod acceptance gates below.

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { log, getWorkspaceRoot, userSkillsDir, projectSkillsDir, feedsRoot } from "./host";
import { CollectionSchemaZ } from "../core/schemaZ";
import { SCHEMA_FILE, resolveDataDir, safeSlugName } from "./paths";
import type { LoadedCollection } from "./discoveredCollection";
import type { CollectionDetail, CollectionSchema, CollectionSource, CollectionSummary } from "../core/schema";

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
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parsed;
  const obj = parsed as Record<string, unknown>;
  const icon = typeof obj.icon === "string" && obj.icon.trim().length > 0 ? obj.icon : "dynamic_feed";
  return { ...obj, icon, dataPath: `data/feeds/${slug}` };
}

/** Result of the post-Zod acceptance gates: the resolved record dir (and,
 *  for a `dataSource` schema, the resolved data file) on success, or a
 *  one-line reason discovery would skip the schema. */
export type SchemaAcceptance = { ok: true; dataDir: string; dataSourceFile?: string; storageFile?: string } | { ok: false; reason: string };

/** The conventional per-slug records dir a `dataSource` collection gets as
 *  its `dataDir` (records never live there, but archive/delete paths stay
 *  well-defined — same shape the registry's R3 normalization uses). */
function conventionalDataPath(slug: string): string {
  return `data/collections/${slug}/items`;
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
  const primaryField = schema.fields[schema.primaryKey];
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
 *  conventional phantom dataDir; only a FILE-backed one also resolves (and
 *  containment-checks) a `storageFile`. Firestore records aren't on disk at
 *  all — its documents live under a host-derived `users/{uid}/` location, so
 *  there is no path here to check. */
function acceptStorageSchema(storage: NonNullable<CollectionSchema["storage"]>, opts: { workspaceRoot: string; slug: string }): SchemaAcceptance {
  const dataDir = resolveDataDir(conventionalDataPath(opts.slug), opts.workspaceRoot);
  if (dataDir === null) return { ok: false, reason: `slug '${opts.slug}' yields no workspace-contained data dir` };
  if (storage.type !== "sqlite") return { ok: true, dataDir };
  const storageFile = resolveDataDir(storage.path, opts.workspaceRoot);
  if (storageFile === null) return { ok: false, reason: `storage.path '${storage.path}' escapes the workspace` };
  return { ok: true, dataDir, storageFile };
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
    const error = err as { code?: string };
    if (error.code !== "ENOENT") {
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
    skillDir: path.join(skillsRoot, safeName),
  };
}

async function collectFromDir(skillsRoot: string, source: CollectionSource, workspaceRoot: string): Promise<LoadedCollection[]> {
  let entries: string[];
  try {
    entries = await readdir(skillsRoot);
  } catch (err) {
    const error = err as { code?: string };
    if (error.code === "ENOENT") return [];
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

export interface DiscoveryOptions {
  /** Override the workspace root for project-scope skill discovery.
   *  Default: the live `workspacePath`. Tests point this at a
   *  `mkdtempSync` tree so they don't touch the user's real
   *  `~/mulmoclaude/`. Mirrors the pattern in
   *  `server/workspace/skills/catalog.ts#CatalogOptions`. */
  workspaceRoot?: string;
  /** Override `~/.claude/skills/` for tests. Production callers
   *  leave this unset. Without an override, even a test-scoped
   *  workspaceRoot still scans the real user home — which can leak
   *  unrelated skills into the result. */
  userSkillsDir?: string;
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
  const userDir = opts.userSkillsDir ?? userSkillsDir();
  const projectDir = projectSkillsDir(workspaceRoot);
  // Feeds (the non-skill `<workspace>/feeds/` registry) are scanned as a
  // third root. They merge FIRST so a real skill collection (user or
  // project) always overrides a feed on slug collision — a feed must
  // never shadow a genuine skill-backed collection.
  const feedCollections = await collectFromDir(feedsRoot(workspaceRoot), "feed", workspaceRoot);
  const userCollections = await collectFromDir(userDir, "user", workspaceRoot);
  const projectCollections = await collectFromDir(projectDir, "project", workspaceRoot);
  const merged = new Map<string, LoadedCollection>();
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
  const userDir = opts.userSkillsDir ?? userSkillsDir();
  const projectDir = projectSkillsDir(workspaceRoot);
  // Project first (overrides user), then user, then the feeds registry
  // last — mirroring the merge precedence in `discoverCollections` so a
  // skill collection always wins over a feed of the same slug.
  const projectCollection = await loadOneCollection(projectDir, safeName, "project", workspaceRoot);
  if (projectCollection) return projectCollection;
  const userCollection = await loadOneCollection(userDir, safeName, "user", workspaceRoot);
  if (userCollection) return userCollection;
  return loadOneCollection(feedsRoot(workspaceRoot), safeName, "feed", workspaceRoot);
}

export function toSummary(collection: LoadedCollection): CollectionSummary {
  return {
    slug: collection.slug,
    title: collection.schema.title,
    icon: collection.schema.icon,
    source: collection.source,
    ...(collection.schema.dataSource !== undefined ? { readonly: true as const } : {}),
  };
}

export function toDetail(collection: LoadedCollection): CollectionDetail {
  return { ...toSummary(collection), schema: collection.schema };
}
