import type { ToolPlugin } from "../../tools/types";
import View from "./View.vue";
import Preview from "./Preview.vue";
import toolDefinition from "./definition";

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
    const response = await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    const result = await response.json();
    return {
      ...result,
      toolName: "manageTodoList",
      uuid: result.uuid ?? crypto.randomUUID(),
    };
  },

  isEnabled: () => true,
  generatingMessage: "Managing todos...",
  systemPrompt:
    "When users mention tasks, things to do, or ask about their todo list, use manageTodoList to help them track items.",
  viewComponent: View,
  previewComponent: Preview,
};

export default todoPlugin;
