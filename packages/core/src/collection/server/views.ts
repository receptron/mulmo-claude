// Server-side custom-view management: removing a collection's custom view.
//
// A custom view spans two on-disk facts that must be removed together:
//   1. an entry in the collection's schema.json `views[]` array
//   2. its HTML file at `<base>/views/<file>` (the entry's `file` field)
//
// The base dir is source-aware, mirroring `readCustomViewHtml`. A PROJECT
// collection authored in-place keeps schema + view HTML in the staging tree
// (`data/skills/<slug>/`) AND mirrors schema into the active dir
// (`.claude/skills/<slug>/`, i.e. `collection.skillDir`). A PROJECT collection
// IMPORTED via the discover panel (rename-on-conflict) lives entirely under
// the active dir — no staging mirror is created. We pick the canonical base
// (and the schema-write set) by *what's actually on disk*, so both layouts
// delete cleanly without ENOENT. The skill-bridge hook that normally keeps
// staging+active in sync only fires on the agent's own tool calls, never from
// an API route — exactly as `deleteCollection` reasons. A FEED / USER
// collection is a single tree at `collection.skillDir`.
//
// Custom-view HTML is staging-only for project collections (never mirrored —
// rendering is host-side), so only the canonical base's copy is unlinked.

import { readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "../../files/atomic.js";
import { getWorkspaceRoot, isPresetSlug, skillsStagingDir } from "./host";
import { resolveTemplatePath, safeSlugName, SCHEMA_FILE } from "./paths";
import type { IoOptions } from "./io";
import type { LoadedCollection } from "./discoveredCollection";

export type DeleteViewResult =
  | { kind: "ok"; viewId: string }
  | { kind: "not-found"; viewId: string }
  | { kind: "user-scope" }
  | { kind: "preset" }
  | { kind: "unsafe-path"; viewId: string };

async function fileExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (err) {
    const { code } = err as { code?: string };
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw err;
  }
}

/** The authoritative base dir for a collection's schema.json + view HTML.
 *  For a project collection, prefer the staging tree when its schema.json is
 *  present (authoring layout); otherwise fall back to the active skill dir
 *  (imported layout — staging never materialised). For feed / user, it's
 *  always the discovered skillDir. Matches `readCustomViewHtml` so reads and
 *  deletes agree on both layouts. */
async function canonicalBase(collection: Pick<LoadedCollection, "source" | "skillDir">, workspaceRoot: string, safeSlug: string): Promise<string> {
  if (collection.source !== "project") return collection.skillDir;
  const staging = path.join(skillsStagingDir(workspaceRoot), safeSlug);
  if (await fileExists(path.join(staging, SCHEMA_FILE))) return staging;
  return collection.skillDir;
}

/** Every on-disk schema.json that must reflect the removal. The active
 *  `<skillDir>/schema.json` is the discovery anchor and is always present.
 *  The staging copy is included only when it actually exists, so an imported
 *  project collection (no staging mirror) doesn't have an empty staging tree
 *  materialised by a side effect of the delete. */
async function schemaWriteTargets(collection: Pick<LoadedCollection, "source" | "skillDir">, workspaceRoot: string, safeSlug: string): Promise<string[]> {
  const active = path.join(collection.skillDir, SCHEMA_FILE);
  if (collection.source !== "project") return [active];
  const stagingSchema = path.join(skillsStagingDir(workspaceRoot), safeSlug, SCHEMA_FILE);
  const targets: string[] = [];
  if (await fileExists(stagingSchema)) targets.push(stagingSchema);
  targets.push(active);
  return targets;
}

/** Idempotent unlink — a missing file is fine (the schema entry still gets
 *  cleaned), but a real error (permissions, etc.) propagates. */
async function unlinkIfPresent(target: string): Promise<void> {
  try {
    await unlink(target);
  } catch (err) {
    if ((err as { code?: string }).code !== "ENOENT") throw err;
  }
}

/** Re-read the canonical schema.json, drop the `views[]` entry, and write the
 *  result back to every on-disk copy so staging + active stay identical. Reads
 *  raw (not `collection.schema`) so fields the typed schema doesn't model are
 *  preserved verbatim. */
async function removeViewFromSchemas(collection: LoadedCollection, viewId: string, workspaceRoot: string, safeSlug: string): Promise<void> {
  const base = await canonicalBase(collection, workspaceRoot, safeSlug);
  const canonical = path.join(base, SCHEMA_FILE);
  const parsed = JSON.parse(await readFile(canonical, "utf-8")) as { views?: { id?: unknown }[] };
  if (Array.isArray(parsed.views)) parsed.views = parsed.views.filter((entry) => entry?.id !== viewId);
  const serialized = `${JSON.stringify(parsed, null, 2)}\n`;
  for (const target of await schemaWriteTargets(collection, workspaceRoot, safeSlug)) {
    await writeFileAtomic(target, serialized);
  }
}

/** Delete one custom view from `collection`: unlink its HTML file and drop it
 *  from every schema.json copy. User-scope and preset (mc-*) collections are
 *  refused (read-only / re-seeded on boot), consistent with `deleteCollection`. */
export async function deleteCustomView(collection: LoadedCollection, viewId: string, opts: IoOptions = {}): Promise<DeleteViewResult> {
  if (collection.source === "user") return { kind: "user-scope" };
  if (isPresetSlug(collection.slug)) return { kind: "preset" };
  const safeSlug = safeSlugName(collection.slug);
  if (safeSlug === null) return { kind: "unsafe-path", viewId };
  const views = collection.schema.views ?? [];
  const view = views.find((entry) => entry.id === viewId);
  if (!view) return { kind: "not-found", viewId };
  const workspaceRoot = opts.workspaceRoot ?? getWorkspaceRoot();
  const htmlPath = resolveTemplatePath(await canonicalBase(collection, workspaceRoot, safeSlug), view.file);
  if (htmlPath === null) return { kind: "unsafe-path", viewId };
  // Rewrite the schema BEFORE unlinking: if the write fails the request errors
  // out, but the HTML stays put and the still-registered view keeps working —
  // an orphaned `views[]` entry pointing at a deleted file would 404 forever.
  await removeViewFromSchemas(collection, viewId, workspaceRoot, safeSlug);
  // Distinct ids may point at the same `file` (unique ids are enforced, unique
  // files are not), so only unlink when no remaining view still references it.
  const stillReferenced = views.some((entry) => entry.id !== viewId && entry.file === view.file);
  if (!stillReferenced) await unlinkIfPresent(htmlPath);
  return { kind: "ok", viewId };
}
