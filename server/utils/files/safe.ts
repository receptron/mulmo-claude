// Safe filesystem wrappers that swallow ENOENT / EACCES so callers
// can do `if (result === null)` instead of try/catch boilerplate.
//
// `resolveWithinRoot` is the realpath-based path-traversal check
// that underpins every endpoint serving files out of the workspace.
//
// Moved from server/utils/fs.ts (issue #366 Phase 1). The old
// file re-exports these for backwards compat.

import { Dirent, Stats, promises, readFileSync, readdirSync, realpathSync, statSync } from "fs";
import path from "path";
import { isErrorWithCode } from "../types.js";

/** Check if an error is ENOENT (file/dir not found). */
export function isEnoent(err: unknown): boolean {
  return isErrorWithCode(err) && err.code === "ENOENT";
}

/** Read a binary file by absolute path. Null on ENOENT. */
export function readBinarySafeSync(absPath: string): Buffer | null {
  try {
    return readFileSync(absPath);
  } catch {
    return null;
  }
}

/** Read a text file by absolute path (async). Null on ENOENT. */
export async function readTextSafe(absPath: string): Promise<string | null> {
  try {
    return await promises.readFile(absPath, "utf-8");
  } catch {
    return null;
  }
}

/** Read a text file by absolute path (sync). Null on ENOENT. */
export function readTextSafeSync(absPath: string): string | null {
  try {
    return readFileSync(absPath, "utf-8");
  } catch {
    return null;
  }
}

export function statSafe(absPath: string): Stats | null {
  try {
    return statSync(absPath);
  } catch {
    return null;
  }
}

export async function statSafeAsync(absPath: string): Promise<Stats | null> {
  try {
    return await promises.stat(absPath);
  } catch {
    return null;
  }
}

export function readDirSafe(absPath: string): Dirent[] {
  try {
    return readdirSync(absPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

export async function readDirSafeAsync(absPath: string): Promise<Dirent[]> {
  try {
    return await promises.readdir(absPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

export async function readTextOrNull(file: string): Promise<string | null> {
  try {
    return await promises.readFile(file, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Resolve a relative path against a root, ensuring the result stays
 * inside the root after symlink resolution. Returns null on traversal
 * or if either path doesn't exist on disk.
 *
 * `rootReal` MUST already be a realpath.
 */
export function resolveWithinRoot(rootReal: string, relPath: string): string | null {
  const normalized = path.normalize(relPath || "");
  const resolved = path.resolve(rootReal, normalized);
  let resolvedReal: string;
  try {
    resolvedReal = realpathSync(resolved);
  } catch {
    return null;
  }
  if (resolvedReal !== rootReal && !resolvedReal.startsWith(rootReal + path.sep)) {
    return null;
  }
  return resolvedReal;
}
