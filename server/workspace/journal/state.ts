// Journal state file schema + persistence. The state file tracks
// what the archivist has already done so we only re-process new or
// changed sessions on each run.
//
// The pure bits (default creation, schema validation, interval
// arithmetic) live at the top of the file so tests can exercise
// them without touching disk. Filesystem helpers at the bottom wrap
// those pure functions with atomic read/write.

import {
  readJournalState as readJournalStateRaw,
  writeJournalState as writeJournalStateRaw,
  journalStateExists as journalStateExistsRaw,
} from "../../utils/files/journal-io.js";

// Bump this when the schema changes in a backwards-incompatible way.
// Older state files are treated as corrupted and replaced with a
// fresh default (ingest everything from scratch) — cheap because it
// only costs one extra archivist pass.
export const JOURNAL_STATE_VERSION = 1;

export interface ProcessedSessionRecord {
  // mtime (ms since epoch) of the session's .jsonl file when we
  // last ingested it. If mtime advances on the next run, the session
  // has appended events and needs re-ingest.
  lastMtimeMs: number;
}

export interface JournalState {
  version: number;
  lastDailyRunAt: string | null;
  lastOptimizationRunAt: string | null;
  dailyIntervalHours: number;
  optimizationIntervalDays: number;
  processedSessions: Record<string, ProcessedSessionRecord>;
  knownTopics: string[];
}

export const DEFAULT_DAILY_INTERVAL_HOURS = 1;
export const DEFAULT_OPTIMIZATION_INTERVAL_DAYS = 7;

// --- Pure helpers (unit-testable without disk) ---------------------

export function defaultState(): JournalState {
  return {
    version: JOURNAL_STATE_VERSION,
    lastDailyRunAt: null,
    lastOptimizationRunAt: null,
    dailyIntervalHours: DEFAULT_DAILY_INTERVAL_HOURS,
    optimizationIntervalDays: DEFAULT_OPTIMIZATION_INTERVAL_DAYS,
    processedSessions: {},
    knownTopics: [],
  };
}

// Narrow an `unknown` into a JournalState. Accepts partial / missing
// fields and fills defaults — users can hand-edit the file to change
// intervals and we want to be forgiving.
export function parseState(raw: unknown): JournalState {
  if (typeof raw !== "object" || raw === null) return defaultState();
  const obj = raw as Record<string, unknown>;

  // Version mismatch → throw it all out. Cheap to rebuild.
  if (obj.version !== JOURNAL_STATE_VERSION) return defaultState();

  const d = defaultState();
  return {
    version: JOURNAL_STATE_VERSION,
    lastDailyRunAt:
      typeof obj.lastDailyRunAt === "string" ? obj.lastDailyRunAt : null,
    lastOptimizationRunAt:
      typeof obj.lastOptimizationRunAt === "string"
        ? obj.lastOptimizationRunAt
        : null,
    dailyIntervalHours:
      typeof obj.dailyIntervalHours === "number" && obj.dailyIntervalHours > 0
        ? obj.dailyIntervalHours
        : d.dailyIntervalHours,
    optimizationIntervalDays:
      typeof obj.optimizationIntervalDays === "number" &&
      obj.optimizationIntervalDays > 0
        ? obj.optimizationIntervalDays
        : d.optimizationIntervalDays,
    processedSessions: parseProcessedSessions(obj.processedSessions),
    knownTopics: Array.isArray(obj.knownTopics)
      ? obj.knownTopics.filter((t): t is string => typeof t === "string")
      : [],
  };
}

function parseProcessedSessions(
  raw: unknown,
): Record<string, ProcessedSessionRecord> {
  if (typeof raw !== "object" || raw === null) return {};
  const out: Record<string, ProcessedSessionRecord> = {};
  for (const [id, rec] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof rec !== "object" || rec === null) continue;
    const mtime = (rec as Record<string, unknown>).lastMtimeMs;
    if (typeof mtime === "number" && mtime >= 0) {
      out[id] = { lastMtimeMs: mtime };
    }
  }
  return out;
}

// Has the configured daily interval elapsed since the last run? A
// null lastDailyRunAt means "never run" → always due.
export function isDailyDue(state: JournalState, nowMs: number): boolean {
  if (state.lastDailyRunAt === null) return true;
  const last = Date.parse(state.lastDailyRunAt);
  if (Number.isNaN(last)) return true;
  const intervalMs = state.dailyIntervalHours * 60 * 60 * 1000;
  return nowMs - last >= intervalMs;
}

export function isOptimizationDue(state: JournalState, nowMs: number): boolean {
  if (state.lastOptimizationRunAt === null) return true;
  const last = Date.parse(state.lastOptimizationRunAt);
  if (Number.isNaN(last)) return true;
  const intervalMs = state.optimizationIntervalDays * 24 * 60 * 60 * 1000;
  return nowMs - last >= intervalMs;
}

// --- Filesystem helpers (delegated to journal-io) --------------------

export async function readState(workspaceRoot: string): Promise<JournalState> {
  const raw = await readJournalStateRaw<unknown>(null, workspaceRoot);
  return parseState(raw);
}

export async function writeState(
  workspaceRoot: string,
  state: JournalState,
): Promise<void> {
  await writeJournalStateRaw(state, workspaceRoot);
}

export function stateFileExists(workspaceRoot: string): boolean {
  return journalStateExistsRaw(workspaceRoot);
}
