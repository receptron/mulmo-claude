// Catch-up algorithm. Pure function — no I/O, no side effects.
// Given task definitions + their persisted states + the current
// time, produces a list of runs that need to happen to bring
// each task up to date after a gap (server restart, laptop sleep,
// crash recovery).

import type { TaskSchedule, MissedRunPolicy, TaskRunContext, TaskExecutionState } from "./types.js";
import { TASK_TRIGGERS, MISSED_RUN_POLICIES } from "./types.js";
import { listMissedWindows } from "./windows.js";

/** Default cap for run-all catch-up (1 day of hourly tasks). */
const DEFAULT_MAX_CATCHUP = 24;

export interface CatchUpTask {
  id: string;
  name: string;
  schedule: TaskSchedule;
  missedRunPolicy: MissedRunPolicy;
  enabled: boolean;
}

export interface CatchUpRun {
  taskId: string;
  taskName: string;
  context: TaskRunContext;
}

export interface CatchUpPlan {
  runs: CatchUpRun[];
  skipped: Array<{
    taskId: string;
    windowCount: number;
    firstWindow: string;
    lastWindow: string;
  }>;
}

/**
 * Compute catch-up runs for all tasks. Called on startup and when
 * the tick loop detects a gap (laptop sleep → wake).
 *
 * Each task's `missedRunPolicy` determines how missed windows are
 * handled:
 *   - "skip":     advance lastRunAt, log the skip, no runs
 *   - "run-once": one run targeting the LATEST missed window
 *   - "run-all":  one run per missed window (oldest first), capped
 *                 at maxCatchUp (default 24 = 1 day of hourly tasks)
 */
export function computeCatchUpPlan(
  tasks: readonly CatchUpTask[],
  states: ReadonlyMap<string, TaskExecutionState>,
  nowMs: number,
  maxCatchUp = DEFAULT_MAX_CATCHUP,
): CatchUpPlan {
  const runs: CatchUpRun[] = [];
  const skipped: CatchUpPlan["skipped"] = [];

  for (const task of tasks) {
    if (!task.enabled) continue;
    const state = states.get(task.id);
    // Never-run tasks: treat as "just registered" — no catch-up
    // from epoch. Only catch up from the current time onward.
    const lastRunMs = state?.lastRunAt ? new Date(state.lastRunAt).getTime() : nowMs;

    const windows = listMissedWindows(task.schedule, lastRunMs, nowMs, maxCatchUp);
    if (windows.length === 0) continue;

    const planForTask = applyPolicy(task, windows, maxCatchUp);
    runs.push(...planForTask.runs);
    if (planForTask.skipped) skipped.push(planForTask.skipped);
  }

  return { runs, skipped };
}

// ── Internal ─────────────────────────────────────────────────────

function applyPolicy(task: CatchUpTask, windows: number[], maxCatchUp: number): { runs: CatchUpRun[]; skipped?: CatchUpPlan["skipped"][number] } {
  const toIso = (ms: number) => new Date(ms).toISOString();

  if (task.missedRunPolicy === MISSED_RUN_POLICIES.skip) {
    return {
      runs: [],
      skipped: {
        taskId: task.id,
        windowCount: windows.length,
        firstWindow: toIso(windows[0]),
        lastWindow: toIso(windows[windows.length - 1]),
      },
    };
  }

  if (task.missedRunPolicy === MISSED_RUN_POLICIES.runOnce) {
    // Use the LATEST missed window — the most relevant to catch up on.
    return {
      runs: [
        {
          taskId: task.id,
          taskName: task.name,
          context: {
            scheduledFor: toIso(windows[windows.length - 1]),
            trigger: TASK_TRIGGERS.catchUp,
          },
        },
      ],
    };
  }

  // "run-all" — one run per window, oldest first, capped.
  const capped = windows.slice(0, maxCatchUp);
  return {
    runs: capped.map((w) => ({
      taskId: task.id,
      taskName: task.name,
      context: {
        scheduledFor: toIso(w),
        trigger: TASK_TRIGGERS.catchUp,
      },
    })),
  };
}
