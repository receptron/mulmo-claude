#!/usr/bin/env tsx
// One-shot migration for issue #284: restructure ~/mulmoclaude into
// config / conversations / data / artifacts groupings.
//
// BEFORE running the server with the matching code change, run this
// script (default `--dry-run` prints the plan; add `--execute` to
// actually move files). Keep the server stopped while it runs.
//
// Flow:
//   1. Back up the workspace to ~/mulmoclaude.backup-<timestamp>/
//      via a full recursive copy (rsync).
//   2. Create the new top-level grouping directories
//      (config / conversations / data / artifacts) if missing.
//   3. Move each legacy top-level dir to its new location using
//      `fs.rename` (same filesystem → O(1)).
//   4. Move `memory.md` to `conversations/memory.md`.
//   5. Walk chat/*.jsonl (now at conversations/chat/*.jsonl) and
//      rewrite structured `filePath` / `path` fields that point into
//      moved dirs.
//   6. Walk conversations/summaries/**/*.md and conversations/memory.md
//      and rewrite prose path mentions (regex, word-boundary guarded).
//   7. Write `migration-284-manifest.json` at the workspace root
//      recording everything that was moved / rewritten.
//
// Safety: the script aborts on any unexpected state (partial prior
// migration, a target dir already existing, etc.) and leaves the
// workspace untouched. `--dry-run` prints what would happen without
// writing anything. Use `--execute` to commit.

import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";

// ─── Constants ──────────────────────────────────────────────────

const WORKSPACE_ROOT = path.join(os.homedir(), "mulmoclaude");

interface DirMove {
  /** Legacy relative path (below workspace root). */
  from: string;
  /** New relative path. */
  to: string;
}

/**
 * Canonical directory remap. Order matters for nested cases: a `from`
 * that is an ancestor of another `from` (there are none today) would
 * need to be moved last. All current entries are top-level.
 */
export const DIR_MIGRATIONS: readonly DirMove[] = [
  // config/ — settings, MCP config, roles, helps
  { from: "configs", to: "config" },
  { from: "roles", to: "config/roles" },
  { from: "helps", to: "config/helps" },
  // conversations/ — chat sessions + distilled memory + summaries + trace
  { from: "chat", to: "conversations/chat" },
  { from: "summaries", to: "conversations/summaries" },
  { from: "searches", to: "conversations/searches" },
  // data/ — user-managed content
  { from: "wiki", to: "data/wiki" },
  { from: "todos", to: "data/todos" },
  { from: "calendar", to: "data/calendar" },
  { from: "contacts", to: "data/contacts" },
  { from: "scheduler", to: "data/scheduler" },
  { from: "sources", to: "data/sources" },
  { from: "transports", to: "data/transports" },
  // artifacts/ — LLM-generated output, mostly regenerable
  { from: "charts", to: "artifacts/charts" },
  { from: "HTMLs", to: "artifacts/html" },
  { from: "html", to: "artifacts/html-scratch" },
  { from: "images", to: "artifacts/images" },
  { from: "markdowns", to: "artifacts/documents" },
  { from: "spreadsheets", to: "artifacts/spreadsheets" },
  { from: "stories", to: "artifacts/stories" },
  { from: "news", to: "artifacts/news" },
  { from: "scripts", to: "artifacts/scripts" },
];

export const FILE_MIGRATIONS: readonly DirMove[] = [
  { from: "memory.md", to: "conversations/memory.md" },
];

/**
 * Prefix rewrites applied to every `filePath` / `path` string value
 * found inside chat jsonl records. Same as DIR_MIGRATIONS plus a
 * trailing slash — the trailing slash ensures that e.g. `wiki-style`
 * (no such thing today, but defensive) doesn't match the `wiki/` rule.
 */
export const PATH_REWRITE_PREFIXES: ReadonlyArray<[string, string]> =
  DIR_MIGRATIONS.map(({ from, to }) => [`${from}/`, `${to}/`] as const);

// ─── Logging ────────────────────────────────────────────────────

