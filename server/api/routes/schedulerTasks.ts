// API routes for the unified scheduler (#357).
//
//   GET /api/scheduler/tasks   — all registered tasks + state
//   GET /api/scheduler/logs    — execution log (newest first)
//
// Read-only for Phase 1. Phase 3 adds CRUD for user tasks.

import { Router, type Request, type Response } from "express";
import {
  getSchedulerTasks,
  getSchedulerLogs,
} from "../../events/scheduler-adapter.js";
import type { TaskLogEntry } from "@receptron/task-scheduler";

const router = Router();

router.get("/api/scheduler/tasks", (_req: Request, res: Response) => {
  res.json({ tasks: getSchedulerTasks() });
});

interface LogQuery {
  since?: string;
  taskId?: string;
  limit?: string;
}

router.get(
  "/api/scheduler/logs",
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
