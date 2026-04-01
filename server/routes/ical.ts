import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import ical from "node-ical";
import { workspacePath } from "../workspace.js";
import type { ScheduledItem } from "./scheduler.js";

const router = Router();

interface IcalSource {
  id: string;
  name: string;
  url: string;
}

const TIMEOUT_MS = 15_000;

const sourcesFile = () =>
  path.join(workspacePath, "scheduler", "ical-sources.json");

function loadSources(): IcalSource[] {
  try {
    const file = sourcesFile();
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return [];
  }
}

function saveSources(sources: IcalSource[]): void {
  const file = sourcesFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(sources, null, 2));
}

function extractStringValue(val: unknown): string | undefined {
  if (typeof val === "string") return val;
  if (val && typeof val === "object" && "val" in val) {
    const inner = (val as { val: unknown }).val;
    if (typeof inner === "string") return inner;
  }
  return undefined;
}

function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTime(d: Date): string {
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function veventToScheduledItem(
  event: ical.VEvent,
  sourceId: string,
): ScheduledItem {
  const title = extractStringValue(event.summary) ?? "(no title)";
  const props: Record<string, string | number | boolean | null> = {
    source: "ical",
    sourceId,
    uid: event.uid,
  };

  if (event.start) {
    props.date = formatDate(event.start);
    const isAllDay =
      (event as unknown as { datetype?: string }).datetype === "date";
    if (!isAllDay) {
      props.time = formatTime(event.start);
    }
  }

  if (event.end) {
    props.endDate = formatDate(event.end);
    const isAllDay =
      (event as unknown as { datetype?: string }).datetype === "date";
    if (!isAllDay) {
      props.endTime = formatTime(event.end);
    }
  }

  const location = extractStringValue(event.location);
  if (location) props.location = location;

  const description = extractStringValue(event.description);
  if (description) props.description = description;

  return {
    id: `ical_${sourceId}_${event.uid}`,
    title,
    createdAt: Date.now(),
    props,
  };
}

async function fetchIcalEvents(
  url: string,
  sourceId: string,
): Promise<ScheduledItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    const data = ical.sync.parseICS(text);

    const items: ScheduledItem[] = [];
    for (const entry of Object.values(data)) {
      if (entry.type === "VEVENT") {
        items.push(veventToScheduledItem(entry as ical.VEvent, sourceId));
      }
    }
    return items;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Scheduler items I/O (reuse same file as scheduler route) ────────────────

const schedulerFile = () => path.join(workspacePath, "scheduler", "items.json");

function loadSchedulerItems(): ScheduledItem[] {
  try {
    const file = schedulerFile();
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return [];
  }
}

function saveSchedulerItems(items: ScheduledItem[]): void {
  const file = schedulerFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(items, null, 2));
}

// ── Routes ──────────────────────────────────────────────────────────────────

router.post("/ical", async (req: Request, res: Response) => {
  const { action, name, url, sourceId } = req.body as {
    action: string;
    name?: string;
    url?: string;
    sourceId?: string;
  };

  switch (action) {
    case "list_sources": {
      const sources = loadSources();
      res.json({
        data: { sources },
        message: `${sources.length} iCal source(s) configured`,
        instructions:
          "Show the list of iCal sources to the user. If empty, suggest adding one.",
      });
      return;
    }

    case "add_source": {
      if (!name || !url) {
        res.status(400).json({ error: "name and url are required" });
        return;
      }
      const sources = loadSources();
      const newSource: IcalSource = {
        id: `src_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name,
        url,
      };
      sources.push(newSource);
      saveSources(sources);
      res.json({
        data: { sources },
        message: `Added iCal source: "${name}"`,
        jsonData: { added: newSource.id },
        instructions:
          "Confirm to the user that the source was added. Suggest running sync_ical to import events.",
      });
      return;
    }

    case "remove_source": {
      if (!sourceId) {
        res.status(400).json({ error: "sourceId is required" });
        return;
      }
      const sources = loadSources();
      const filtered = sources.filter((s) => s.id !== sourceId);
      saveSources(filtered);

      // Also remove imported items from this source
      const items = loadSchedulerItems();
      const cleanedItems = items.filter((i) => i.props.sourceId !== sourceId);
      saveSchedulerItems(cleanedItems);

      res.json({
        data: { sources: filtered },
        message: `Removed iCal source and its imported events`,
        jsonData: { removed: sourceId },
        instructions: "Confirm removal to the user.",
      });
      return;
    }

    case "sync": {
      const sources = loadSources();
      if (sources.length === 0) {
        res.json({
          data: { items: loadSchedulerItems() },
          message: "No iCal sources configured. Add one first.",
          instructions:
            "Tell the user there are no iCal sources. Suggest adding one with add_ical_source.",
        });
        return;
      }

      const errors: string[] = [];
      const allImported: ScheduledItem[] = [];

      for (const source of sources) {
        try {
          const events = await fetchIcalEvents(source.url, source.id);
          allImported.push(...events);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push(`${source.name}: ${msg}`);
        }
      }

      // Merge: keep manual items, replace all ical items
      const items = loadSchedulerItems();
      const manualItems = items.filter((i) => i.props.source !== "ical");
      const merged = [...manualItems, ...allImported];
      saveSchedulerItems(merged);

      const message =
        errors.length > 0
          ? `Synced ${allImported.length} event(s) with ${errors.length} error(s): ${errors.join("; ")}`
          : `Synced ${allImported.length} event(s) from ${sources.length} source(s)`;

      res.json({
        data: { items: merged },
        message,
        jsonData: { imported: allImported.length, errors: errors.length },
        instructions: "Display the updated scheduler to the user.",
        updating: true,
      });
      return;
    }

    default:
      res.status(400).json({ error: `Unknown action: ${action}` });
  }
});

export default router;
