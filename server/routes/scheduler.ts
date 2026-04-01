import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { workspacePath } from "../workspace.js";

const router = Router();

export interface ScheduledItem {
  id: string;
  title: string;
  createdAt: number;
  props: Record<string, string | number | boolean | null>;
}

const schedulerFile = () => path.join(workspacePath, "scheduler", "items.json");

function loadItems(): ScheduledItem[] {
  try {
    const file = schedulerFile();
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return [];
  }
}

function sortItems(items: ScheduledItem[]): ScheduledItem[] {
  return [...items].sort((a, b) => {
    const aDate = typeof a.props.date === "string" ? a.props.date : null;
    const bDate = typeof b.props.date === "string" ? b.props.date : null;
    const aTime = typeof a.props.time === "string" ? a.props.time : "00:00";
    const bTime = typeof b.props.time === "string" ? b.props.time : "00:00";
    const aKey = aDate ? `0_${aDate}_${aTime}` : `1_${a.createdAt}`;
    const bKey = bDate ? `0_${bDate}_${bTime}` : `1_${b.createdAt}`;
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
  });
}

function saveItems(items: ScheduledItem[]): void {
  const file = schedulerFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(items, null, 2));
}

interface SchedulerBody {
  action: string;
  title?: string;
  id?: string;
  props?: Record<string, string | number | boolean | null>;
  items?: ScheduledItem[];
}

router.post(
  "/scheduler",
  (req: Request<object, unknown, SchedulerBody>, res: Response) => {
    const { action, title, id, props, items: replaceItems } = req.body;

    let items = loadItems();
    // eslint-disable-next-line no-useless-assignment
    let message = "";
    let jsonData: Record<string, unknown> = {};

    switch (action) {
      case "show":
        message = `Showing ${items.length} scheduled item(s)`;
        break;

      case "add": {
        if (!title) {
          res.status(400).json({ error: "title required" });
          return;
        }
        const item: ScheduledItem = {
          id: `sched_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          title,
          createdAt: Date.now(),
          props: props ?? {},
        };
        items.push(item);
        items = sortItems(items);
        saveItems(items);
        message = `Added: "${title}"`;
        jsonData = { added: item.id };
        break;
      }

      case "delete": {
        if (!id) {
          res.status(400).json({ error: "id required" });
          return;
        }
        const before = items.length;
        items = items.filter((i) => i.id !== id);
        saveItems(items);
        message =
          items.length < before
            ? `Deleted item ${id}`
            : `Item not found: ${id}`;
        jsonData = { deleted: id };
        break;
      }

      case "update": {
        if (!id) {
          res.status(400).json({ error: "id required" });
          return;
        }
        const item = items.find((i) => i.id === id);
        if (item) {
          if (title !== undefined) item.title = title;
          if (props !== undefined) {
            for (const [k, v] of Object.entries(props)) {
              if (v === null) {
                delete item.props[k];
              } else {
                item.props[k] = v;
              }
            }
          }
          items = sortItems(items);
          saveItems(items);
          message = `Updated: "${item.title}"`;
          jsonData = { updated: id };
        } else {
          message = `Item not found: ${id}`;
        }
        break;
      }

      case "replace": {
        if (!Array.isArray(replaceItems)) {
          res.status(400).json({ error: "items array required" });
          return;
        }
        items = sortItems(replaceItems);
        saveItems(items);
        message = `Replaced all items (${items.length} total)`;
        jsonData = { count: items.length };
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
      instructions: "Display the updated scheduler to the user.",
      updating: true,
    });
  },
);

export default router;
