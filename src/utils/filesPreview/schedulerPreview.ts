// Synthesize a ToolResultComplete<SchedulerData> from raw scheduler
// items.json content so FilesView can render it with the calendar
// plugin's view. Extracted from FilesView.vue (#507 step 8).
//
// items.json holds calendar items only — automations live in
// `config/scheduler/tasks.json` and have a different shape. After
// the manageScheduler split (#824) the synthesised tool result is
// tagged `manageCalendar` so the file preview routes to
// CalendarView, not the (long-gone) tab-bar fallback.

import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { SchedulerData, ScheduledItem } from "../../plugins/scheduler/index";
import { WORKSPACE_FILES } from "../../config/workspacePaths";
import { isRecord } from "../types";

function isScheduledItem(value: unknown): value is ScheduledItem {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.title !== "string") return false;
  return true;
}

function isScheduledItemArray(value: unknown): value is ScheduledItem[] {
  return Array.isArray(value) && value.every(isScheduledItem);
}

export function toSchedulerResult(selectedPath: string | null, rawText: string | null): ToolResultComplete<SchedulerData> | null {
  if (selectedPath !== WORKSPACE_FILES.schedulerItems) return null;
  if (rawText === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return null;
  }
  if (!isScheduledItemArray(parsed)) return null;
  return {
    uuid: "files-scheduler-preview",
    toolName: "manageCalendar",
    message: WORKSPACE_FILES.schedulerItems,
    title: "Scheduler",
    data: { items: parsed },
  };
}
