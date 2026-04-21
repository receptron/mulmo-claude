// "Which sessions are new or have changed since the last journal
// run?" — pure logic that takes in-memory representations of the
// current filesystem and the persisted state, and returns the list
// of session ids that need re-ingest.
//
// Extracted from the filesystem layer so tests can exercise it with
// hand-rolled inputs instead of mocking `fs`.

import type { JournalState, ProcessedSessionRecord } from "./state.js";

export interface SessionFileMeta {
  // Session id (matches the .jsonl filename without extension).
  id: string;
  // mtime in ms since epoch. The only signal we use to detect
  // appends — sessions don't have a version counter.
  mtimeMs: number;
}

export interface DirtySessionDecision {
  dirty: string[];
  // Sessions already in state whose files have vanished from disk.
  // We keep them in the state record (no harm) but the caller may
  // choose to prune them separately.
  missing: string[];
}

// Core diff. Given the current directory listing and the persisted
// processed-sessions record, return:
//   - `dirty`: sessions that were never seen, or whose mtime has
//     advanced since we last ingested them, or whose mtime we don't
//     have a record of (treat as dirty — safer to re-ingest than miss).
//   - `missing`: sessions we had previously processed that no longer
//     exist on disk. Not an error, just information.
//
// The caller may additionally exclude currently-active sessions
// (whose jsonl could be mid-write); that's a separate concern and
// kept out of the pure diff.
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
  for (const id of Object.keys(processed)) {
    if (!seenNow.has(id)) missing.push(id);
  }

  return { dirty, missing };
}

// Produce the next processedSessions map after a successful ingest
// of the given dirty ids. Pure — doesn't mutate input. Sessions not
// in the dirty list keep their existing record.
export function applyProcessed(previous: JournalState["processedSessions"], justProcessed: readonly SessionFileMeta[]): JournalState["processedSessions"] {
  const next: JournalState["processedSessions"] = { ...previous };
  for (const meta of justProcessed) {
    next[meta.id] = { lastMtimeMs: meta.mtimeMs };
  }
  return next;
}
