// Workspace-aware file I/O — the single place implementation code
// should reach for when reading/writing files under ~/mulmoclaude/.
//
// Combines WORKSPACE_PATHS (path resolution) with the atomic/safe
// helpers (I/O primitives) so call sites never need raw `path.join`
// + raw `fs.*` for workspace files.
//
// All writes go through writeFileAtomic so concurrent readers always
// see a consistent file — never a half-written one.
//
// All reads swallow ENOENT and return null / fallback so callers can
// do `if (!content)` instead of try/catch.

import { Stats, mkdirSync, promises, readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { workspacePath } from "../../workspace/paths.js";
import { writeFileAtomic, writeFileAtomicSync } from "./atomic.js";
import { log } from "../../system/logger/index.js";
import { isEnoent } from "./safe.js";

function rethrowUnexpected(err: unknown, context: string): null {
  if (isEnoent(err)) return null;
  log.error("workspace-io", context, { error: String(err) });
  throw err;
}

// ── Path resolution ─────────────────────────────────────────────

/**
 * Resolve a workspace-relative path to an absolute path.
 * Use this instead of `path.join(workspacePath, rel)` in
 * implementation code — keeps the workspace root reference in
 * one place.
 */
export function resolveWorkspacePath(relPath: string): string {
  return path.join(workspacePath, relPath);
}

// ── Read ────────────────────────────────────────────────────────

/**
 * Read a text file under the workspace. Returns null on ENOENT;
 * logs and re-throws unexpected errors (EACCES, EPERM, etc.).
 */
export async function readWorkspaceText(relPath: string): Promise<string | null> {
  try {
    return await promises.readFile(resolveWorkspacePath(relPath), "utf-8");
  } catch (err) {
    return rethrowUnexpected(err, `readWorkspaceText(${relPath})`);
  }
}

/** Sync variant. Same ENOENT-only swallow contract. */
export function readWorkspaceTextSync(relPath: string): string | null {
  try {
    return readFileSync(resolveWorkspacePath(relPath), "utf-8");
  } catch (err) {
    return rethrowUnexpected(err, `readWorkspaceTextSync(${relPath})`);
  }
}

/**
 * Read and parse a JSON file under the workspace. Returns
 * `fallback` if the file is missing, unreadable, or malformed.
 */
export async function readWorkspaceJson<T>(relPath: string, fallback: T): Promise<T> {
  const text = await readWorkspaceText(relPath);
  if (text === null) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** Sync variant of `readWorkspaceJson`. */
export function readWorkspaceJsonSync<T>(relPath: string, fallback: T): T {
  const text = readWorkspaceTextSync(relPath);
  if (text === null) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

// ── Write ───────────────────────────────────────────────────────

/**
 * Write a text file under the workspace atomically.
 * Parent directories are created if missing.
 */
export async function writeWorkspaceText(relPath: string, content: string, opts?: { mode?: number }): Promise<void> {
  await writeFileAtomic(resolveWorkspacePath(relPath), content, opts);
}

/** Sync variant for startup / init paths. */
export function writeWorkspaceTextSync(relPath: string, content: string, opts?: { mode?: number }): void {
  writeFileAtomicSync(resolveWorkspacePath(relPath), content, opts);
}

/**
 * Write a JSON value under the workspace atomically.
 * Pretty-printed with 2-space indent.
 */
export async function writeWorkspaceJson(relPath: string, data: unknown, opts?: { mode?: number }): Promise<void> {
  await writeFileAtomic(resolveWorkspacePath(relPath), JSON.stringify(data, null, 2), opts);
}

// ── Rooted variants (for DI / testable modules) ────────────────
//
// Modules that take `root` as a parameter (journal, sources, etc.)
// use these instead of raw path.join + fs.*. Same contract as the
// workspace-* helpers, but root is caller-supplied.
//
// **IMPORTANT — internal paths only.** These helpers do NOT guard
// against `..` traversal. They are designed for domain I/O modules
// that pass compile-time-fixed relative paths like
// `${WORKSPACE_DIRS.chat}/${id}.json`. User-supplied or HTTP-body
// paths MUST go through `resolveWithinRoot()` in `safe.ts` instead.

/**
 * Resolve root + relPath. Replaces raw `path.join(root, rel)`.
 *
 * For **internal fixed paths only** — never pass user input as
 * `relPath`. Use `resolveWithinRoot()` for user-supplied paths.
 */
export function resolvePath(root: string, relPath: string): string {
  return path.join(root, relPath);
}

/** Read text under an arbitrary root. Null on ENOENT; rethrows
 *  unexpected errors. */
export async function readTextUnder(root: string, relPath: string): Promise<string | null> {
  try {
    return await promises.readFile(path.join(root, relPath), "utf-8");
  } catch (err) {
    return rethrowUnexpected(err, `readTextUnder(${relPath})`);
  }
}

/** Write atomically under an arbitrary root. */
export async function writeTextUnder(root: string, relPath: string, content: string): Promise<void> {
  await writeFileAtomic(path.join(root, relPath), content);
}

/** Sync read text under a root. Null on ENOENT. */
export function readTextUnderSync(root: string, relPath: string): string | null {
  try {
    return readFileSync(path.join(root, relPath), "utf-8");
  } catch (err) {
    return rethrowUnexpected(err, `readTextUnderSync(${relPath})`);
  }
}

/** Sync readdir under a root. Empty on ENOENT. */
export function readdirUnderSync(root: string, relPath: string): string[] {
  try {
    return readdirSync(path.join(root, relPath));
  } catch (err) {
    if (isEnoent(err)) return [];
    log.error("workspace-io", `readdirUnderSync(${relPath})`, {
      error: String(err),
    });
    throw err;
  }
}

/** Readdir under a root. Empty on ENOENT; rethrows unexpected. */
export async function readdirUnder(root: string, relPath: string): Promise<string[]> {
  try {
    return await promises.readdir(path.join(root, relPath));
  } catch (err) {
    if (isEnoent(err)) return [];
    log.error("workspace-io", `readdirUnder(${relPath})`, {
      error: String(err),
    });
    throw err;
  }
}

/** Stat under a root. Null on ENOENT; rethrows unexpected. */
export async function statUnder(root: string, relPath: string): Promise<Stats | null> {
  try {
    return await promises.stat(path.join(root, relPath));
  } catch (err) {
    return rethrowUnexpected(err, `statUnder(${relPath})`);
  }
}

/** Ensure a directory exists under a root. */
export async function ensureDirUnder(root: string, relPath: string): Promise<void> {
  await promises.mkdir(path.join(root, relPath), { recursive: true });
}

// ── Existence ───────────────────────────────────────────────────

/**
 * Check whether a workspace-relative path exists on disk.
 * Returns false on ENOENT; rethrows unexpected errors.
 */
export function existsInWorkspace(relPath: string): boolean {
  try {
    statSync(resolveWorkspacePath(relPath));
    return true;
  } catch (err) {
    if (isEnoent(err)) return false;
    log.error("workspace-io", `existsInWorkspace(${relPath})`, {
      error: String(err),
    });
    throw err;
  }
}

/**
 * Ensure a workspace-relative directory exists. Creates it
 * (including parents) if missing. Idempotent.
 */
export function ensureWorkspaceDir(relPath: string): void {
  mkdirSync(resolveWorkspacePath(relPath), { recursive: true });
}
