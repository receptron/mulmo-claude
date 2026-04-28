// Wrappers that swallow ENOENT/EACCES so callers branch on `result === null` instead of try/catch.
// resolveWithinRoot is the realpath-based traversal check used by every endpoint serving workspace files.

import { Dirent, Stats, promises, readFileSync, readdirSync, realpathSync, statSync } from "fs";
import path from "path";
import { isErrorWithCode } from "../types.js";

export function isEnoent(err: unknown): boolean {
  return isErrorWithCode(err) && err.code === "ENOENT";
}

export function readBinarySafeSync(absPath: string): Buffer | null {
  try {
    return readFileSync(absPath);
  } catch {
    return null;
  }
}

export async function readTextSafe(absPath: string): Promise<string | null> {
  try {
    return await promises.readFile(absPath, "utf-8");
  } catch {
    return null;
  }
}

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

// `rootReal` MUST already be a realpath. Returns null on traversal or if either path doesn't exist on disk.
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