const args = process.argv.slice(2);
const isExecute = args.includes("--execute");
const isDryRun = !isExecute;
const MODE = isDryRun ? "DRY-RUN" : "EXECUTE";

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[migrate-284 ${MODE}] ${msg}`);
}

function warn(msg: string): void {
  // eslint-disable-next-line no-console
  console.warn(`[migrate-284 ${MODE}] WARN: ${msg}`);
}

function die(msg: string): never {
  // eslint-disable-next-line no-console
  console.error(`[migrate-284 ${MODE}] ERROR: ${msg}`);
  process.exit(1);
}

// ─── Helpers ────────────────────────────────────────────────────

function timestamp(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function exists(absPath: string): boolean {
  try {
    fs.statSync(absPath);
    return true;
  } catch {
    return false;
  }
}

function isDir(absPath: string): boolean {
  try {
    return fs.statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Rewrite a single path value using the prefix table. Returns the new
 * value on match, or the input unchanged otherwise. Only the longest
 * matching prefix applies.
 */
export function rewritePathValue(value: string): string {
  // Longest-prefix win: check in declaration order which is intentional.
  for (const [oldPrefix, newPrefix] of PATH_REWRITE_PREFIXES) {
    if (value.startsWith(oldPrefix)) {
      return newPrefix + value.slice(oldPrefix.length);
    }
  }
  return value;
}

/**
 * Walk an arbitrary JSON value and rewrite any `filePath` / `path`
 * string property whose value starts with a known legacy prefix.
 * Returns the (possibly new) value and a count of rewrites applied.
 */
export function rewriteJsonEntry(
  entry: unknown,
): { value: unknown; rewrites: number } {
  let rewrites = 0;
  function walk(node: unknown): unknown {
    if (Array.isArray(node)) {
      return node.map(walk);
    }
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (
          (k === "filePath" || k === "path" || k === "contentRef") &&
          typeof v === "string"
        ) {
          const next = rewritePathValue(v);
          if (next !== v) rewrites++;
          out[k] = next;
        } else {
          out[k] = walk(v);
        }
      }
      return out;
    }
    return node;
  }
  return { value: walk(entry), rewrites };
}

/**
 * Rewrite prose markdown path mentions. Only replaces occurrences
 * preceded by a non-word boundary so "wikipedia" isn't rewritten.
 * Returns the new text and a count of rewrites.
 */
export function rewriteProseText(text: string): {
  value: string;
  rewrites: number;
} {
  let out = text;
  let rewrites = 0;
  for (const { from, to } of DIR_MIGRATIONS) {
    // Match only at a true prose boundary: start-of-text or a
    // non-path-like character. Explicitly exclude `/`, `.`, and `:`
    // so we don't re-migrate already-relative paths (`../wiki/`),
    // URLs (`https://example.com/wiki/`), or chains like
    // `data/wiki/` (post-#284 canonical) → `data/data/wiki/`.
    // The rewrite must be idempotent because users may re-run the
    // script or hand-edit memory.md after migration.
    const re = new RegExp(`(^|[^A-Za-z0-9_./:-])${escapeRe(from)}/`, "g");
    out = out.replace(re, (_m, boundary: string) => {
      rewrites++;
      return `${boundary}${to}/`;
    });
  }
  return { value: out, rewrites };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── Plan structures ────────────────────────────────────────────

interface Manifest {
  timestamp: string;
  backupPath: string;
  dirMoves: Array<{ from: string; to: string; status: "moved" | "missing" }>;
  fileMoves: Array<{ from: string; to: string; status: "moved" | "missing" }>;
  jsonlRewrites: Array<{ file: string; rewrites: number }>;
  proseRewrites: Array<{ file: string; rewrites: number }>;
}

// ─── Steps ──────────────────────────────────────────────────────

function assertWorkspaceSane(): void {
  if (!exists(WORKSPACE_ROOT)) {
    die(`Workspace not found at ${WORKSPACE_ROOT}. Nothing to migrate.`);
  }
  // Bail if someone has already partially migrated (e.g. both old
  // chat/ and new conversations/chat/ present) — ambiguous state.
  // Both DIR_MIGRATIONS and FILE_MIGRATIONS targets must be absent;
  // otherwise moveFiles() could overwrite a hand-edited file later
  // in the run after other moves have already succeeded.
  const collisions: string[] = [];
  for (const { to } of DIR_MIGRATIONS) {
    const target = path.join(WORKSPACE_ROOT, to);
    if (exists(target)) {
      collisions.push(to);
    }
  }
  for (const { to } of FILE_MIGRATIONS) {
    const target = path.join(WORKSPACE_ROOT, to);
    if (exists(target)) {
      collisions.push(to);
    }
  }
  if (collisions.length > 0) {
    die(
      `Target paths already exist (prior migration attempt?). ` +
        `Inspect and remove these before re-running:\n  ` +
        collisions.join("\n  "),
    );
  }
}

