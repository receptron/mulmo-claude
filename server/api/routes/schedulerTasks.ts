// API routes for the unified scheduler (#357).
//
//   GET    /api/scheduler/tasks        — all registered tasks + state
//   POST   /api/scheduler/tasks        — create user task
//   PUT    /api/scheduler/tasks/:id    — update user task
//   DELETE /api/scheduler/tasks/:id    — delete user task
//   POST   /api/scheduler/tasks/:id/run — manual trigger
//   GET    /api/scheduler/logs         — execution log (newest first)

import { Router, type Request, type Response } from "express";
import { getSchedulerTasks, getSchedulerLogs } from "../../events/scheduler-adapter.js";
import type { TaskLogEntry } from "@receptron/task-scheduler";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { SESSION_ORIGINS } from "../../../src/types/session.js";
import { loadUserTasks, validateAndCreate, applyUpdate, withUserTaskLock } from "../../workspace/skills/user-tasks.js";
import { badRequest, notFound, serverError } from "../../utils/httpError.js";
import { errorMessage } from "../../utils/errors.js";
import { getOptionalStringQuery } from "../../utils/request.js";
import { log } from "../../system/logger/index.js";
import { startChat } from "./agent.js";
import { makeUuid } from "../../utils/id.js";

const router = Router();

// ── List all tasks ──────────────────────────────────────────────

router.get(API_ROUTES.scheduler.tasks, (_req: Request, res: Response) => {
  log.info("scheduler-tasks", "list: start");
  try {
    // getSchedulerTasks() returns system-only tasks (registered via
    // initScheduler at startup — journal, chat-index, sources, etc.).
    // origin: "system" is correct, not an overwrite — these tasks
    // have no origin field of their own.
    const systemTasks = getSchedulerTasks();
    const userTasks = loadUserTasks();
    const all = [...systemTasks.map((task) => ({ ...task, origin: "system" as const })), ...userTasks.map((task) => ({ ...task, origin: "user" as const }))];
    log.info("scheduler-tasks", "list: ok", { system: systemTasks.length, user: userTasks.length });
    res.json({ tasks: all });
  } catch (err) {
    // loadUserTasks reads JSON from disk and getSchedulerTasks
    // queries the in-memory registry — neither is supposed to
    // throw, but a corrupted user-tasks.json or an early-startup
    // registry race would. Without the catch the route would 500
    // with no trace, which is the original #779 complaint pattern.
    log.error("scheduler-tasks", "list: failed", { error: errorMessage(err) });
    serverError(res, "Failed to list tasks");
  }
});

// ── Create user task ────────────────────────────────────────────

router.post(API_ROUTES.scheduler.tasks, async (req: Request, res: Response) => {
  log.info("scheduler-tasks", "create: start");
  const validated = validateAndCreate(req.body);
  if (validated.kind === "error") {
    log.warn("scheduler-tasks", "create: validation failed", { error: validated.error });
    badRequest(res, validated.error);
    return;
  }
  try {
    const task = await withUserTaskLock(async (tasks) => ({
      tasks: [...tasks, validated.task],
      result: validated.task,
    }));
    log.info("scheduler-tasks", "create: ok", { id: task.id, name: task.name });
    res.status(201).json({ task });
  } catch (err) {
    log.error("scheduler-tasks", "create: failed", {
      error: String(err),
    });
    serverError(res, "Failed to create task");
  }
});

// ── Update user task ────────────────────────────────────────────

router.put(API_ROUTES.scheduler.task, async (req: Request<{ id: string }>, res: Response) => {
  const { id: taskId } = req.params;
  log.info("scheduler-tasks", "update: start", { taskId });
  try {
    const updated = await withUserTaskLock(async (tasks) => {
      const result = applyUpdate(tasks, taskId, req.body);
      if (result.kind === "error") {
        throw new Error(result.error);
      }
      const task = result.tasks.find((taskItem) => taskItem.id === taskId);
      return { tasks: result.tasks, result: task };
    });
    log.info("scheduler-tasks", "update: ok", { taskId });
    res.json({ task: updated });
  } catch (err) {
    const msg = errorMessage(err);
    if (msg.startsWith("task not found") || msg.startsWith("request body")) {
      log.warn("scheduler-tasks", "update: validation failed", { taskId, reason: msg });
      notFound(res, msg);
      return;
    }
    log.error("scheduler-tasks", "update: failed", { taskId, error: msg });
    serverError(res, "Failed to update task");
  }
});

