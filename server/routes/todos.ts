import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { workspacePath } from "../workspace.js";

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
  try {
    const file = todosFile();
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return [];
  }
}

function saveTodos(items: TodoItem[]): void {
  fs.writeFileSync(todosFile(), JSON.stringify(items, null, 2));
}

interface TodoBody {
  action: string;
  text?: string;
  newText?: string;
  note?: string;
}

router.post(
  "/todos",
  (req: Request<object, unknown, TodoBody>, res: Response) => {
    const { action, text, newText, note } = req.body;

    let items = loadTodos();
    // eslint-disable-next-line no-useless-assignment
    let message = "";
    let jsonData: Record<string, unknown> = {};

    switch (action) {
      case "show":
        message = `Showing ${items.length} todo item(s)`;
        jsonData = {
          items: items.map((i) => ({ text: i.text, completed: i.completed })),
        };
        break;

      case "add": {
        if (!text) {
          res.status(400).json({ error: "text required" });
          return;
        }
        const item: TodoItem = {
          id: `todo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          text,
          ...(note !== undefined && { note }),
          completed: false,
          createdAt: Date.now(),
        };
        items.push(item);
        saveTodos(items);
        message = `Added: "${text}"`;
        jsonData = { added: text };
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
