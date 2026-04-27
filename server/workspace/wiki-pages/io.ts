// Single choke point for `data/wiki/pages/<slug>.md` writes.
//
// Every wiki page write — manageWiki MCP tool, the user editing
// through the file content endpoint, the wiki-backlinks driver
// appending session links — funnels through `writeWikiPage`.
// Centralising here gives:
//
//   - one atomic-write guarantee (was: wiki-backlinks bypassed it)
//   - one place to record edit history (#763 PR 2 — currently a
//     no-op stub; this PR only consolidates the writes)
//   - editor identity captured at the call site (LLM / user /
//     system) where it is actually known. A generic `writeFileAtomic`
//     hook can't tell who originated the edit.
//
// PR 1 scope (this commit): consolidation only, behaviour unchanged.
// PR 2 will fill in `appendSnapshot` with real history pipeline.
//
// `appendSnapshot` is a no-op stub on purpose — keeping the call
// site wired up means PR 2 is purely an internal change.

import path from "node:path";
import { readTextSafe } from "../../utils/files/safe.js";
import { writeFileAtomic } from "../../utils/files/atomic.js";
import { mergeFrontmatter, parseFrontmatter, serializeWithFrontmatter } from "../../utils/markdown/frontmatter.js";
import { workspacePath as defaultWorkspacePath } from "../workspace.js";
import { WORKSPACE_DIRS } from "../paths.js";

export type WikiPageEditor = "llm" | "user" | "system";

export interface WikiWriteMeta {
  editor: WikiPageEditor;
  /** Chat session that triggered the edit. Optional — not all
   *  callers know one (e.g. user save through the file editor). */
  sessionId?: string;
  /** Free-form short reason. LLM-supplied or user-supplied. */
  reason?: string;
}

export interface WikiPageWriteOptions {
  /** Override the workspace root for tests. Defaults to the
   *  process's resolved workspace (`workspace.ts`). */
  workspaceRoot?: string;
  /** Inject the "now" used for `created` / `updated` frontmatter
   *  injection. Tests pass a fixed `Date` so the round-trip is
   *  deterministic; production uses the wall clock. */
  now?: () => Date;
}

/** Reject slugs that would escape `data/wiki/pages/` once joined.
 *  The chokepoint must defend itself against careless callers — a
 *  raw `path.join(root, dir, '${slug}.md')` happily resolves
 *  `../../etc/passwd` outside the wiki tree. Today's three callers
 *  derive slugs from `path.basename(...)` so they're already safe;
 *  this guard keeps that property even if a future caller forgets.
 *
 *  The rule is intentionally narrow — separators / `..` / NUL /
 *  empty — so it only rejects unambiguous security violations.
 *  Aesthetic concerns (e.g. dot-prefixed "hidden" filenames) are
 *  out of scope: a pre-existing `data/wiki/pages/.foo.md` should
 *  remain writable through the chokepoint, and over-rejection here
 *  would turn that into a 500 (codex review iter-2 #883). */
function isSafeSlug(slug: string): boolean {
  if (slug.length === 0) return false;
  if (slug === "." || slug === "..") return false;
  // Any path separator (forward slash, backslash on Windows) or
  // literal `..` segment means the slug spans directories — not
  // allowed at the page-write layer.
  if (slug.includes("/") || slug.includes("\\")) return false;
  if (slug.includes("\0")) return false;
  return true;
}

/** Absolute path for a slug. Throws on slugs that would escape
 *  `data/wiki/pages/`. Does not check existence. */
export function wikiPagePath(slug: string, opts: WikiPageWriteOptions = {}): string {
  if (!isSafeSlug(slug)) {
    throw new Error(`wiki-pages: refusing unsafe slug ${JSON.stringify(slug)}`);
  }
  const root = opts.workspaceRoot ?? defaultWorkspacePath;
  return path.join(root, WORKSPACE_DIRS.wikiPages, `${slug}.md`);
}

/** Read a wiki page; null if missing. Used internally to capture
 *  the pre-write content for snapshotting (PR 2). Exposed because
 *  some callers want the same null-safe reader. */
