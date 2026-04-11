import { Router, Request, Response } from "express";
import path from "path";
import { randomBytes } from "crypto";
import { workspacePath } from "../workspace.js";
import { loadJsonFile, saveJsonFile } from "../utils/file.js";
import {
  filterByLabels,
  listLabelsWithCount,
  mergeLabels,
  subtractLabels,
} from "../../src/plugins/todo/labels.js";

const router = Router();

export interface TodoItem {
  id: string;
  text: string;
  note?: string;
  labels?: string[];
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

interface TodoBody {
  action: string;
  text?: string;
  newText?: string;
  note?: string;
  // For `add`: labels to tag the new item with.
  // For `add_label` / `remove_label`: labels to add to / remove from the
  // item matched by `text`.
  labels?: string[];
  // For `show`: OR-semantics filter that restricts the returned list
  // to items carrying at least one of these labels (case-insensitive).
  filterLabels?: string[];
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
    const { action, text, newText, note, labels, filterLabels } = req.body;

    let items = loadTodos();
    // eslint-disable-next-line no-useless-assignment
    let message = "";
    let jsonData: Record<string, unknown> = {};

    switch (action) {
      case "show": {
        // Optional OR-semantics filter via labels. When no filter is
        // given, `filterByLabels` is a pass-through.
        const filtered = filterByLabels(items, filterLabels ?? []);
        if (filterLabels && filterLabels.length > 0) {
          message = `Showing ${filtered.length} of ${items.length} todo item(s) filtered by: ${filterLabels.join(", ")}`;
        } else {
          message = `Showing ${items.length} todo item(s)`;
        }
        jsonData = {
          items: filtered.map((i) => ({
            text: i.text,
            completed: i.completed,
            ...(i.labels && i.labels.length > 0 && { labels: i.labels }),
          })),
        };
        // Return the filtered view to the client too, so the UI can
        // honour server-side filters when the LLM used them. The
        // client-side filter bar still works on top of this.
        items = filtered;
        break;
      }

      case "add": {
        if (!text) {
          res.status(400).json({ error: "text required" });
          return;
        }
        // Normalise incoming labels by routing them through
        // `mergeLabels([], labels ?? [])` — that handles trim /
        // collapse / case-insensitive dedup in one shot.
        const normalizedLabels = mergeLabels([], labels ?? []);
        const item: TodoItem = {
          id: `todo_${Date.now()}_${randomBytes(3).toString("hex")}`,
          text,
          ...(note !== undefined && { note }),
          ...(normalizedLabels.length > 0 && { labels: normalizedLabels }),
          completed: false,
          createdAt: Date.now(),
        };
        items.push(item);
        saveTodos(items);
        message =
          normalizedLabels.length > 0
            ? `Added: "${text}" [${normalizedLabels.join(", ")}]`
            : `Added: "${text}"`;
        jsonData = { added: text, labels: normalizedLabels };
        break;
      }

      case "delete": {
        if (!text) {
          res.status(400).json({ error: "text required" });
          return;
        }
        const before = items.length;
        items = items.filter(
          (i) => !i.text.toLowerCase().includes(text.toLowerCase()),
        );
        saveTodos(items);
        message =
          before !== items.length
            ? `Deleted: "${text}"`
            : `Item not found: "${text}"`;
        jsonData = { deleted: text };
        break;
      }

      case "update": {
        if (!text || !newText) {
          res.status(400).json({ error: "text and newText required" });
          return;
        }
        const item = items.find((i) =>
          i.text.toLowerCase().includes(text.toLowerCase()),
        );
        if (item) {
          const oldText = item.text;
          item.text = newText;
          if (note !== undefined) item.note = note || undefined;
          saveTodos(items);
          message = `Updated: "${oldText}" → "${newText}"`;
          jsonData = { oldText, newText };
        } else {
          message = `Item not found: "${text}"`;
        }
        break;
      }

      case "check": {
        if (!text) {
          res.status(400).json({ error: "text required" });
          return;
        }
        const item = items.find((i) =>
          i.text.toLowerCase().includes(text.toLowerCase()),
        );
        if (item) {
          item.completed = true;
          saveTodos(items);
          message = `Checked: "${item.text}"`;
          jsonData = { checkedItem: item.text };
        } else {
          message = `Item not found: "${text}"`;
        }
        break;
      }

      case "uncheck": {
        if (!text) {
          res.status(400).json({ error: "text required" });
          return;
        }
        const item = items.find((i) =>
          i.text.toLowerCase().includes(text.toLowerCase()),
        );
        if (item) {
          item.completed = false;
          saveTodos(items);
          message = `Unchecked: "${item.text}"`;
          jsonData = { uncheckedItem: item.text };
        } else {
          message = `Item not found: "${text}"`;
        }
        break;
      }

      case "clear_completed": {
        const count = items.filter((i) => i.completed).length;
        items = items.filter((i) => !i.completed);
        saveTodos(items);
        message = `Cleared ${count} completed item(s)`;
        jsonData = { clearedCount: count };
        break;
      }

      case "add_label": {
        if (!text || !labels || labels.length === 0) {
          res
            .status(400)
            .json({ error: "text and a non-empty labels array required" });
          return;
        }
        const item = items.find((i) =>
          i.text.toLowerCase().includes(text.toLowerCase()),
        );
        if (item) {
          const before = item.labels ?? [];
          item.labels = mergeLabels(before, labels);
          saveTodos(items);
          message = `Labels on "${item.text}": ${item.labels.join(", ")}`;
          jsonData = { item: item.text, labels: item.labels };
        } else {
          message = `Item not found: "${text}"`;
          jsonData = { notFound: text };
        }
        break;
      }

      case "remove_label": {
        if (!text || !labels || labels.length === 0) {
          res
            .status(400)
            .json({ error: "text and a non-empty labels array required" });
          return;
        }
        const item = items.find((i) =>
          i.text.toLowerCase().includes(text.toLowerCase()),
        );
        if (item) {
          const next = subtractLabels(item.labels ?? [], labels);
          if (next.length > 0) {
            item.labels = next;
          } else {
            delete item.labels;
          }
          saveTodos(items);
          message =
            next.length > 0
              ? `Labels on "${item.text}": ${next.join(", ")}`
              : `"${item.text}" now has no labels`;
          jsonData = { item: item.text, labels: next };
        } else {
          message = `Item not found: "${text}"`;
          jsonData = { notFound: text };
        }
        break;
      }

      case "list_labels": {
        const inventory = listLabelsWithCount(items);
        message =
          inventory.length === 0
            ? "No labels in use"
            : `${inventory.length} label(s) in use: ${inventory
                .map((l) => `${l.label} (${l.count})`)
                .join(", ")}`;
        jsonData = { labels: inventory };
        break;
      }

      default:
        res.status(400).json({ error: `Unknown action: ${action}` });
        return;
    }

    res.json({
      data: { items },
      message,
      jsonData,
      instructions: "Display the updated todo list to the user.",
      updating: true,
    });
  },
);

export default router;