// ── Delete user task ────────────────────────────────────────────

router.delete(API_ROUTES.scheduler.task, async (req: Request<{ id: string }>, res: Response) => {
  const { id: taskId } = req.params;
  log.info("scheduler-tasks", "delete: start", { taskId });
  try {
    await withUserTaskLock(async (tasks) => {
      const index = tasks.findIndex((task) => task.id === taskId);
      if (index === -1) throw new Error(`task not found: ${taskId}`);
      const next = tasks.filter((task) => task.id !== taskId);
      return { tasks: next, result: undefined };
    });
    log.info("scheduler-tasks", "delete: ok", { taskId });
    res.json({ deleted: taskId });
  } catch (err) {
    const msg = errorMessage(err);
    if (msg.startsWith("task not found")) {
      log.warn("scheduler-tasks", "delete: not found", { taskId });
      notFound(res, msg);
      return;
    }
    log.error("scheduler-tasks", "delete: failed", { taskId, error: msg });
    serverError(res, "Failed to delete task");
  }
});

// ── Manual trigger ──────────────────────────────────────────────

router.post(API_ROUTES.scheduler.taskRun, async (req: Request<{ id: string }>, res: Response) => {
  const { id: taskId } = req.params;
  log.info("scheduler-tasks", "run: start", { taskId });
  // Check user tasks first
  const userTasks = loadUserTasks();
  const userTask = userTasks.find((task) => task.id === taskId);
  if (userTask) {
    const chatSessionId = makeUuid();
    log.info("scheduler-tasks", "run: user task triggered", {
      taskId,
      name: userTask.name,
      chatSessionId,
    });
    startChat({
      message: userTask.prompt,
      roleId: userTask.roleId,
      chatSessionId,
      origin: SESSION_ORIGINS.scheduler,
    }).catch((err) => {
      log.error("scheduler-tasks", "run: startChat failed", {
        taskId,
        error: String(err),
      });
    });
    res.json({ triggered: taskId, chatSessionId });
    return;
  }
  // Not a user task — check system/skill tasks
  const systemTasks = getSchedulerTasks();
  const found = systemTasks.find((task) => task.id === taskId);
  if (!found) {
    log.warn("scheduler-tasks", "run: not found", { taskId });
    notFound(res, `task not found: ${taskId}`);
    return;
  }
  // System tasks don't have a prompt to startChat with — return 400
  log.warn("scheduler-tasks", "run: refused (system task)", { taskId });
  badRequest(res, "manual run is only supported for user tasks");
});

// ── Execution logs ──────────────────────────────────────────────

interface LogQuery {
  since?: string;
  taskId?: string;
  limit?: string;
}

router.get(API_ROUTES.scheduler.logs, async (req: Request<object, unknown, object, LogQuery>, res: Response<{ logs: TaskLogEntry[] }>) => {
  const MAX_LIMIT = 500;
  const rawLimitStr = getOptionalStringQuery(req, "limit");
  const rawLimit = rawLimitStr ? parseInt(rawLimitStr, 10) : undefined;
  const limit = Number.isFinite(rawLimit) && rawLimit! > 0 ? Math.min(rawLimit!, MAX_LIMIT) : undefined;
  const taskId = getOptionalStringQuery(req, "taskId");
  log.info("scheduler-tasks", "logs: start", { taskId, limit });
  try {
    const logs = await getSchedulerLogs({
      since: getOptionalStringQuery(req, "since"),
      taskId,
      limit,
    });
    log.info("scheduler-tasks", "logs: ok", { entries: logs.length, taskId });
    res.json({ logs });
  } catch (err) {
    log.error("scheduler-tasks", "logs: failed", { taskId, error: errorMessage(err) });
    serverError(res, "Failed to read scheduler logs");
  }
});

export default router;
