import { Router, Request, Response } from "express";
import path from "path";
import { workspacePath } from "../workspace.js";
import { loadJsonFile, saveJsonFile } from "../utils/file.js";
import { dispatchTodos, type TodosActionInput } from "./todosHandlers.js";

const router = Router();

export interface TodoItem {
  id: string;
  text: string;
  note?: string;
  completed: boolean;
  createdAt: number;
}

const todosFile = () => path.join(workspacePath, "todos", "todos.json");

function loadTodos(): TodoItem[] {
  return loadJsonFile<TodoItem[]>(todosFile(), []);
}

function saveTodos(items: TodoItem[]): void {
  saveJsonFile(todosFile(), items);
}

router.get(
  "/todos",
  (_req: Request, res: Response<{ data: { items: TodoItem[] } }>) => {
    res.json({ data: { items: loadTodos() } });
  },
);

interface TodoBody extends TodosActionInput {
  action: string;
}

interface ErrorResponse {
  error: string;
}

interface TodoResponse {
  data: { items: TodoItem[] };
  message: string;
  jsonData: Record<string, unknown>;
  instructions: string;
  updating: boolean;
}

router.post(
  "/todos",
  (
    req: Request<object, unknown, TodoBody>,
    res: Response<TodoResponse | ErrorResponse>,
  ) => {
    const { action, ...input } = req.body;
    const items = loadTodos();

    const result = dispatchTodos(action, items, input);
    if (result.kind === "error") {
      res.status(result.status).json({ error: result.error });
      return;
    }

    // Persist whenever the action mutated state. "show" returns the
    // same array reference unchanged, so we skip the no-op write.
    if (action !== "show") {
      saveTodos(result.items);
    }

    res.json({
      data: { items: result.items },
      message: result.message,
      jsonData: result.jsonData,
      instructions: "Display the updated todo list to the user.",
      updating: true,
    });
  },
);

export default router;
