import type { ToolPlugin } from "../../tools/types";
import View from "./View.vue";
import Preview from "./Preview.vue";

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
  toolDefinition: {
    type: "function",
    name: "manageScheduler",
    description:
      "Manage a scheduler — show, add, update, or delete scheduled items. Each item has a title and dynamic properties (e.g. date, time, location, description). Use this whenever the user mentions events, appointments, reminders, or things to schedule.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["show", "add", "delete", "update"],
          description: "Action to perform on the scheduler.",
        },
        title: {
          type: "string",
          description: "For 'add': the item title. For 'update': new title (optional).",
        },
        id: {
          type: "string",
          description: "For 'delete' and 'update': the item id.",
        },
        props: {
          type: "object",
          description:
            "For 'add': initial properties (e.g. { date, time, location }). For 'update': properties to merge in; set a key to null to remove it.",
          additionalProperties: true,
        },
      },
      required: ["action"],
    },
  },

  async execute(_context, args) {
    const response = await fetch("/api/scheduler", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
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
