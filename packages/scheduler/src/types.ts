// Scheduler type definitions. Pure library — zero external dependencies.

// ── Constants ────────────────────────────────────────────────────

export const SCHEDULE_TYPES = {
  interval: "interval",
  daily: "daily",
  weekly: "weekly",
  once: "once",
} as const;
export type ScheduleType = (typeof SCHEDULE_TYPES)[keyof typeof SCHEDULE_TYPES];

export const MISSED_RUN_POLICIES = {
  skip: "skip",
  runOnce: "run-once",
  runAll: "run-all",
} as const;

export const TASK_RESULTS = {
  success: "success",
  error: "error",
  skipped: "skipped",
} as const;
export type TaskResult = (typeof TASK_RESULTS)[keyof typeof TASK_RESULTS];

export const TASK_TRIGGERS = {
  scheduled: "scheduled",
  catchUp: "catch-up",
  manual: "manual",
} as const;
export type TaskTrigger = (typeof TASK_TRIGGERS)[keyof typeof TASK_TRIGGERS];

export const TASK_ORIGINS = {
  system: "system",
  skill: "skill",
  user: "user",
} as const;

// ── Schedule ─────────────────────────────────────────────────────

/** When a task should fire. All times are UTC. */
export type TaskSchedule =
  | { type: typeof SCHEDULE_TYPES.interval; intervalSec: number }
  | { type: typeof SCHEDULE_TYPES.daily; time: string } // "HH:MM" UTC
  | { type: typeof SCHEDULE_TYPES.weekly; daysOfWeek: number[]; time: string } // 0=Sun..6=Sat
  | { type: typeof SCHEDULE_TYPES.once; at: string }; // ISO 8601 UTC

// ── Missed-run policy ────────────────────────────────────────────

/** What to do when the scheduler discovers missed windows. */
export type MissedRunPolicy = (typeof MISSED_RUN_POLICIES)[keyof typeof MISSED_RUN_POLICIES];

// ── Task origin ──────────────────────────────────────────────────

export type TaskOrigin =
  | { kind: typeof TASK_ORIGINS.system; module: string }
  | { kind: typeof TASK_ORIGINS.skill; skillPath: string }
  | { kind: typeof TASK_ORIGINS.user };

// ── Execution context ────────────────────────────────────────────

/** Passed to every task executor so it knows *which window* it's
 *  running for (critical for run-all catch-up). */
export interface TaskRunContext {
  scheduledFor: string; // ISO 8601 UTC — the window this run targets
  trigger: TaskTrigger;
}

// ── Persisted task state ─────────────────────────────────────────

export interface TaskExecutionState {
  taskId: string;
  lastRunAt: string | null; // ISO UTC — null = never run
  lastRunResult: TaskResult | null;
  lastRunDurationMs: number | null;
  lastErrorMessage: string | null;
  consecutiveFailures: number;
  totalRuns: number;
  nextScheduledAt: string | null; // pre-computed for UI display
}

export function emptyState(taskId: string): TaskExecutionState {
  return {
    taskId,
    lastRunAt: null,
    lastRunResult: null,
    lastRunDurationMs: null,
    lastErrorMessage: null,
    consecutiveFailures: 0,
    totalRuns: 0,
    nextScheduledAt: null,
  };
}

// ── Execution log entry ──────────────────────────────────────────

export interface TaskLogEntry {
  taskId: string;
  taskName: string;
  scheduledFor: string;
  startedAt: string;
  completedAt: string;
  result: TaskResult;
  durationMs: number;
  trigger: TaskTrigger;
  errorMessage?: string;
  chatSessionId?: string;
}
