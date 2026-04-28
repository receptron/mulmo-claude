// All writes go through writeFileAtomic so concurrent readers never see a half-written file. All reads swallow ENOENT
// and return null/fallback so callers can branch on `!content` instead of try/catch.

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

export function resolveWorkspacePath(relPath: string): string {
  return path.join(workspacePath, relPath);
}

export async function readWorkspaceText(relPath: string): Promise<string | null> {
  try {
    return await promises.readFile(resolveWorkspacePath(relPath), "utf-8");
  } catch (err) {
    return rethrowUnexpected(err, `readWorkspaceText(${relPath})`);
  }
}

export function readWorkspaceTextSync(relPath: string): string | null {
  try {
    return readFileSync(resolveWorkspacePath(relPath), "utf-8");
  } catch (err) {
    return rethrowUnexpected(err, `readWorkspaceTextSync(${relPath})`);
  }
}

export async function readWorkspaceJson<T>(relPath: string, fallback: T): Promise<T> {
  const text = await readWorkspaceText(relPath);
  if (text === null) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function readWorkspaceJsonSync<T>(relPath: string, fallback: T): T {
  const text = readWorkspaceTextSync(relPath);
  if (text === null) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export async function writeWorkspaceText(relPath: string, content: string, opts?: { mode?: number }): Promise<void> {
  await writeFileAtomic(resolveWorkspacePath(relPath), content, opts);
}

export function writeWorkspaceTextSync(relPath: string, content: string, opts?: { mode?: number }): void {
  writeFileAtomicSync(resolveWorkspacePath(relPath), content, opts);
}

export async function writeWorkspaceJson(relPath: string, data: unknown, opts?: { mode?: number }): Promise<void> {
  await writeFileAtomic(resolveWorkspacePath(relPath), JSON.stringify(data, null, 2), opts);
}

// **Internal fixed paths only.** No `..` traversal guard — user-supplied paths MUST go through resolveWithinRoot() in safe.ts.
export function resolvePath(root: string, relPath: string): string {
  return path.join(root, relPath);
}

export async function readTextUnder(root: string, relPath: string): Promise<string | null> {
  try {
    return await promises.readFile(path.join(root, relPath), "utf-8");
  } catch (err) {
    return rethrowUnexpected(err, `readTextUnder(${relPath})`);
  }
}

export async function writeTextUnder(root: string, relPath: string, content: string): Promise<void> {
  await writeFileAtomic(path.join(root, relPath), content);
}

export function readTextUnderSync(root: string, relPath: string): string | null {
  try {
    return readFileSync(path.join(root, relPath), "utf-8");
  } catch (err) {
    return rethrowUnexpected(err, `readTextUnderSync(${relPath})`);
  }
}

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

export async function statUnder(root: string, relPath: string): Promise<Stats | null> {
  try {
    return await promises.stat(path.join(root, relPath));
  } catch (err) {
    return rethrowUnexpected(err, `statUnder(${relPath})`);
  }
}

export async function ensureDirUnder(root: string, relPath: string): Promise<void> {
  await promises.mkdir(path.join(root, relPath), { recursive: true });
}

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

export function ensureWorkspaceDir(relPath: string): void {
  mkdirSync(resolveWorkspacePath(relPath), { recursive: true });
}
