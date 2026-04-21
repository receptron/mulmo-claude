import type { ToolPlugin } from "../../tools/types";
import type { ToolResult } from "gui-chat-protocol";
import View from "./View.vue";
import Preview from "./Preview.vue";
import toolDefinition from "./definition";
import { apiPost } from "../../utils/api";
import { API_ROUTES } from "../../config/apiRoutes";

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
    const result = await apiPost<ToolResult<SchedulerData>>(API_ROUTES.scheduler.base, args);
    if (!result.ok) {
      return {
        toolName: "manageScheduler",
        uuid: crypto.randomUUID(),
        message: result.error,
      };
    }
    return {
      ...result.data,
      toolName: "manageScheduler",
      uuid: result.data.uuid ?? crypto.randomUUID(),
    };
  },

  isEnabled: () => true,
  generatingMessage: "Managing schedule...",
  viewComponent: View,
  previewComponent: Preview,
};

export default schedulerPlugin;
