// Adapter that wires the pure scheduler library (@receptron/task-scheduler)
// to a host's task-manager + workspace. Registers system tasks, runs
// catch-up on startup, and persists execution state + logs.
//
// Host-agnostic: the workspace root, the atomic file writer, and the
// logger are injected via `configureScheduler`. The host supplies its OWN
// system tasks (journal / feeds / user-cron in MulmoClaude) to
// `initScheduler` — the package owns no task definitions. Deliberately
// thin: all complex scheduling logic lives in @receptron/task-scheduler.

import { existsSync } from "node:fs";
import { readFile, appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
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
  type MISSED_RUN_POLICIES,
  type StateMap,
  type StateDeps,
  type LogDeps,
} from "@receptron/task-scheduler";
import type { ITaskManager, TaskDefinition, SchedulerLogger } from "./task-manager.js";
import { errorMessage } from "../utils/errors.js";

const ONE_SECOND_MS = 1000;
const SCHEDULER_CONFIG_DIR = "config/scheduler";
const SCHEDULER_DATA_DIR = "data/scheduler/logs";

// ── Host injection ────────────────────────────────────────────────

export interface SchedulerConfig {
  /** Absolute workspace root — state.json + logs hang off it. */
  workspaceRoot: string;
  /** Host atomic file writer (used with `uniqueTmp` for the state file). */
  writeFileAtomic: (filePath: string, content: string, opts: { uniqueTmp: boolean }) => Promise<void>;
  /** Optional logger. */
  log?: SchedulerLogger;
}

const NOOP_LOG: SchedulerLogger = { info: () => {}, warn: () => {}, error: () => {} };

let config: SchedulerConfig | null = null;

/** Wire the adapter to a host. Call once at startup, before `initScheduler`. */
export function configureScheduler(injected: SchedulerConfig): void {
  config = injected;
}

function requireConfig(): SchedulerConfig {
  if (!config) throw new Error("scheduler: configureScheduler() not called");
  return config;
}

function logger(): SchedulerLogger {
  return config?.log ?? NOOP_LOG;
}

// ── Paths ─────────────────────────────────────────────────────────

function stateFilePath(): string {
  return path.join(requireConfig().workspaceRoot, SCHEDULER_CONFIG_DIR, "state.json");
}

function logsDir(): string {
  return path.join(requireConfig().workspaceRoot, SCHEDULER_DATA_DIR);
}

// ── I/O deps (real filesystem) ────────────────────────────────────

function stateDeps(): StateDeps {
  return {
    readFile: (filePath: string) => readFile(filePath, "utf-8"),
    writeFileAtomic: (filePath: string, content: string) => requireConfig().writeFileAtomic(filePath, content, { uniqueTmp: true }),
    exists: existsSync,
  };
}

const logDeps: LogDeps = {
  appendFile: (filePath: string, content: string) => appendFile(filePath, content),
  readFile: (filePath: string) => readFile(filePath, "utf-8"),
  exists: existsSync,
  ensureDir: (directoryPath: string) => mkdir(directoryPath, { recursive: true }).then(() => {}),
};

// ── System task registry ──────────────────────────────────────────

export interface SystemTaskDef {
  id: string;
  name: string;
  description: string;
  schedule: TaskDefinition["schedule"];
  missedRunPolicy: typeof MISSED_RUN_POLICIES.skip | typeof MISSED_RUN_POLICIES.runOnce | typeof MISSED_RUN_POLICIES.runAll;
  run: () => Promise<void>;
}

// ── Public API ────────────────────────────────────────────────────

let stateMap: StateMap = new Map();
const systemTasks: SystemTaskDef[] = [];
let taskManagerRef: ITaskManager | null = null;

/**
 * Initialize the scheduler adapter. Call once at server startup AFTER the
 * task-manager is created but BEFORE `taskManager.start()`.
 */
export async function initScheduler(taskManager: ITaskManager, tasks: SystemTaskDef[]): Promise<void> {
  await mkdir(path.dirname(stateFilePath()), { recursive: true });
  await mkdir(logsDir(), { recursive: true });

  stateMap = await loadState(stateFilePath(), stateDeps());
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
    logger().info("catch-up skipped", { taskId: skip.taskId, windows: skip.windowCount });
    await safeUpdateState(skip.taskId, { lastRunAt: skip.lastWindow });
  }

  if (plan.runs.length > 0) {
    logger().info("catch-up enqueued", { runs: plan.runs.length });
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

  logger().info("initialized", { tasks: tasks.map((taskDef) => taskDef.id), stateEntries: stateMap.size });
}

/** Apply a schedule override to a running system task. Updates the
 *  in-memory task definition, the task-manager, and recalculates
 *  nextScheduledAt in persisted state. */
