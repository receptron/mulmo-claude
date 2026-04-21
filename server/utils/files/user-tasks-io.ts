// Domain I/O: user-created scheduled tasks
//   config/scheduler/tasks.json
//
// Optional `root` parameter for test DI (defaults to workspacePath).

import path from "path";
import { mkdir } from "fs/promises";
import { WORKSPACE_FILES } from "../../workspace/paths.js";
import { workspacePath } from "../../workspace/paths.js";
import { resolvePath } from "./workspace-io.js";
import { loadJsonFile } from "./json.js";
import { writeFileAtomic } from "./atomic.js";

const root = (r?: string) => r ?? workspacePath;

export function loadUserTasks<T>(r?: string): T[] {
  const tasks = loadJsonFile<T[]>(resolvePath(root(r), WORKSPACE_FILES.schedulerUserTasks), []);
  return Array.isArray(tasks) ? tasks : [];
}

export async function saveUserTasks<T>(tasks: T[], r?: string): Promise<void> {
  const filePath = resolvePath(root(r), WORKSPACE_FILES.schedulerUserTasks);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFileAtomic(filePath, JSON.stringify(tasks, null, 2));
}
