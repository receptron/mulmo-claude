// Synthesize a ToolResultComplete<TodoData> from raw todos.json
// content so FilesView can render it with the TodoExplorer.
// Extracted from FilesView.vue (#507 step 8).

import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type {
  StatusColumn,
  TodoData,
  TodoItem,
} from "../../plugins/todo/index";
import { WORKSPACE_FILES } from "../../config/workspacePaths";
import { isRecord } from "../types";

function isTodoItem(x: unknown): x is TodoItem {
  if (!isRecord(x)) return false;
  if (typeof x["id"] !== "string" || typeof x["text"] !== "string")
    return false;
  if (typeof x["completed"] !== "boolean") return false;
  if (typeof x["createdAt"] !== "number") return false;
  return true;
}

function isTodoItemArray(x: unknown): x is TodoItem[] {
  return Array.isArray(x) && x.every(isTodoItem);
}

export function toTodoExplorerResult(
  selectedPath: string | null,
  rawText: string | null,
): ToolResultComplete<TodoData> | null {
  if (selectedPath !== WORKSPACE_FILES.todosItems) return null;
  if (rawText === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return null;
  }
  const items: TodoItem[] = isTodoItemArray(parsed) ? parsed : [];
  const columns: StatusColumn[] = [];
  return {
    uuid: "files-todo-preview",
    toolName: "manageTodoList",
    message: WORKSPACE_FILES.todosItems,
    title: "Todo",
    data: { items, columns },
  };
}
