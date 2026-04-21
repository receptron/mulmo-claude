import type { ToolPlugin } from "../../tools/types";
import type { ToolResult } from "gui-chat-protocol";
import View from "./View.vue";
import Preview from "./Preview.vue";
import toolDefinition from "./definition";
import { apiPost } from "../../utils/api";
import { API_ROUTES } from "../../config/apiRoutes";

export type TodoPriority = "low" | "medium" | "high" | "urgent";

export interface TodoItem {
  id: string;
  text: string;
  note?: string;
  labels?: string[];
  completed: boolean;
  createdAt: number;
  // ── Added for the file-explorer kanban view ──
  status?: string;
  priority?: TodoPriority;
  dueDate?: string;
  order?: number;
}

export interface StatusColumn {
  id: string;
  label: string;
  isDone?: boolean;
}

export interface TodoData {
  items: TodoItem[];
  columns?: StatusColumn[];
}

const todoPlugin: ToolPlugin<TodoData> = {
  toolDefinition,

  async execute(_context, args) {
    const result = await apiPost<ToolResult<TodoData>>(API_ROUTES.todos.dispatch, args);
    if (!result.ok) {
      return {
        toolName: "manageTodoList",
        uuid: crypto.randomUUID(),
        message: result.error,
      };
    }
    return {
      ...result.data,
      toolName: "manageTodoList",
      uuid: result.data.uuid ?? crypto.randomUUID(),
    };
  },

  isEnabled: () => true,
  generatingMessage: "Managing todos...",
  viewComponent: View,
  previewComponent: Preview,
};

export default todoPlugin;
