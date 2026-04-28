// #824: two plugins share /api/scheduler — the server already dispatches per-action via TASK_ACTIONS, so each plugin
// just differs in the tool definition (action enum the LLM sees) and the View component.

import type { PluginEntry, ToolPlugin } from "../../tools/types";
import type { ToolResult } from "gui-chat-protocol";
import CalendarView from "./CalendarView.vue";
import AutomationsView from "./AutomationsView.vue";
import LegacySchedulerView from "./LegacySchedulerView.vue";
import Preview from "./Preview.vue";
import AutomationsPreview from "./AutomationsPreview.vue";
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

// `toolName` is captured so the result carries the matching name through to chat history and View lookup.
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
  // Cannot share Preview.vue with manageCalendar — Preview auto-refreshes from /api/scheduler (calendar items), and
  // the automations sidebar would otherwise show calendar data after the first refresh tick (#828 follow-up).
  previewComponent: AutomationsPreview,
};

// View-only legacy fallback so historical sessions saved under the pre-split `manageScheduler` name still render.
// `PluginEntry` (no execute/isEnabled) makes it explicit: no LLM exposure, no fresh dispatch, render-only.
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
