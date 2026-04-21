// Domain I/O: scheduler items
//   data/scheduler/items.json
//
// Sync API. Optional `root` for test DI.

import { WORKSPACE_FILES } from "../../workspace/paths.js";
import { workspacePath } from "../../workspace/paths.js";
import { resolvePath } from "./workspace-io.js";
import { loadJsonFile } from "./json.js";
import { writeFileAtomicSync } from "./atomic.js";

const root = (r?: string) => r ?? workspacePath;

export function loadSchedulerItems<T>(fallback: T, r?: string): T {
  return loadJsonFile(resolvePath(root(r), WORKSPACE_FILES.schedulerItems), fallback);
}

export function saveSchedulerItems(items: unknown, r?: string): void {
  writeFileAtomicSync(resolvePath(root(r), WORKSPACE_FILES.schedulerItems), JSON.stringify(items, null, 2));
}
