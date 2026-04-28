import type { JournalState, ProcessedSessionRecord } from "./state.js";

export interface SessionFileMeta {
  id: string;
  // mtime in ms — sessions have no version counter, so this is the only signal we have for "file changed".
  mtimeMs: number;
}

export interface DirtySessionDecision {
  dirty: string[];
  // Previously-processed sessions whose files have vanished — informational, not an error.
  missing: string[];
}

// Treats unknown-mtime as dirty (safer to re-ingest than miss). Active mid-write sessions are filtered by the caller.
export function findDirtySessions(current: readonly SessionFileMeta[], processed: Record<string, ProcessedSessionRecord>): DirtySessionDecision {
  const dirty: string[] = [];
  const seenNow = new Set<string>();

  for (const meta of current) {
    seenNow.add(meta.id);
    const prev = processed[meta.id];
    if (!prev) {
      dirty.push(meta.id);
      continue;
    }
    if (meta.mtimeMs > prev.lastMtimeMs) {
      dirty.push(meta.id);
    }
  }

  const missing: string[] = [];
  for (const sessionId of Object.keys(processed)) {
    if (!seenNow.has(sessionId)) missing.push(sessionId);
  }

  return { dirty, missing };
}

export function applyProcessed(previous: JournalState["processedSessions"], justProcessed: readonly SessionFileMeta[]): JournalState["processedSessions"] {
  const next: JournalState["processedSessions"] = { ...previous };
  for (const meta of justProcessed) {
    next[meta.id] = { lastMtimeMs: meta.mtimeMs };
  }
  return next;
}
