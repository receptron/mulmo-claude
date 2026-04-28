import { WORKSPACE_FILES, workspacePath } from "../../workspace/paths.js";
import { resolvePath } from "./workspace-io.js";
import { loadJsonFile } from "./json.js";
import { writeFileAtomicSync } from "./atomic.js";

const root = (workspaceRoot?: string) => workspaceRoot ?? workspacePath;

export function loadSchedulerItems<T>(fallback: T, workspaceRoot?: string): T {
  return loadJsonFile(resolvePath(root(workspaceRoot), WORKSPACE_FILES.schedulerItems), fallback);
}

export function saveSchedulerItems(items: unknown, workspaceRoot?: string): void {
  writeFileAtomicSync(resolvePath(root(workspaceRoot), WORKSPACE_FILES.schedulerItems), JSON.stringify(items, null, 2));
}
