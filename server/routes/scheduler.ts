import { Router, Request, Response } from "express";
import path from "path";
import { workspacePath } from "../workspace.js";
import { loadJsonFile, saveJsonFile } from "../utils/file.js";
import {
  dispatchScheduler,
  type SchedulerActionInput,
} from "./schedulerHandlers.js";

const router = Router();

export interface ScheduledItem {
  id: string;
  title: string;
  createdAt: number;
  props: Record<string, string | number | boolean | null>;
}

const schedulerFile = () => path.join(workspacePath, "scheduler", "items.json");

function loadItems(): ScheduledItem[] {
  return loadJsonFile<ScheduledItem[]>(schedulerFile(), []);
}

function saveItems(items: ScheduledItem[]): void {
  saveJsonFile(schedulerFile(), items);
}

router.get(
  "/scheduler",
  (_req: Request, res: Response<{ data: { items: ScheduledItem[] } }>) => {
    res.json({ data: { items: loadItems() } });
  },
);

interface SchedulerBody extends SchedulerActionInput {
  action: string;
}

interface ErrorResponse {
  error: string;
}

interface SchedulerResponse {
  data: { items: ScheduledItem[] };
  message: string;
  jsonData: Record<string, unknown>;
  instructions: string;
  updating: boolean;
}

router.post(
  "/scheduler",
  (
    req: Request<object, unknown, SchedulerBody>,
    res: Response<SchedulerResponse | ErrorResponse>,
  ) => {
    const { action, ...input } = req.body;
    const items = loadItems();

    const result = dispatchScheduler(action, items, input);
    if (result.kind === "error") {
      res.status(result.status).json({ error: result.error });
      return;
    }

    // Persist whenever the action mutated state. "show" returns the
    // same array reference unchanged, so this no-ops in that case
    // (saveItems is idempotent for equal content anyway).
    if (action !== "show") {
      saveItems(result.items);
    }

    res.json({
      data: { items: result.items },
      message: result.message,
      jsonData: result.jsonData,
      instructions: "Display the updated scheduler to the user.",
      updating: true,
    });
  },
);

export default router;
