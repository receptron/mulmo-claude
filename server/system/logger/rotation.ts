import { mkdir, readdir, unlink } from "fs/promises";
import path from "path";

export function dailyFileName(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `server-${y}-${m}-${d}.log`;
}

const LOG_FILENAME_RE = /^server-\d{4}-\d{2}-\d{2}\.log$/;

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

// List log files in `dir`, newest first (by file name — our names are
// ISO-sortable so string desc = chronological desc).
export async function listLogFiles(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  return entries
    .filter((e) => LOG_FILENAME_RE.test(e))
    .sort()
    .reverse();
}

export async function enforceMaxFiles(dir: string, maxFiles: number): Promise<void> {
  if (maxFiles <= 0) return;
  const files = await listLogFiles(dir);
  const toDelete = files.slice(maxFiles);
  await Promise.all(toDelete.map((f) => unlink(path.join(dir, f)).catch(() => {})));
}
