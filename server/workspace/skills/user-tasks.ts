// User-created scheduled tasks (#357 Phase 3).
//
// Users can create tasks via the API or MCP tool. Each task fires
// `startChat()` with its prompt when the schedule triggers.
//
// Tasks are persisted in `config/scheduler/tasks.json` and
// registered with the task-manager at startup. CRUD operations
// trigger a refresh that unregisters old tasks and registers new ones.

import { loadUserTasks as loadRaw, saveUserTasks } from "../../utils/files/user-tasks-io.js";
import type { MissedRunPolicy } from "@receptron/task-scheduler";
import { SCHEDULE_TYPES, MISSED_RUN_POLICIES } from "@receptron/task-scheduler";
import type { TaskSchedule as LocalTaskSchedule } from "../../events/task-manager/index.js";
import { DEFAULT_ROLE_ID } from "../../../src/config/roles.js";
import { SESSION_ORIGINS, type SessionOrigin } from "../../../src/types/session.js";
import { log } from "../../system/logger/index.js";
import type { ITaskManager } from "../../events/task-manager/index.js";
import { isRecord } from "../../utils/types.js";
import { makeUuid } from "../../utils/id.js";

// ── Types ───────────────────────────────────────────────────────

export interface PersistedUserTask {
  id: string;
  name: string;
  description: string;
  schedule: LocalTaskSchedule;
  missedRunPolicy: MissedRunPolicy;
  enabled: boolean;
  roleId: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
}

export function loadUserTasks(workspaceRoot?: string): PersistedUserTask[] {
  return loadRaw<PersistedUserTask>(workspaceRoot);
}

// ── Validation ──────────────────────────────────────────────────

function isValidDailyTime(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

function isValidSchedule(scheduleValue: unknown): scheduleValue is LocalTaskSchedule {
  if (!isRecord(scheduleValue)) return false;
  const scheduleRecord = scheduleValue as Record<string, unknown>;
  if (scheduleRecord.type === SCHEDULE_TYPES.interval) {
    return typeof scheduleRecord.intervalMs === "number" && scheduleRecord.intervalMs > 0;
  }
  if (scheduleRecord.type === SCHEDULE_TYPES.daily) {
    return typeof scheduleRecord.time === "string" && isValidDailyTime(scheduleRecord.time);
  }
  return false;
}

function isValidMissedRunPolicy(policy: unknown): policy is MissedRunPolicy {
  return policy === MISSED_RUN_POLICIES.skip || policy === MISSED_RUN_POLICIES.runOnce || policy === MISSED_RUN_POLICIES.runAll;
}

export type ValidateResult = { kind: "ok"; task: PersistedUserTask } | { kind: "error"; error: string };

export function validateAndCreate(input: unknown): ValidateResult {
  if (!isRecord(input)) {
    return { kind: "error", error: "request body required" };
  }
  const obj = input as Record<string, unknown>;

  if (typeof obj.name !== "string" || obj.name.trim().length === 0) {
    return { kind: "error", error: "name required" };
  }
  if (typeof obj.prompt !== "string" || obj.prompt.trim().length === 0) {
    return { kind: "error", error: "prompt required" };
  }
  if (!isValidSchedule(obj.schedule)) {
    return { kind: "error", error: "valid schedule required" };
  }
  const missedRunPolicy = isValidMissedRunPolicy(obj.missedRunPolicy) ? obj.missedRunPolicy : MISSED_RUN_POLICIES.runOnce;
  const roleId = typeof obj.roleId === "string" ? obj.roleId : DEFAULT_ROLE_ID;

  const now = new Date().toISOString();
  const task: PersistedUserTask = {
    id: makeUuid(),
    name: obj.name.trim(),
    description: typeof obj.description === "string" ? obj.description.trim() : "",
    schedule: obj.schedule,
    missedRunPolicy,
    enabled: true,
    roleId,
    prompt: obj.prompt.trim(),
    createdAt: now,
    updatedAt: now,
  };
  return { kind: "ok", task };
}

export type UpdateResult = { kind: "ok"; tasks: PersistedUserTask[] } | { kind: "error"; error: string };

export function applyUpdate(tasks: PersistedUserTask[], taskId: string, patch: unknown): UpdateResult {
  if (!isRecord(patch)) {
    return { kind: "error", error: "request body required" };
  }
  const index = tasks.findIndex((task) => task.id === taskId);
  if (index === -1) {
    return { kind: "error", error: `task not found: ${taskId}` };
  }
  const existing = tasks[index];
  const updated: PersistedUserTask = { ...existing };
  // patch is validated as non-null object above; spread into Record
  const patchRecord: Record<string, unknown> = { ...patch };

  if (typeof patchRecord.name === "string" && patchRecord.name.trim().length > 0) {
    updated.name = patchRecord.name.trim();
  }
  if (typeof patchRecord.description === "string") {
    updated.description = patchRecord.description.trim();
  }
  if (isValidSchedule(patchRecord.schedule)) {
    updated.schedule = patchRecord.schedule;
  }
  if (isValidMissedRunPolicy(patchRecord.missedRunPolicy)) {
    updated.missedRunPolicy = patchRecord.missedRunPolicy;
  }
  if (typeof patchRecord.enabled === "boolean") {
    updated.enabled = patchRecord.enabled;
  }
  if (typeof patchRecord.roleId === "string") {
    updated.roleId = patchRecord.roleId;
  }
  if (typeof patchRecord.prompt === "string" && patchRecord.prompt.trim().length > 0) {
    updated.prompt = patchRecord.prompt.trim();
  }
  updated.updatedAt = new Date().toISOString();

  const next = [...tasks];
  next[index] = updated;
  return { kind: "ok", tasks: next };
}

// ── Mutexed CRUD ────────────────────────────────────────────────
// Serialize read-modify-write sequences so concurrent API calls
// don't clobber each other's changes.

let crudMutex: Promise<void> = Promise.resolve();

export async function withUserTaskLock<T>(
  lockFn: (tasks: PersistedUserTask[]) => Promise<{
    tasks: PersistedUserTask[];
    result: T;
  }>,
): Promise<T> {
  const prev = crudMutex;
  let release: () => void = () => {};
  crudMutex = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await prev;
    const current = loadUserTasks();
    const { tasks: next, result } = await lockFn(current);
    await saveUserTasks(next);
    await refreshUserTasks();
    return result;
  } finally {
    release();
  }
}

