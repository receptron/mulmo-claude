import { Router, Request, Response } from "express";
import { loadSchedulerItems, saveSchedulerItems } from "../../utils/files/scheduler-io.js";
import { dispatchScheduler, type SchedulerActionInput } from "./schedulerHandlers.js";
import { respondWithDispatchResult, type DispatchSuccessResponse, type DispatchErrorResponse } from "./dispatchResponse.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { SESSION_ORIGINS } from "../../../src/types/session.js";
import { loadUserTasks, validateAndCreate, refreshUserTasks } from "../../workspace/skills/user-tasks.js";
import { saveUserTasks } from "../../utils/files/user-tasks-io.js";
import { startChat } from "./agent.js";
import { log } from "../../system/logger/index.js";
import { SCHEDULER_ACTIONS, TASK_ACTIONS } from "../../../src/config/schedulerActions.js";

const router = Router();

export interface ScheduledItem {
  id: string;
  title: string;
  createdAt: number;
  props: Record<string, string | number | boolean | null>;
}

function loadItems(): ScheduledItem[] {
  return loadSchedulerItems<ScheduledItem[]>([]);
}

function saveItems(items: ScheduledItem[]): void {
  saveSchedulerItems(items);
}

router.get(API_ROUTES.scheduler.base, (_req: Request, res: Response<{ data: { items: ScheduledItem[] } }>) => {
  res.json({ data: { items: loadItems() } });
});

interface SchedulerBody extends SchedulerActionInput {
  action: string;
  // Task-related fields
  name?: string;
  prompt?: string;
  schedule?: unknown;
  roleId?: string;
}

router.post(
  API_ROUTES.scheduler.base,
  async (req: Request<object, unknown, SchedulerBody>, res: Response<DispatchSuccessResponse<ScheduledItem> | DispatchErrorResponse | unknown>) => {
    const { action, ...input } = req.body;

    // Route task actions to the user-task subsystem
    if (TASK_ACTIONS.has(action)) {
      await handleTaskAction(action, input, res);
      return;
    }

    // Calendar item actions (existing behavior)
    const items = loadItems();
    const result = dispatchScheduler(action, items, input);
    respondWithDispatchResult(res, result, {
      shouldPersist: action !== SCHEDULER_ACTIONS.show,
      instructions: "Display the updated scheduler to the user.",
      persist: saveItems,
    });
  },
);

async function handleTaskAction(action: string, input: Record<string, unknown>, res: Response): Promise<void> {
  try {
    if (action === SCHEDULER_ACTIONS.listTasks) {
      const tasks = loadUserTasks();
      res.json({
        uuid: crypto.randomUUID(),
        message: `${tasks.length} scheduled task(s) found.`,
        data: { tasks },
      });
      return;
    }

    if (action === SCHEDULER_ACTIONS.createTask) {
      const result = validateAndCreate(input);
      if (result.kind === "error") {
        res.status(400).json({ error: result.error });
        return;
      }
      const tasks = loadUserTasks();
      tasks.push(result.task);
      await saveUserTasks(tasks);
      await refreshUserTasks();
      res.json({
        uuid: crypto.randomUUID(),
        message: `Task "${result.task.name}" created and scheduled.`,
        data: { task: result.task },
      });
      return;
    }

    if (action === SCHEDULER_ACTIONS.deleteTask) {
      const taskId = typeof input.id === "string" ? input.id : "";
      const tasks = loadUserTasks();
      const idx = tasks.findIndex((task) => task.id === taskId);
      if (idx === -1) {
        res.status(404).json({ error: `task not found: ${taskId}` });
        return;
      }
      const name = tasks[idx].name;
      tasks.splice(idx, 1);
      await saveUserTasks(tasks);
      await refreshUserTasks();
      res.json({
        uuid: crypto.randomUUID(),
        message: `Task "${name}" deleted.`,
        data: { deleted: taskId },
      });
      return;
    }

    if (action === SCHEDULER_ACTIONS.runTask) {
      const taskId = typeof input.id === "string" ? input.id : "";
      const tasks = loadUserTasks();
      const task = tasks.find((candidate) => candidate.id === taskId);
      if (!task) {
        res.status(404).json({ error: `task not found: ${taskId}` });
        return;
      }
      const chatSessionId = crypto.randomUUID();
      log.info("scheduler", "manual run via MCP", {
        name: task.name,
        chatSessionId,
      });
      startChat({
        message: task.prompt,
        roleId: task.roleId,
        chatSessionId,
        origin: SESSION_ORIGINS.scheduler,
      }).catch((err) => {
        log.error("scheduler", "manual run failed", {
          error: String(err),
        });
      });
      res.json({
        uuid: crypto.randomUUID(),
        message: `Task "${task.name}" triggered.`,
        data: { triggered: taskId, chatSessionId },
      });
      return;
    }

    res.status(400).json({ error: `unknown task action: ${action}` });
  } catch (err) {
    log.error("scheduler", "task action failed", { error: String(err) });
    res.status(500).json({ error: "Internal server error" });
  }
}

export default router;