function backupWorkspace(): string {
  const backup = `${WORKSPACE_ROOT}.backup-${timestamp()}`;
  log(`Backing up ${WORKSPACE_ROOT} → ${backup}`);
  if (isDryRun) return backup;
  // `fs.cpSync` with `recursive: true` is cross-platform (macOS,
  // Linux, Windows) and available in Node >= 16.7. Previously we
  // shelled out to `rsync`, which isn't installed by default on
  // Windows. `preserveTimestamps` keeps mtimes so subsequent journal
  // passes treat the backup identically to the original workspace if
  // anyone ever reuses it as `WORKSPACE_ROOT` for recovery.
  try {
    fs.cpSync(WORKSPACE_ROOT, backup, {
      recursive: true,
      preserveTimestamps: true,
      errorOnExist: true,
      force: false,
    });
  } catch (err) {
    die(`Backup copy failed: ${err instanceof Error ? err.message : err}`);
  }
  return backup;
}

function ensureDirParent(absPath: string): void {
  const parent = path.dirname(absPath);
  if (!exists(parent)) {
    log(`mkdir -p ${path.relative(WORKSPACE_ROOT, parent)}`);
    if (!isDryRun) fs.mkdirSync(parent, { recursive: true });
  }
}

function moveDirs(
  manifest: Manifest,
): void {
  for (const { from, to } of DIR_MIGRATIONS) {
    const src = path.join(WORKSPACE_ROOT, from);
    const dst = path.join(WORKSPACE_ROOT, to);
    if (!isDir(src)) {
      manifest.dirMoves.push({ from, to, status: "missing" });
      continue;
    }
    log(`move dir  ${from} → ${to}`);
    ensureDirParent(dst);
    if (!isDryRun) {
      fs.renameSync(src, dst);
    }
    manifest.dirMoves.push({ from, to, status: "moved" });
  }
}

function moveFiles(manifest: Manifest): void {
  for (const { from, to } of FILE_MIGRATIONS) {
    const src = path.join(WORKSPACE_ROOT, from);
    const dst = path.join(WORKSPACE_ROOT, to);
    if (!exists(src)) {
      manifest.fileMoves.push({ from, to, status: "missing" });
      continue;
    }
    log(`move file ${from} → ${to}`);
    ensureDirParent(dst);
    if (!isDryRun) {
      fs.renameSync(src, dst);
    }
    manifest.fileMoves.push({ from, to, status: "moved" });
  }
}

async function rewriteChatJsonl(manifest: Manifest): Promise<void> {
  // chat/ has now moved to conversations/chat/.
  const chatDir = path.join(WORKSPACE_ROOT, "conversations", "chat");
  if (isDryRun) {
    // In dry-run we compute from the OLD location (dirs weren't actually
    // moved). Fall back so counts reflect reality.
    const alt = path.join(WORKSPACE_ROOT, "chat");
    if (isDir(alt)) return rewriteChatJsonlIn(alt, manifest);
  }
  if (!isDir(chatDir)) return;
  return rewriteChatJsonlIn(chatDir, manifest);
}