// ── Task registration ───────────────────────────────────────────

const USER_TASK_PREFIX = "user.";
let registeredUserTaskIds = new Set<string>();
let cachedUserTaskDeps: UserTaskDeps | null = null;
let userTaskMutex: Promise<number> = Promise.resolve(0);

export interface UserTaskDeps {
  taskManager: ITaskManager;
  startChat: (params: { message: string; roleId: string; chatSessionId: string; origin?: SessionOrigin }) => Promise<{ kind: string; error?: string }>;
}

export async function registerUserTasks(deps: UserTaskDeps): Promise<number> {
  cachedUserTaskDeps = deps;
  return serializedRefreshUserTasks(deps);
}

export async function refreshUserTasks(): Promise<number> {
  if (!cachedUserTaskDeps) {
    log.warn("user-tasks", "refreshUserTasks called before initial register");
    return 0;
  }
  return serializedRefreshUserTasks(cachedUserTaskDeps);
}

function serializedRefreshUserTasks(deps: UserTaskDeps): Promise<number> {
  userTaskMutex = userTaskMutex.then(
    () => doRegisterUserTasks(deps),
    () => doRegisterUserTasks(deps),
  );
  return userTaskMutex;
}

async function doRegisterUserTasks(deps: UserTaskDeps): Promise<number> {
  const { taskManager, startChat } = deps;

  for (const taskId of registeredUserTaskIds) {
    taskManager.removeTask(taskId);
  }
  const previousCount = registeredUserTaskIds.size;
  registeredUserTaskIds = new Set<string>();

  const tasks = loadUserTasks();
  let registered = 0;

  for (const task of tasks) {
    if (!task.enabled) continue;

    const taskId = `${USER_TASK_PREFIX}${task.id}`;
    taskManager.registerTask({
      id: taskId,
      description: `User task: ${task.name}`,
      schedule: task.schedule,
      run: async () => {
        const chatSessionId = makeUuid();
        log.info("user-tasks", "running user task", {
          name: task.name,
          roleId: task.roleId,
          chatSessionId,
        });
        const result = await startChat({
          message: task.prompt,
          roleId: task.roleId,
          chatSessionId,
          origin: SESSION_ORIGINS.scheduler,
        });
        if (result.kind === "error") {
          throw new Error(`user task failed: ${result.error ?? "unknown"}`);
        }
        log.info("user-tasks", "user task completed", {
          name: task.name,
          kind: result.kind,
        });
      },
    });

    registeredUserTaskIds.add(taskId);
    registered++;
  }

  if (previousCount > 0 || registered > 0) {
    log.info("user-tasks", "user tasks refreshed", {
      previous: previousCount,
      current: registered,
    });
  }

  return registered;
}