export async function readWikiPage(slug: string, opts: WikiPageWriteOptions = {}): Promise<string | null> {
  return readTextSafe(wikiPagePath(slug, opts));
}

/** Write a wiki page atomically and stamp it with `created` /
 *  `updated` / `editor` frontmatter (lazy-on-write — #895 PR B).
 *  Existing frontmatter keys are preserved; `created` is set on
 *  first write and never overwritten; `updated` is bumped on every
 *  write. Callers may pass either a body-only string or content
 *  with its own `---\n...\n---` envelope (we re-parse and merge
 *  so the resulting file always has a single canonical envelope).
 *
 *  `uniqueTmp: true` matches what the generic `/api/files/content`
 *  PUT used pre-consolidation — without it two simultaneous writes
 *  to the same page collide on the shared `.tmp` staging file
 *  (the file-content PUT and the wiki-backlinks driver are
 *  independent and may target the same page in the same
 *  millisecond).
 *
 *  The (old, new) pair still flows into `appendSnapshot` — the
 *  no-op stub today, real history pipeline in #763 PR 2. */
export async function writeWikiPage(slug: string, content: string, meta: WikiWriteMeta, opts: WikiPageWriteOptions = {}): Promise<void> {
  const absPath = wikiPagePath(slug, opts);
  const oldContent = await readTextSafe(absPath);
  const finalContent = stampFrontmatter(oldContent, content, meta, opts);
  await writeFileAtomic(absPath, finalContent, { uniqueTmp: true });
  // Snapshot trigger: only fire when the *body* changed (or the
  // user-supplied meta did) — auto-stamping `updated` on every
  // save would otherwise flood the snapshot store with no-op
  // saves where nothing the user cares about actually changed.
  // Compare bodies after parsing so a frontmatter-only diff in
  // auto-stamped fields doesn't trip the trigger.
  if (oldContent === null || hasMeaningfulChange(oldContent, finalContent)) {
    await appendSnapshot(slug, oldContent, finalContent, meta);
  }
}

/** True iff the diff between `oldContent` and `newContent` is
 *  more than just the auto-stamped `updated` / `editor` fields.
 *  Auto-stamps land on every save; without this guard the
 *  snapshot pipeline (#763 PR 2) would record a snapshot per
 *  no-op save. The check compares (body) and (meta minus the
 *  auto-stamped keys). */
function hasMeaningfulChange(oldContent: string, newContent: string): boolean {
  const oldDoc = parseFrontmatter(oldContent);
  const newDoc = parseFrontmatter(newContent);
  if (oldDoc.body !== newDoc.body) return true;
  const oldMeta = withoutAutoStamps(oldDoc.meta);
  const newMeta = withoutAutoStamps(newDoc.meta);
  return JSON.stringify(oldMeta) !== JSON.stringify(newMeta);
}

const AUTO_STAMP_KEYS = new Set(["updated", "editor"]);

function withoutAutoStamps(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (!AUTO_STAMP_KEYS.has(key)) out[key] = value;
  }
  return out;
}

/** Internal — merge `created` / `updated` / `editor` into the
 *  outgoing content. Splits the caller's `content` so a body-only
 *  caller and a frontmatter-included caller both produce the
 *  same canonical envelope on disk. */
function stampFrontmatter(oldContent: string | null, newContent: string, meta: WikiWriteMeta, opts: WikiPageWriteOptions): string {
  const existingMeta = oldContent !== null ? parseFrontmatter(oldContent).meta : {};
  const incoming = parseFrontmatter(newContent);
  const now = (opts.now ?? (() => new Date()))();
  const merged = mergeFrontmatter(
    {
      ...existingMeta,
      // Caller's own frontmatter (if they passed any) layers on
      // top of the existing on-disk meta. Callers rarely do this,
      // but when manageWiki sends `---\ntitle: …\n---` we honour it.
      ...incoming.meta,
    },
    {
      // `created` is sticky: keep the existing one if any, else
      // stamp the date (no time — created is "first save day", not
      // "first save instant"). Use `existingMeta.created` so the
      // value isn't reset by an LLM that mistakenly reset it in
      // its incoming frontmatter.
      created: typeof existingMeta.created === "string" && existingMeta.created.length > 0 ? existingMeta.created : toIsoDate(now),
      // `updated` always bumps — full ISO timestamp with ms so
      // same-second writes still order correctly.
      updated: now.toISOString(),
      // `editor` reflects the call-site identity (PR #883). LLM /
      // user disambiguation lives at the API layer; placeholder
      // for now is fine.
      editor: meta.editor,
    },
  );
  return serializeWithFrontmatter(merged, incoming.body);
}

