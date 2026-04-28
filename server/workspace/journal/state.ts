import {
  readJournalState as readJournalStateRaw,
  writeJournalState as writeJournalStateRaw,
  journalStateExists as journalStateExistsRaw,
} from "../../utils/files/journal-io.js";
import { ONE_HOUR_MS, ONE_DAY_MS } from "../../utils/time.js";
import { log } from "../../system/logger/index.js";
import { isRecord } from "../../utils/types.js";

// Bump on backwards-incompatible schema changes — older state files
// are discarded and rebuilt (one extra archivist pass).
export const JOURNAL_STATE_VERSION = 1;

export interface ProcessedSessionRecord {
  // mtime at last ingest; advance triggers re-ingest of appended events.
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

// Forgiving toward partial / hand-edited input — fill defaults instead of throwing.
export function parseState(raw: unknown): JournalState {
  if (!isRecord(raw)) return defaultState();
  const obj = raw as Record<string, unknown>;

  // Log the version-mismatch reset (#799 PR1) so postmortems can tell
  // it apart from a missing-file first run.
  if (obj.version !== JOURNAL_STATE_VERSION) {
    log.info("journal", "state schema version mismatch — resetting", {
      from: obj.version,
      to: JOURNAL_STATE_VERSION,
    });
    return defaultState();
  }

  const fallback = defaultState();
  return {
    version: JOURNAL_STATE_VERSION,
    lastDailyRunAt: typeof obj.lastDailyRunAt === "string" ? obj.lastDailyRunAt : null,
    lastOptimizationRunAt: typeof obj.lastOptimizationRunAt === "string" ? obj.lastOptimizationRunAt : null,
    dailyIntervalHours: typeof obj.dailyIntervalHours === "number" && obj.dailyIntervalHours > 0 ? obj.dailyIntervalHours : fallback.dailyIntervalHours,
    optimizationIntervalDays:
      typeof obj.optimizationIntervalDays === "number" && obj.optimizationIntervalDays > 0 ? obj.optimizationIntervalDays : fallback.optimizationIntervalDays,
    processedSessions: parseProcessedSessions(obj.processedSessions),
    knownTopics: Array.isArray(obj.knownTopics) ? obj.knownTopics.filter((topic): topic is string => typeof topic === "string") : [],
  };
}

function parseProcessedSessions(raw: unknown): Record<string, ProcessedSessionRecord> {
  if (!isRecord(raw)) return {};
  const out: Record<string, ProcessedSessionRecord> = {};
  for (const [sessionId, rec] of Object.entries(raw as Record<string, unknown>)) {
    if (!isRecord(rec)) continue;
    const mtime = (rec as Record<string, unknown>).lastMtimeMs;
    if (typeof mtime === "number" && mtime >= 0) {
      out[sessionId] = { lastMtimeMs: mtime };
    }
  }
  return out;
}

export function isDailyDue(state: JournalState, nowMs: number): boolean {
  if (state.lastDailyRunAt === null) return true;
  const last = Date.parse(state.lastDailyRunAt);
  if (Number.isNaN(last)) return true;
  const intervalMs = state.dailyIntervalHours * ONE_HOUR_MS;
  return nowMs - last >= intervalMs;
}

export function isOptimizationDue(state: JournalState, nowMs: number): boolean {
  if (state.lastOptimizationRunAt === null) return true;
  const last = Date.parse(state.lastOptimizationRunAt);
  if (Number.isNaN(last)) return true;
  const intervalMs = state.optimizationIntervalDays * ONE_DAY_MS;
  return nowMs - last >= intervalMs;
}

export async function readState(workspaceRoot: string): Promise<JournalState> {
  const raw = await readJournalStateRaw<unknown>(null, workspaceRoot);
  return parseState(raw);
}

export async function writeState(workspaceRoot: string, state: JournalState): Promise<void> {
  await writeJournalStateRaw(state, workspaceRoot);
}

export function stateFileExists(workspaceRoot: string): boolean {
  return journalStateExistsRaw(workspaceRoot);
}
