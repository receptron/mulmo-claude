import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { WORKSPACE_DIRS, WORKSPACE_PATHS } from "../../workspace/paths.js";
import { resolveWithinRoot } from "./safe.js";

const SPREADSHEETS_DIR = WORKSPACE_PATHS.spreadsheets;

// Cached realpath of the spreadsheets directory. resolveWithinRoot
// requires its root argument to be a realpath so symlinks are handled
// correctly. Matches the pattern used in image-store.ts.
let spreadsheetsDirReal: string | null = null;

async function ensureSpreadsheetsDir(): Promise<string> {
  if (spreadsheetsDirReal) return spreadsheetsDirReal;
  await fs.mkdir(SPREADSHEETS_DIR, { recursive: true });
  spreadsheetsDirReal = await fs.realpath(SPREADSHEETS_DIR);
  return spreadsheetsDirReal;
}

// Resolve a workspace-relative spreadsheet path (e.g. "spreadsheets/abc.json")
// into an absolute path guaranteed to be inside the spreadsheets directory.
// Throws on traversal attempts.
async function safeResolve(relativePath: string): Promise<string> {
  const root = await ensureSpreadsheetsDir();
  // Strip the leading "spreadsheets/" prefix so callers can pass either
  // the stored form or just the filename.
  const name = relativePath.replace(
    new RegExp(`^${WORKSPACE_DIRS.spreadsheets}/`),
    "",
  );
  const result = resolveWithinRoot(root, name);
  if (!result) {
    throw new Error(`path traversal rejected: ${relativePath}`);
  }
  return result;
}

/** Save sheets array as a JSON file. Returns the workspace-relative path. */
export async function saveSpreadsheet(sheets: unknown[]): Promise<string> {
  await ensureSpreadsheetsDir();
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const filename = `${id}.json`;
  await fs.writeFile(
    path.join(SPREADSHEETS_DIR, filename),
    JSON.stringify(sheets),
    "utf-8",
  );
  return `${WORKSPACE_DIRS.spreadsheets}/${filename}`;
}

/** Overwrite an existing spreadsheet file. */
export async function overwriteSpreadsheet(
  relativePath: string,
  sheets: unknown[],
): Promise<void> {
  const absPath = await safeResolve(relativePath);
  await fs.writeFile(absPath, JSON.stringify(sheets), "utf-8");
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
