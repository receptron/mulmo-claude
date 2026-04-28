import path from "path";
import { mkdir } from "fs/promises";
import { WORKSPACE_FILES } from "../../workspace/paths.js";
import { workspacePath } from "../../workspace/paths.js";
import { resolvePath } from "./workspace-io.js";
import { loadJsonFile } from "./json.js";
import { writeFileAtomic } from "./atomic.js";

const root = (workspaceRoot?: string) => workspaceRoot ?? workspacePath;

export function loadUserTasks<T>(workspaceRoot?: string): T[] {
  const tasks = loadJsonFile<T[]>(resolvePath(root(workspaceRoot), WORKSPACE_FILES.schedulerUserTasks), []);
  return Array.isArray(tasks) ? tasks : [];
}

export async function saveUserTasks<T>(tasks: T[], workspaceRoot?: string): Promise<void> {
  const filePath = resolvePath(root(workspaceRoot), WORKSPACE_FILES.schedulerUserTasks);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFileAtomic(filePath, JSON.stringify(tasks, null, 2));
}