export async function applyScheduleOverride(taskId: string, schedule: SystemTaskDef["schedule"]): Promise<boolean> {
  const task = systemTasks.find((taskDef) => taskDef.id === taskId);
  if (!task || !taskManagerRef) return false;
  if (!taskManagerRef.updateSchedule(taskId, schedule)) return false;
  task.schedule = schedule;

  // Recalculate next window so the UI reflects the new schedule
  const nextScheduledAt = computeNextScheduledFor(task.schedule);
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

/** Read the persisted execution state for any task id (system, user, or
 *  skill). Returns an empty state when the id has never run — used by the API
 *  route to attach last-run / next-run / history state to user + skill tasks
 *  it lists from other sources. */
export function getSchedulerTaskState(taskId: string): TaskExecutionState {
  return stateMap.get(taskId) ?? emptyState(taskId);
}

/** Record a run of an EXTERNAL (skill / user) task — one registered directly
 *  on the task-manager rather than through `initScheduler`. Persists a log
 *  entry + updates state so these tasks get the same history / last-run /
 *  next-run as system tasks. Because they are fire-and-forget (`startChat`
 *  spawns an async chat), `errorMessage` reflects whether the *dispatch*
 *  succeeded, not the chat's eventual outcome; `chatSessionId` links the run
 *  to the spawned session. */
export async function recordExternalRun(params: {
  id: string;
  name: string;
  schedule: TaskDefinition["schedule"];
  scheduledFor: string;
  startedAt: string;
  durationMs: number;
  trigger: TaskTrigger;
  errorMessage: string | null;
  chatSessionId?: string;
}): Promise<void> {
  await persistRun({
    meta: { id: params.id, name: params.name, schedule: params.schedule },
    scheduledFor: params.scheduledFor,
    startedAt: params.startedAt,
    durationMs: params.durationMs,
    trigger: params.trigger,
    errMsg: params.errorMessage,
    chatSessionId: params.chatSessionId,
  });
}

/** Test-only: clear config + in-memory state. */
export function resetSchedulerForTesting(): void {
  config = null;
  stateMap = new Map();
  systemTasks.length = 0;
  taskManagerRef = null;
}

// ── Internal ──────────────────────────────────────────────────────

async function executeAndLog(task: SystemTaskDef, scheduledFor: string, trigger: TaskTrigger): Promise<void> {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  let errMsg: string | null = null;
  try {
    await task.run();
  } catch (err) {
    errMsg = errorMessage(err);
    logger().error("task failed", { taskId: task.id, error: errMsg });
  }
  const durationMs = Date.now() - startMs;
  // Persistence is best-effort — never let disk failures propagate to the
  // tick loop or abort startup catch-up.
  await persistRun({ meta: { id: task.id, name: task.name, schedule: task.schedule }, scheduledFor, startedAt, durationMs, trigger, errMsg });
}

/** The minimum a run needs to persist state + a log entry — shared by system
 *  tasks (`executeAndLog`) and external skill/user runs (`recordExternalRun`). */
interface TaskRunMeta {
  id: string;
  name: string;
  schedule: TaskDefinition["schedule"];
}

interface RunRecord {
  meta: TaskRunMeta;
  scheduledFor: string;
  startedAt: string;
  durationMs: number;
  trigger: TaskTrigger;
  errMsg: string | null;
  chatSessionId?: string;
}

/** Best-effort persistence — state and log are independent, so one failing
 *  never blocks the other and neither propagates upward. */
async function persistRun(run: RunRecord): Promise<void> {
  await writeRunState(run);
  await writeRunLog(run);
}

async function writeRunState(run: RunRecord): Promise<void> {
  const { meta, scheduledFor, durationMs, errMsg } = run;
  const isSuccess = errMsg === null;
  const currentState = stateMap.get(meta.id);
  try {
    await updateAndSave(
      stateFilePath(),
      stateMap,
      meta.id,
      {
        lastRunAt: scheduledFor,
        lastRunResult: isSuccess ? TASK_RESULTS.success : TASK_RESULTS.error,
        lastRunDurationMs: durationMs,
        lastErrorMessage: errMsg,
        consecutiveFailures: isSuccess ? 0 : (currentState?.consecutiveFailures ?? 0) + 1,
        totalRuns: (currentState?.totalRuns ?? 0) + 1,
        nextScheduledAt: computeNextScheduledFor(meta.schedule),
      },
      stateDeps(),
    );
  } catch (err) {
    logger().warn("state persistence failed", { taskId: meta.id, error: String(err) });
  }
}

async function writeRunLog(run: RunRecord): Promise<void> {
  const { meta, scheduledFor, startedAt, durationMs, trigger, errMsg, chatSessionId } = run;
  const isSuccess = errMsg === null;
  try {
    await appendLogEntry(
      logsDir(),
      {
        taskId: meta.id,
        taskName: meta.name,
        scheduledFor,
        startedAt,
        completedAt: new Date().toISOString(),
        result: isSuccess ? TASK_RESULTS.success : TASK_RESULTS.error,
        durationMs,
        trigger,
        ...(errMsg !== null && { errorMessage: errMsg }),
        ...(chatSessionId !== undefined && { chatSessionId }),
      },
      logDeps,
    );
  } catch (err) {
    logger().warn("log persistence failed", { taskId: meta.id, error: String(err) });
  }
}

/** Safe state update — swallows errors. */
async function safeUpdateState(taskId: string, patch: Partial<TaskExecutionState>): Promise<void> {
  try {
    await updateAndSave(stateFilePath(), stateMap, taskId, patch, stateDeps());
  } catch (err) {
    logger().warn("state update failed", { taskId, error: String(err) });
  }
}

/** Compute the window boundary that the current tick belongs to. For
 *  scheduled runs, this is the epoch-aligned window — not the wall-clock
 *  time of execution. This keeps lastRunAt consistent with catch-up's
 *  window-based accounting. */
function computeCurrentWindow(task: SystemTaskDef): string {
  const coreSchedule = toCoreSchedule(task.schedule);
  // The window that just fired is the latest one at or before now.
  const nowMs = Date.now();
  const windowMs = nextWindowAfter(coreSchedule, nowMs - (coreSchedule.type === SCHEDULE_TYPES.interval ? coreSchedule.intervalSec * ONE_SECOND_MS : 0));
  return windowMs !== null && windowMs <= nowMs ? new Date(windowMs).toISOString() : new Date(nowMs).toISOString();
}

function computeNextScheduledFor(schedule: TaskDefinition["schedule"]): string | null {
  const coreSchedule = toCoreSchedule(schedule);
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
