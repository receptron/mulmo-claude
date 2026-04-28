// Adapter that wires the pure scheduler library (server/utils/scheduler/)
// to the MulmoClaude runtime. Registers system tasks, runs catch-up on
// startup, and persists execution state + logs.
//
// Deliberately thin — all complex logic lives in the scheduler library.
// This file's job is I/O binding and MulmoClaude-specific plumbing.

import { existsSync } from "fs";
import { readFile, appendFile, mkdir } from "fs/promises";
import path from "path";
import { workspacePath } from "../workspace/workspace.js";
import { writeFileAtomic } from "../utils/files/atomic.js";
import { log } from "../system/logger/index.js";
import { errorMessage } from "../utils/errors.js";
import { ONE_SECOND_MS } from "../utils/time.js";
import type { ITaskManager, TaskDefinition } from "./task-manager/index.js";
import {
  type TaskSchedule,
  type TaskExecutionState,
  type TaskLogEntry,
  type CatchUpTask,
  type TaskTrigger,
  emptyState,
  computeCatchUpPlan,
  nextWindowAfter,
  loadState,
  updateAndSave,
  appendLogEntry,
  queryLog,
  SCHEDULE_TYPES,
  TASK_RESULTS,
  TASK_TRIGGERS,
  MISSED_RUN_POLICIES,
  type StateMap,
  type StateDeps,
  type LogDeps,
} from "@receptron/task-scheduler";

// ── Paths ────────────────────────────────────────────────────────

const SCHEDULER_CONFIG_DIR = "config/scheduler";
const SCHEDULER_DATA_DIR = "data/scheduler/logs";

function stateFilePath(root = workspacePath): string {
  return path.join(root, SCHEDULER_CONFIG_DIR, "state.json");
}

function logsDir(root = workspacePath): string {
  return path.join(root, SCHEDULER_DATA_DIR);
}

// ── I/O deps (real filesystem) ───────────────────────────────────

const stateDeps: StateDeps = {
  readFile: (filePath: string) => readFile(filePath, "utf-8"),
  writeFileAtomic: (filePath: string, content: string) => writeFileAtomic(filePath, content),
  exists: existsSync,
};

const logDeps: LogDeps = {
  appendFile: (filePath: string, content: string) => appendFile(filePath, content),
  readFile: (filePath: string) => readFile(filePath, "utf-8"),
  exists: existsSync,
  ensureDir: (directoryPath: string) => mkdir(directoryPath, { recursive: true }).then(() => {}),
};

// ── System task registry ─────────────────────────────────────────

export interface SystemTaskDef {
  id: string;
  name: string;
  description: string;
  schedule: TaskDefinition["schedule"];
  missedRunPolicy: typeof MISSED_RUN_POLICIES.skip | typeof MISSED_RUN_POLICIES.runOnce | typeof MISSED_RUN_POLICIES.runAll;
  run: () => Promise<void>;
}

// ── Public API ───────────────────────────────────────────────────

let stateMap: StateMap = new Map();
const systemTasks: SystemTaskDef[] = [];
let taskManagerRef: ITaskManager | null = null;

/**
 * Initialize the scheduler adapter. Call once at server startup
 * AFTER the task-manager is created but BEFORE `taskManager.start()`.
 */
export async function initScheduler(taskManager: ITaskManager, tasks: SystemTaskDef[]): Promise<void> {
  await mkdir(path.dirname(stateFilePath()), { recursive: true });
  await mkdir(logsDir(), { recursive: true });

  stateMap = await loadState(stateFilePath(), stateDeps);
  systemTasks.length = 0;
  systemTasks.push(...tasks);
  taskManagerRef = taskManager;

  // Run catch-up
  const catchUpTasks: CatchUpTask[] = tasks.map((taskDef) => ({
    id: taskDef.id,
    name: taskDef.name,
    schedule: toCoreSchedule(taskDef.schedule),
    missedRunPolicy: taskDef.missedRunPolicy,
    enabled: true,
  }));
  const plan = computeCatchUpPlan(catchUpTasks, stateMap, Date.now());

  for (const skip of plan.skipped) {
    log.info("scheduler", "catch-up skipped", {
      taskId: skip.taskId,
      windows: skip.windowCount,
    });
    await safeUpdateState(skip.taskId, { lastRunAt: skip.lastWindow });
  }

  if (plan.runs.length > 0) {
    log.info("scheduler", "catch-up enqueued", {
      runs: plan.runs.length,
    });
    for (const run of plan.runs) {
      const task = tasks.find((taskDef) => taskDef.id === run.taskId);
      if (!task) continue;
      await executeAndLog(task, run.context.scheduledFor, TASK_TRIGGERS.catchUp);
    }
  }

  // Register with task-manager for ongoing ticks
  for (const task of tasks) {
    taskManager.registerTask({
      id: task.id,
      description: task.description,
      schedule: task.schedule,
      run: async () => {
        const windowIso = computeCurrentWindow(task);
        await executeAndLog(task, windowIso, TASK_TRIGGERS.scheduled);
      },
    });
  }

  log.info("scheduler", "initialized", {
    tasks: tasks.map((taskDef) => taskDef.id),
    stateEntries: stateMap.size,
  });
}

/** Apply a schedule override to a running system task.
 *  Updates the in-memory task definition, the task-manager, and
 *  recalculates nextScheduledAt in persisted state. */
