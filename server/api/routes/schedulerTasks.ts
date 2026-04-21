// API routes for the unified scheduler (#357).
//
//   GET    /api/scheduler/tasks        — all registered tasks + state
//   POST   /api/scheduler/tasks        — create user task
//   PUT    /api/scheduler/tasks/:id    — update user task
//   DELETE /api/scheduler/tasks/:id    — delete user task
//   POST   /api/scheduler/tasks/:id/run — manual trigger
//   GET    /api/scheduler/logs         — execution log (newest first)

import { Router, type Request, type Response } from "express";
import {
  getSchedulerTasks,
  getSchedulerLogs,
} from "../../events/scheduler-adapter.js";
import type { TaskLogEntry } from "@receptron/task-scheduler";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { SESSION_ORIGINS } from "../../../src/types/session.js";
import {
  loadUserTasks,
  validateAndCreate,
  applyUpdate,
  withUserTaskLock,
} from "../../workspace/skills/user-tasks.js";
import { badRequest, notFound, serverError } from "../../utils/httpError.js";
import { errorMessage } from "../../utils/errors.js";
import { log } from "../../system/logger/index.js";
import { startChat } from "./agent.js";

const router = Router();

// ── List all tasks ──────────────────────────────────────────────

router.get(API_ROUTES.scheduler.tasks, (_req: Request, res: Response) => {
  // getSchedulerTasks() returns system-only tasks (registered via
  // initScheduler at startup — journal, chat-index, sources, etc.).
  // origin: "system" is correct, not an overwrite — these tasks
  // have no origin field of their own.
  const systemTasks = getSchedulerTasks();
  const userTasks = loadUserTasks();
  const all = [
    ...systemTasks.map((t) => ({ ...t, origin: "system" as const })),
    ...userTasks.map((t) => ({ ...t, origin: "user" as const })),
  ];
  res.json({ tasks: all });
});

// ── Create user task ────────────────────────────────────────────

router.post(API_ROUTES.scheduler.tasks, async (req: Request, res: Response) => {
  const validated = validateAndCreate(req.body);
  if (validated.kind === "error") {
    badRequest(res, validated.error);
    return;
  }
  try {
    const task = await withUserTaskLock(async (tasks) => ({
      tasks: [...tasks, validated.task],
      result: validated.task,
    }));
    res.status(201).json({ task });
  } catch (err) {
    log.error("scheduler-tasks", "create failed", {
      error: String(err),
    });
    serverError(res, "Failed to create task");
  }
});

// ── Update user task ────────────────────────────────────────────

router.put(
  API_ROUTES.scheduler.task,
  async (req: Request<{ id: string }>, res: Response) => {
    const { id } = req.params;
    try {
      const updated = await withUserTaskLock(async (tasks) => {
        const result = applyUpdate(tasks, id, req.body);
        if (result.kind === "error") {
          throw new Error(result.error);
        }
        const task = result.tasks.find((t) => t.id === id);
        return { tasks: result.tasks, result: task };
      });
      res.json({ task: updated });
    } catch (err) {
      const msg = errorMessage(err);
      if (msg.startsWith("task not found") || msg.startsWith("request body")) {
        notFound(res, msg);
        return;
      }
      log.error("scheduler-tasks", "update failed", { error: msg });
      serverError(res, "Failed to update task");
    }
  },
);

// ── Delete user task ────────────────────────────────────────────

router.delete(
  API_ROUTES.scheduler.task,
  async (req: Request<{ id: string }>, res: Response) => {
    const { id } = req.params;
    try {
      await withUserTaskLock(async (tasks) => {
        const idx = tasks.findIndex((t) => t.id === id);
        if (idx === -1) throw new Error(`task not found: ${id}`);
        const next = tasks.filter((t) => t.id !== id);
        return { tasks: next, result: undefined };
      });
      res.json({ deleted: id });
    } catch (err) {
      const msg = errorMessage(err);
      if (msg.startsWith("task not found")) {
        notFound(res, msg);
        return;
      }
      log.error("scheduler-tasks", "delete failed", { error: msg });
      serverError(res, "Failed to delete task");
    }
  },
);

// ── Manual trigger ──────────────────────────────────────────────

router.post(
  API_ROUTES.scheduler.taskRun,
  async (req: Request<{ id: string }>, res: Response) => {
    const { id } = req.params;
    // Check user tasks first
    const userTasks = loadUserTasks();
    const userTask = userTasks.find((t) => t.id === id);
    if (userTask) {
      const chatSessionId = crypto.randomUUID();
      log.info("scheduler-tasks", "manual run (user task)", {
        name: userTask.name,
        chatSessionId,
      });
      startChat({
        message: userTask.prompt,
        roleId: userTask.roleId,
        chatSessionId,
        origin: SESSION_ORIGINS.scheduler,
      }).catch((err) => {
        log.error("scheduler-tasks", "manual run failed", {
          error: String(err),
        });
      });
      res.json({ triggered: id, chatSessionId });
      return;
    }
    // Not a user task — check system/skill tasks
    const systemTasks = getSchedulerTasks();
    const found = systemTasks.find((t) => t.id === id);
    if (!found) {
      notFound(res, `task not found: ${id}`);
      return;
    }
    // System tasks don't have a prompt to startChat with — return 400
    badRequest(res, "manual run is only supported for user tasks");
  },
);

// ── Execution logs ──────────────────────────────────────────────

interface LogQuery {
  since?: string;
  taskId?: string;
  limit?: string;
}

router.get(
  API_ROUTES.scheduler.logs,
  async (
    req: Request<object, unknown, object, LogQuery>,
    res: Response<{ logs: TaskLogEntry[] }>,
  ) => {
    const MAX_LIMIT = 500;
    const rawLimit =
      typeof req.query.limit === "string"
        ? parseInt(req.query.limit, 10)
        : undefined;
    const limit =
      Number.isFinite(rawLimit) && rawLimit! > 0
        ? Math.min(rawLimit!, MAX_LIMIT)
        : undefined;
    const logs = await getSchedulerLogs({
      since: typeof req.query.since === "string" ? req.query.since : undefined,
      taskId:
        typeof req.query.taskId === "string" ? req.query.taskId : undefined,
      limit,
    });
    res.json({ logs });
  },
);

export default router;
