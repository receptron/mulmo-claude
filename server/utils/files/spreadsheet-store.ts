import { mkdir, realpath } from "fs/promises";
import path from "path";
import { WORKSPACE_DIRS, WORKSPACE_PATHS } from "../../workspace/paths.js";
import { shortId } from "../id.js";
import { writeFileAtomic } from "./atomic.js";
import { yearMonthUtc } from "./naming.js";
import { resolveWithinRoot } from "./safe.js";

const SPREADSHEETS_DIR = WORKSPACE_PATHS.spreadsheets;

// resolveWithinRoot needs a realpath as its root so symlinks resolve correctly (same pattern as image-store).
let spreadsheetsDirReal: string | null = null;

async function ensureSpreadsheetsDir(): Promise<string> {
  if (spreadsheetsDirReal) return spreadsheetsDirReal;
  await mkdir(SPREADSHEETS_DIR, { recursive: true });
  spreadsheetsDirReal = await realpath(SPREADSHEETS_DIR);
  return spreadsheetsDirReal;
}

// Throws on traversal. Strips a leading "spreadsheets/" so callers can pass either the stored form or bare filename.
async function safeResolve(relativePath: string): Promise<string> {
  const root = await ensureSpreadsheetsDir();
  const name = relativePath.replace(new RegExp(`^${WORKSPACE_DIRS.spreadsheets}/`), "");
  const result = resolveWithinRoot(root, name);
  if (!result) {
    throw new Error(`path traversal rejected: ${relativePath}`);
  }
  return result;
}

// #764 sharded under spreadsheets/YYYY/MM/ (UTC) so the dir doesn't grow unbounded; #881 atomic.
export async function saveSpreadsheet(sheets: unknown[]): Promise<string> {
  await ensureSpreadsheetsDir();
  const partition = yearMonthUtc();
  const filename = `${shortId()}.json`;
  const absPath = path.join(SPREADSHEETS_DIR, partition, filename);
  await writeFileAtomic(absPath, JSON.stringify(sheets));
  return path.posix.join(WORKSPACE_DIRS.spreadsheets, partition, filename);
}

export async function overwriteSpreadsheet(relativePath: string, sheets: unknown[]): Promise<void> {
  const absPath = await safeResolve(relativePath);
  await writeFileAtomic(absPath, JSON.stringify(sheets));
}

// Reject "spreadsheets/../outside.json" early; realpath check still runs server-side, but catch obvious cases here.
export function isSpreadsheetPath(value: string): boolean {
  if (!value.startsWith(`${WORKSPACE_DIRS.spreadsheets}/`)) return false;
  if (!value.endsWith(".json")) return false;
  const normalized = path.posix.normalize(value);
  if (normalized !== value) return false;
  if (normalized.includes("..")) return false;
  return true;
}