async function rewriteChatJsonlIn(
  chatDir: string,
  manifest: Manifest,
): Promise<void> {
  const files = (await fsp.readdir(chatDir)).filter((f) => f.endsWith(".jsonl"));
  for (const f of files) {
    const abs = path.join(chatDir, f);
    const raw = await fsp.readFile(abs, "utf-8");
    const lines = raw.split("\n");
    let fileRewrites = 0;
    const out: string[] = [];
    for (const line of lines) {
      if (line.trim() === "") {
        out.push(line);
        continue;
      }
      try {
        const parsed = JSON.parse(line);
        const { value, rewrites } = rewriteJsonEntry(parsed);
        fileRewrites += rewrites;
        out.push(JSON.stringify(value));
      } catch {
        // Malformed line — leave it alone rather than drop it.
        out.push(line);
      }
    }
    if (fileRewrites === 0) continue;
    log(`rewrite jsonl ${path.relative(WORKSPACE_ROOT, abs)} (${fileRewrites} paths)`);
    if (!isDryRun) {
      await fsp.writeFile(abs, out.join("\n"), "utf-8");
    }
    manifest.jsonlRewrites.push({
      file: path.relative(WORKSPACE_ROOT, abs),
      rewrites: fileRewrites,
    });
  }
}

async function rewriteProseFiles(manifest: Manifest): Promise<void> {
  // memory.md has moved to conversations/memory.md; summaries/ to
  // conversations/summaries/. Again in dry-run fall back to the
  // original locations so counts are meaningful.
  const targets: Array<{ label: string; abs: string }> = [];

  const pick = (...cands: string[]): string | null => {
    for (const c of cands) if (exists(c)) return c;
    return null;
  };

  const memoryMd = pick(
    path.join(WORKSPACE_ROOT, "conversations", "memory.md"),
    path.join(WORKSPACE_ROOT, "memory.md"),
  );
  if (memoryMd) targets.push({ label: "memory.md", abs: memoryMd });

  const summariesDir = pick(
    path.join(WORKSPACE_ROOT, "conversations", "summaries"),
    path.join(WORKSPACE_ROOT, "summaries"),
  );
  if (summariesDir) {
    for (const abs of await walkForMarkdown(summariesDir)) {
      targets.push({
        label: path.relative(WORKSPACE_ROOT, abs),
        abs,
      });
    }
  }

  for (const { label, abs } of targets) {
    const raw = await fsp.readFile(abs, "utf-8");
    const { value, rewrites } = rewriteProseText(raw);
    if (rewrites === 0) continue;
    log(`rewrite prose ${label} (${rewrites} mentions)`);
    if (!isDryRun) {
      await fsp.writeFile(abs, value, "utf-8");
    }
    manifest.proseRewrites.push({ file: label, rewrites });
  }
}

async function walkForMarkdown(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walkForMarkdown(full)));
    } else if (e.isFile() && e.name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

function writeManifest(manifest: Manifest): void {
  const manifestPath = path.join(WORKSPACE_ROOT, "migration-284-manifest.json");
  log(`writing manifest → ${path.basename(manifestPath)}`);
  if (!isDryRun) {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  }
}

// ─── Entry point ────────────────────────────────────────────────

async function main(): Promise<void> {
  log(
    `Mode: ${isDryRun ? "DRY-RUN (no writes)" : "EXECUTE (writing)"}. ` +
      `Workspace: ${WORKSPACE_ROOT}`,
  );

  assertWorkspaceSane();

  const manifest: Manifest = {
    timestamp: new Date().toISOString(),
    backupPath: "",
    dirMoves: [],
    fileMoves: [],
    jsonlRewrites: [],
    proseRewrites: [],
  };

  manifest.backupPath = backupWorkspace();
  moveDirs(manifest);
  moveFiles(manifest);
  await rewriteChatJsonl(manifest);
  await rewriteProseFiles(manifest);
  writeManifest(manifest);

  log(
    `Done. Dirs moved: ${manifest.dirMoves.filter((m) => m.status === "moved").length}, ` +
      `file paths rewritten in JSONL: ${manifest.jsonlRewrites.reduce((s, r) => s + r.rewrites, 0)}, ` +
      `prose mentions rewritten: ${manifest.proseRewrites.reduce((s, r) => s + r.rewrites, 0)}.`,
  );
  if (isDryRun) {
    log("Re-run with --execute to actually apply the changes.");
  } else {
    log(`Backup preserved at: ${manifest.backupPath}`);
    warn(
      "If the server was running during the migration, restart it now. " +
        "The in-memory path cache was built from the OLD layout.",
    );
  }
}

// Run if invoked directly (not imported for tests)
const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(path.basename(process.argv[1]));

if (invokedDirectly) {
  main().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(`[migrate-284] Fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
