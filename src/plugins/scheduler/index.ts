// Two plugins, one shared backend (#824). Both call /api/scheduler;
// the server-side dispatcher already routes per-action via
// TASK_ACTIONS, so the plugins are thin wrappers over the same
// REST contract — they differ only in tool definition (the action
// enum the LLM sees) and in the chat-side view (CalendarView vs
// AutomationsView). The legacy unified `manageScheduler` plugin
// went away with the rename; see plans/refactor-split-manageScheduler-824.md.

import type { PluginEntry } from "../../tools/types";
import type { ToolPlugin } from "../../tools/types";
import type { ToolResult } from "gui-chat-protocol";
import CalendarView from "./CalendarView.vue";
import AutomationsView from "./AutomationsView.vue";
import LegacySchedulerView from "./LegacySchedulerView.vue";
import Preview from "./Preview.vue";
import calendarDefinition from "./calendarDefinition";
import automationsDefinition from "./automationsDefinition";
import { apiPost } from "../../utils/api";
import { API_ROUTES } from "../../config/apiRoutes";
import { makeUuid } from "../../utils/id";

export interface ScheduledItem {
  id: string;
  title: string;
  createdAt: number;
  props: Record<string, string | number | boolean | null>;
}

export interface SchedulerData {
  items: ScheduledItem[];
}

// Shared executor for both plugins — backend dispatch is identical.
// `toolName` is captured by closure so the tool result carries the
// matching name through to the chat history and the View lookup.
function makeExecute(toolName: "manageCalendar" | "manageAutomations"): ToolPlugin<SchedulerData>["execute"] {
  return async function execute(_context, args) {
    const result = await apiPost<ToolResult<SchedulerData>>(API_ROUTES.scheduler.base, args);
    if (!result.ok) {
      return {
        toolName,
        uuid: makeUuid(),
        message: result.error,
      };
    }
    return {
      ...result.data,
      toolName,
      uuid: result.data.uuid ?? makeUuid(),
    };
  };
}

export const manageCalendarPlugin: ToolPlugin<SchedulerData> = {
  toolDefinition: calendarDefinition,
  execute: makeExecute("manageCalendar"),
  isEnabled: () => true,
  generatingMessage: "Updating calendar...",
  viewComponent: CalendarView,
  previewComponent: Preview,
};

export const manageAutomationsPlugin: ToolPlugin<SchedulerData> = {
  toolDefinition: automationsDefinition,
  execute: makeExecute("manageAutomations"),
  isEnabled: () => true,
  generatingMessage: "Managing automations...",
  viewComponent: AutomationsView,
  previewComponent: Preview,
};

// View-only fallback for tool results saved under the pre-split
// `manageScheduler` name. Registered in src/tools/index.ts so
// `getPlugin("manageScheduler")` returns this entry and historical
// chat sessions still render the rich view (LegacySchedulerView
// dispatches to CalendarView or AutomationsView by data shape).
//
// Deliberately a `PluginEntry` (not a `ToolPlugin`) so the absence
// of `execute` / `isEnabled` makes its view-only nature explicit:
// no LLM exposure path, no fresh dispatch, just the historical
// renderer. The tool name is also absent from
// server/agent/plugin-names.ts and src/config/toolNames.ts, so
// new sessions cannot pick it up.
export const legacyManageSchedulerEntry: PluginEntry = {
  toolDefinition: {
    type: "function",
    name: "manageScheduler",
    prompt: "[deprecated] Split into manageCalendar + manageAutomations (#824).",
    description: "[deprecated] Split into manageCalendar + manageAutomations (#824). Kept registered for legacy chat-history rendering only.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  viewComponent: LegacySchedulerView,
  previewComponent: Preview,
};
