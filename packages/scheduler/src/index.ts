// @receptron/task-scheduler — public API surface.
// Pure library, zero host dependencies.

export type {
  ScheduleType,
  TaskSchedule,
  MissedRunPolicy,
  TaskOrigin,
  TaskResult,
  TaskTrigger,
  TaskRunContext,
  TaskExecutionState,
  TaskLogEntry,
} from "./types.js";
export { SCHEDULE_TYPES, MISSED_RUN_POLICIES, TASK_RESULTS, TASK_TRIGGERS, TASK_ORIGINS, emptyState } from "./types.js";

export { nextWindowAfter, listMissedWindows, isDueAt, parseTimeToMs } from "./windows.js";

export type { CatchUpTask, CatchUpRun, CatchUpPlan } from "./catchup.js";
export { computeCatchUpPlan } from "./catchup.js";

export type { StateDeps, StateMap } from "./state.js";
export { loadState, saveState, updateAndSave } from "./state.js";

export type { LogDeps } from "./log.js";
export { appendLogEntry, queryLog, logFilePathFor } from "./log.js";
