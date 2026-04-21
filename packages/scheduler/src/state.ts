// Scheduler state persistence. Loads and saves a JSON file mapping
// taskId → TaskExecutionState. Atomic write via tmp + rename so a
// crash mid-write never corrupts the state file.
//
// The I/O layer is thin and injected via `deps` so tests can swap
// it for an in-memory store.

import type { TaskExecutionState } from "./types.js";
import { emptyState } from "./types.js";

/** What the persistence layer needs from the host environment. */
export interface StateDeps {
  readFile: (path: string) => Promise<string>;
  writeFileAtomic: (path: string, content: string) => Promise<void>;
  exists: (path: string) => boolean;
}

export type StateMap = Map<string, TaskExecutionState>;

/** Load state.json → Map. Returns empty map on missing / corrupt file. */
export async function loadState(filePath: string, deps: StateDeps): Promise<StateMap> {
  if (!deps.exists(filePath)) return new Map();
  try {
    const raw = await deps.readFile(filePath);
    const parsed: unknown = JSON.parse(raw);
    if (!isStateRecord(parsed)) return new Map();
    const map = new Map<string, TaskExecutionState>();
    for (const [id, entry] of Object.entries(parsed)) {
      // Only spread if entry is a plain object — strings, numbers,
      // arrays would produce a malformed state.
      if (isPartialState(entry)) {
        map.set(id, { ...emptyState(id), ...entry });
      } else {
        map.set(id, emptyState(id));
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

/** Save Map → state.json (atomic). */
export async function saveState(filePath: string, states: ReadonlyMap<string, TaskExecutionState>, deps: StateDeps): Promise<void> {
  const obj: Record<string, TaskExecutionState> = {};
  for (const [id, s] of states) {
    obj[id] = s;
  }
  await deps.writeFileAtomic(filePath, JSON.stringify(obj, null, 2));
}

/** Update a single task's state in the map and persist. */
export async function updateAndSave(filePath: string, states: StateMap, taskId: string, patch: Partial<TaskExecutionState>, deps: StateDeps): Promise<void> {
  const current = states.get(taskId) ?? emptyState(taskId);
  states.set(taskId, { ...current, ...patch });
  await saveState(filePath, states, deps);
}

function isStateRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isPartialState(v: unknown): v is Partial<TaskExecutionState> {
  if (!isStateRecord(v)) return false;
  // Check key fields have expected types when present
  if ("taskId" in v && typeof v.taskId !== "string") return false;
  if ("totalRuns" in v && typeof v.totalRuns !== "number") return false;
  return true;
}
