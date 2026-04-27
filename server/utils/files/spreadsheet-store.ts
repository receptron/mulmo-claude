import { mkdir, realpath } from "fs/promises";
import path from "path";
import { WORKSPACE_DIRS, WORKSPACE_PATHS } from "../../workspace/paths.js";
import { shortId } from "../id.js";
import { writeFileAtomic } from "./atomic.js";
import { yearMonthUtc } from "./naming.js";
import { resolveWithinRoot } from "./safe.js";

const SPREADSHEETS_DIR = WORKSPACE_PATHS.spreadsheets;

// Cached realpath of the spreadsheets directory. resolveWithinRoot
// requires its root argument to be a realpath so symlinks are handled
// correctly. Matches the pattern used in image-store.ts.
let spreadsheetsDirReal: string | null = null;

async function ensureSpreadsheetsDir(): Promise<string> {
  if (spreadsheetsDirReal) return spreadsheetsDirReal;
  await mkdir(SPREADSHEETS_DIR, { recursive: true });
  spreadsheetsDirReal = await realpath(SPREADSHEETS_DIR);
  return spreadsheetsDirReal;
}

// Resolve a workspace-relative spreadsheet path (e.g. "spreadsheets/abc.json")
// into an absolute path guaranteed to be inside the spreadsheets directory.
// Throws on traversal attempts.
async function safeResolve(relativePath: string): Promise<string> {
  const root = await ensureSpreadsheetsDir();
  // Strip the leading "spreadsheets/" prefix so callers can pass either
  // the stored form or just the filename.
  const name = relativePath.replace(new RegExp(`^${WORKSPACE_DIRS.spreadsheets}/`), "");
  const result = resolveWithinRoot(root, name);
  if (!result) {
    throw new Error(`path traversal rejected: ${relativePath}`);
  }
  return result;
}

/** Save sheets array as a JSON file. New files land under
 *  `spreadsheets/YYYY/MM/` (UTC) so the dir doesn't accumulate
 *  unbounded — see #764. Returns the workspace-relative path.
 *  Atomic: writeFileAtomic creates the partition dir and prevents
 *  half-written JSON on crash (#881 v1). */
export async function saveSpreadsheet(sheets: unknown[]): Promise<string> {
  await ensureSpreadsheetsDir();
  const partition = yearMonthUtc();
  const filename = `${shortId()}.json`;
  const absPath = path.join(SPREADSHEETS_DIR, partition, filename);
  await writeFileAtomic(absPath, JSON.stringify(sheets));
  return path.posix.join(WORKSPACE_DIRS.spreadsheets, partition, filename);
}

/** Overwrite an existing spreadsheet file. Atomic — see {@link saveSpreadsheet}. */
export async function overwriteSpreadsheet(relativePath: string, sheets: unknown[]): Promise<void> {
  const absPath = await safeResolve(relativePath);
  await writeFileAtomic(absPath, JSON.stringify(sheets));
}

/** Check if a string is a spreadsheet file path (not inline data).
 *  Rejects traversal attempts like "spreadsheets/../outside.json"
 *  so the caller can't rely on the prefix/suffix alone. */
export function isSpreadsheetPath(value: string): boolean {
  if (!value.startsWith(`${WORKSPACE_DIRS.spreadsheets}/`)) return false;
  if (!value.endsWith(".json")) return false;
  // Forbid .. segments anywhere in the path — a realpath check still
  // happens server-side, but this catches obvious cases early.
  const normalized = path.posix.normalize(value);
  if (normalized !== value) return false;
  if (normalized.includes("..")) return false;
  return true;
}
