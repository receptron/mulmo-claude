import type { ToolPlugin } from "../../tools/types";
import View from "./View.vue";
import Preview from "./Preview.vue";
import toolDefinition from "./definition";

export interface ScheduledItem {
  id: string;
  title: string;
  createdAt: number;
  props: Record<string, string | number | boolean | null>;
}

export interface SchedulerData {
  items: ScheduledItem[];
}

const schedulerPlugin: ToolPlugin<SchedulerData> = {
  toolDefinition,

  async execute(_context, args) {
    const typedArgs = args as Record<string, unknown>;
    const ICAL_ACTION_MAP: Record<string, string> = {
      add_ical_source: "add_source",
      remove_ical_source: "remove_source",
      list_ical_sources: "list_sources",
      sync_ical: "sync",
    };
    const action = typedArgs.action as string;
    const icalAction = ICAL_ACTION_MAP[action];

    const endpoint = icalAction ? "/api/ical" : "/api/scheduler";
    const body = icalAction
      ? {
          action: icalAction,
          name: typedArgs.name,
          url: typedArgs.icalUrl,
          sourceId: typedArgs.sourceId,
        }
      : args;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    return {
      ...result,
      toolName: "manageScheduler",
      uuid: result.uuid ?? crypto.randomUUID(),
    };
  },

  isEnabled: () => true,
  generatingMessage: "Managing schedule...",
  systemPrompt:
    "When users mention events, appointments, meetings, or things to schedule, use manageScheduler to help them track them. Store relevant details (date, time, location, etc.) as props.",
  viewComponent: View,
  previewComponent: Preview,
};

export default schedulerPlugin;