function toIsoDate(date: Date): string {
  // YYYY-MM-DD — sortable, locale-free, matches the issue body's
  // `created: 2026-04-26` example. UTC date deliberately so a
  // session that crosses midnight in the user's TZ doesn't get
  // two different `created` values.
  return date.toISOString().slice(0, 10);
}

/** Routing helper for the generic `/api/files/content` PUT.
 *  Returns `{ wiki: true, slug }` when `absPath` resolves directly
 *  under `data/wiki/pages/` AND ends in `.md`. Anything outside
 *  that exact shape (index.md, sources/, non-md, nested subdirs,
 *  paths that escape pagesDir via `..`) is `{ wiki: false }` and
 *  should fall back to the generic atomic write.
 *
 *  This function is **pure path-string math** — it does no symlink
 *  resolution. Callers MUST pass an already-realpath'd `absPath`
 *  AND an already-realpath'd `workspaceRoot` (or rely on the
 *  default, which mirrors `defaultWorkspacePath`). Mixing one
 *  realpath'd side with a symlinked other side is the trap that
 *  caused #883 review-iter-1 — a symlinked workspace would have
 *  silently routed wiki writes through the generic writer. */
export function classifyAsWikiPage(absPath: string, opts: WikiPageWriteOptions = {}): { wiki: true; slug: string } | { wiki: false } {
  const root = opts.workspaceRoot ?? defaultWorkspacePath;
  const pagesDir = path.join(root, WORKSPACE_DIRS.wikiPages);
  // `path.relative` returns "" for equal paths, a "../"-prefixed
  // string when `absPath` is outside `pagesDir`, and an absolute
  // path on Windows when the two are on different drives.
  const rel = path.relative(pagesDir, absPath);
  if (rel.length === 0) return { wiki: false };
  if (path.isAbsolute(rel)) return { wiki: false };
  // The file must live directly in `pages/`, not in a subdirectory
  // (no nested wiki layout today). Any separator means the path
  // either escapes (`../secret.md`) or descends (`subdir/foo.md`)
  // — both rejected. NOTE: a literal page name like `..foo.md` is
  // a single segment without a separator and is allowed (codex
  // review iter-3 #883 — the prior `startsWith("..")` rule
  // wrongly rejected it).
  if (rel.includes(path.sep)) return { wiki: false };
  if (!rel.endsWith(".md")) return { wiki: false };
  const slug = rel.slice(0, -".md".length);
  // Mirror isSafeSlug at the classifier so any path the classifier
  // accepts is one writeWikiPage can actually handle. The two
  // documented escapes are `<pagesDir>/.md` (rel = ".md", slug = "")
  // and the literal "." / ".." filenames (`.md.md` is fine, `..md`
  // is fine too — those are valid filenames). Without this check,
  // writeWikiPage's wikiPagePath() throws "refusing unsafe slug" and
  // the caller (files PUT) bubbles a 500 instead of falling through
  // to the generic writeFileAtomic path. Coderabbit review #883.
  if (!isSafeSlug(slug)) return { wiki: false };
  return { wiki: true, slug };
}

// ── Internal: snapshot stub ────────────────────────────────────
//
// Filled in by #763 PR 2. Kept here as a no-op so the call site is
// already wired up and PR 2 is a pure internal change.
//
// Signature note: takes both old and new content so the snapshot
// store can emit a diff or store the prior version directly. Meta
// carries editor identity / session / reason so the snapshot can
// be attributed.

async function appendSnapshot(__slug: string, __oldContent: string | null, __newContent: string, __meta: WikiWriteMeta): Promise<void> {
  // Intentionally empty — PR 2 (#763) replaces this with the
  // actual snapshot pipeline. The wiring is in place so PR 2 is
  // purely an internal change.
}
