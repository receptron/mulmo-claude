// Domain I/O: custom roles
//   config/roles/<id>.json
//
// Optional `root` for test DI.

import path from "node:path";
import fs from "node:fs";
import { WORKSPACE_DIRS } from "../../workspace/paths.js";
import { workspacePath } from "../../workspace/paths.js";
import { writeFileAtomicSync } from "./atomic.js";
import { isEnoent } from "./safe.js";

const root = (r?: string) => r ?? workspacePath;

function roleFilePath(id: string, r?: string): string {
  return path.join(root(r), WORKSPACE_DIRS.roles, `${id}.json`);
}

/** Check if a custom role file exists. */
export function roleExists(id: string, r?: string): boolean {
  try {
    fs.statSync(roleFilePath(id, r));
    return true;
  } catch {
    return false;
  }
}

/** Delete a custom role file. Returns false if not found. */
export function deleteRole(id: string, r?: string): boolean {
  try {
    fs.unlinkSync(roleFilePath(id, r));
    return true;
  } catch (err) {
    if (isEnoent(err)) return false;
    throw err;
  }
}

/** Save (create or overwrite) a custom role file atomically. */
export function saveRole(id: string, data: unknown, r?: string): void {
  const dir = path.join(root(r), WORKSPACE_DIRS.roles);
  fs.mkdirSync(dir, { recursive: true });
  writeFileAtomicSync(roleFilePath(id, r), JSON.stringify(data, null, 2));
}
