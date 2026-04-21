// Domain I/O: todo items + status columns
//   data/todos/todos.json     — items
//   data/todos/columns.json   — status columns
//
// Sync API. Optional `root` for test DI.

import { WORKSPACE_FILES } from "../../workspace/paths.js";
import { workspacePath } from "../../workspace/paths.js";
import { resolvePath } from "./workspace-io.js";
import { loadJsonFile } from "./json.js";
import { writeFileAtomicSync } from "./atomic.js";

const root = (r?: string) => r ?? workspacePath;

export function loadTodos<T>(fallback: T, r?: string): T {
  return loadJsonFile(resolvePath(root(r), WORKSPACE_FILES.todosItems), fallback);
}

export function saveTodos(items: unknown, r?: string): void {
  writeFileAtomicSync(resolvePath(root(r), WORKSPACE_FILES.todosItems), JSON.stringify(items, null, 2));
}

export function loadColumns<T>(fallback: T, r?: string): T {
  return loadJsonFile(resolvePath(root(r), WORKSPACE_FILES.todosColumns), fallback);
}

export function saveColumns(columns: unknown, r?: string): void {
  writeFileAtomicSync(resolvePath(root(r), WORKSPACE_FILES.todosColumns), JSON.stringify(columns, null, 2));
}
