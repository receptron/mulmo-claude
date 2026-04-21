// Execution log — append-only JSONL. One file per day, rotated
// automatically. Query function reads recent entries.
//
// I/O is injected via deps so tests can use in-memory storage.

import type { TaskLogEntry } from "./types.js";
import { toUtcIsoDate } from "./date.js";

const DEFAULT_QUERY_LIMIT = 50;

/** What the log layer needs from the host environment. */
export interface LogDeps {
  appendFile: (path: string, content: string) => Promise<void>;
  readFile: (path: string) => Promise<string>;
  exists: (path: string) => boolean;
  ensureDir: (path: string) => Promise<void>;
}

/** Build the log file path for a given date. */
export function logFilePathFor(logsDir: string, date: Date): string {
  return `${logsDir}/${toUtcIsoDate(date)}.jsonl`;
}

/** Append a log entry to today's JSONL file. */
export async function appendLogEntry(logsDir: string, entry: TaskLogEntry, deps: LogDeps): Promise<void> {
  await deps.ensureDir(logsDir);
  const filePath = logFilePathFor(logsDir, new Date(entry.startedAt));
  await deps.appendFile(filePath, JSON.stringify(entry) + "\n");
}

/** Read log entries, newest first, with optional filters. */
export async function queryLog(
  logsDir: string,
  opts: {
    since?: string; // ISO — only entries after this time
    taskId?: string;
    limit?: number;
    /** Override "today" for testing. Defaults to `new Date()`. */
    date?: Date;
  },
  deps: LogDeps,
): Promise<TaskLogEntry[]> {
  const limit = opts.limit ?? DEFAULT_QUERY_LIMIT;
  const sinceMs = opts.since ? new Date(opts.since).getTime() : 0;

  // Read the target day's log (single-day query for now).
  const filePath = logFilePathFor(logsDir, opts.date ?? new Date());
  if (!deps.exists(filePath)) return [];

  let raw: string;
  try {
    raw = await deps.readFile(filePath);
  } catch {
    return [];
  }

  const entries: TaskLogEntry[] = [];
  const lines = raw.split("\n").filter(Boolean);
  // Reverse so newest first.
  for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
    try {
      const entry: TaskLogEntry = JSON.parse(lines[i]);
      if (sinceMs > 0 && new Date(entry.startedAt).getTime() < sinceMs) {
        continue;
      }
      if (opts.taskId && entry.taskId !== opts.taskId) continue;
      entries.push(entry);
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}
