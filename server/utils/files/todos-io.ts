import { WORKSPACE_FILES } from "../../workspace/paths.js";
import { workspacePath } from "../../workspace/paths.js";
import { resolvePath } from "./workspace-io.js";
import { loadJsonFile } from "./json.js";
import { writeFileAtomicSync } from "./atomic.js";

const root = (workspaceRoot?: string) => workspaceRoot ?? workspacePath;

export function loadTodos<T>(fallback: T, workspaceRoot?: string): T {
  return loadJsonFile(resolvePath(root(workspaceRoot), WORKSPACE_FILES.todosItems), fallback);
}

export function saveTodos(items: unknown, workspaceRoot?: string): void {
  writeFileAtomicSync(resolvePath(root(workspaceRoot), WORKSPACE_FILES.todosItems), JSON.stringify(items, null, 2));
}

export function loadColumns<T>(fallback: T, workspaceRoot?: string): T {
  return loadJsonFile(resolvePath(root(workspaceRoot), WORKSPACE_FILES.todosColumns), fallback);
}

export function saveColumns(columns: unknown, workspaceRoot?: string): void {
  writeFileAtomicSync(resolvePath(root(workspaceRoot), WORKSPACE_FILES.todosColumns), JSON.stringify(columns, null, 2));
}