export async function applyScheduleOverride(taskId: string, schedule: SystemTaskDef["schedule"]): Promise<boolean> {
  const task = systemTasks.find((taskDef) => taskDef.id === taskId);
  if (!task || !taskManagerRef) return false;
  if (!taskManagerRef.updateSchedule(taskId, schedule)) return false;
  task.schedule = schedule;

  // Recalculate next window so the UI reflects the new schedule
  const nextScheduledAt = computeNextScheduled(task);
  await safeUpdateState(taskId, { nextScheduledAt });

  return true;
}

/** Query execution logs — used by API routes. */
export async function getSchedulerLogs(opts: { since?: string; taskId?: string; limit?: number }): Promise<TaskLogEntry[]> {
  return queryLog(logsDir(), opts, logDeps);
}

/** Get all task states — used by API routes. */
export function getSchedulerTasks(): {
  id: string;
  name: string;
  description: string;
  schedule: TaskDefinition["schedule"];
  missedRunPolicy: string;
  state: TaskExecutionState;
}[] {
  return systemTasks.map((taskDef) => ({
    id: taskDef.id,
    name: taskDef.name,
    description: taskDef.description,
    schedule: taskDef.schedule,
    missedRunPolicy: taskDef.missedRunPolicy,
    state: stateMap.get(taskDef.id) ?? emptyState(taskDef.id),
  }));
}

// ── Internal ─────────────────────────────────────────────────────

async function executeAndLog(task: SystemTaskDef, scheduledFor: string, trigger: TaskTrigger): Promise<void> {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  let errMsg: string | null = null;
  try {
    await task.run();
  } catch (err) {
    errMsg = errorMessage(err);
    log.error("scheduler", "task failed", {
      taskId: task.id,
      error: errMsg,
    });
  }
  const durationMs = Date.now() - startMs;
  // Persistence is best-effort — never let disk failures propagate
  // to the tick loop or abort startup catch-up.
  await safePersist(task, scheduledFor, startedAt, durationMs, trigger, errMsg);
}

/** Best-effort persistence — state and log are independent. A failure
 *  in one does not block the other, and neither propagates upward. */
async function safePersist(
  task: SystemTaskDef,
  scheduledFor: string,
  startedAt: string,
  durationMs: number,
  trigger: TaskTrigger,
  errMsg: string | null,
): Promise<void> {
  const isSuccess = errMsg === null;
  const currentState = stateMap.get(task.id);
  try {
    await updateAndSave(
      stateFilePath(),
      stateMap,
      task.id,
      {
        lastRunAt: scheduledFor,
        lastRunResult: isSuccess ? TASK_RESULTS.success : TASK_RESULTS.error,
        lastRunDurationMs: durationMs,
        lastErrorMessage: errMsg,
        consecutiveFailures: isSuccess ? 0 : (currentState?.consecutiveFailures ?? 0) + 1,
        totalRuns: (currentState?.totalRuns ?? 0) + 1,
        nextScheduledAt: computeNextScheduled(task),
      },
      stateDeps,
    );
  } catch (err) {
    log.warn("scheduler", "state persistence failed", {
      taskId: task.id,
      error: String(err),
    });
  }
  try {
    await appendLogEntry(
      logsDir(),
      {
        taskId: task.id,
        taskName: task.name,
        scheduledFor,
        startedAt,
        completedAt: new Date().toISOString(),
        result: isSuccess ? TASK_RESULTS.success : TASK_RESULTS.error,
        durationMs,
        trigger,
        ...(errMsg !== null && { errorMessage: errMsg }),
      },
      logDeps,
    );
  } catch (err) {
    log.warn("scheduler", "log persistence failed", {
      taskId: task.id,
      error: String(err),
    });
  }
}

/** Safe state update — swallows errors. */
async function safeUpdateState(taskId: string, patch: Partial<TaskExecutionState>): Promise<void> {
  try {
    await updateAndSave(stateFilePath(), stateMap, taskId, patch, stateDeps);
  } catch (err) {
    log.warn("scheduler", "state update failed", {
      taskId,
      error: String(err),
    });
  }
}

/** Compute the window boundary that the current tick belongs to.
 *  For scheduled runs, this is the epoch-aligned window — not the
 *  wall-clock time of execution. This keeps lastRunAt consistent
 *  with catch-up's window-based accounting. */
function computeCurrentWindow(task: SystemTaskDef): string {
  const coreSchedule = toCoreSchedule(task.schedule);
  // The window that just fired is the latest one at or before now.
  const nowMs = Date.now();
  const windowMs = nextWindowAfter(coreSchedule, nowMs - (coreSchedule.type === SCHEDULE_TYPES.interval ? coreSchedule.intervalSec * ONE_SECOND_MS : 0));
  return windowMs !== null && windowMs <= nowMs ? new Date(windowMs).toISOString() : new Date(nowMs).toISOString();
}

function computeNextScheduled(task: SystemTaskDef): string | null {
  const coreSchedule = toCoreSchedule(task.schedule);
  const next = nextWindowAfter(coreSchedule, Date.now() + 1);
  return next !== null ? new Date(next).toISOString() : null;
}

function toCoreSchedule(schedule: TaskDefinition["schedule"]): TaskSchedule {
  if (schedule.type === SCHEDULE_TYPES.interval) {
    return {
      type: SCHEDULE_TYPES.interval,
      intervalSec: Math.round(schedule.intervalMs / ONE_SECOND_MS),
    };
  }
  return schedule;
}
