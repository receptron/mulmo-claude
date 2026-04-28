import path from "node:path";
import { mkdirSync, statSync, unlinkSync } from "node:fs";
import { WORKSPACE_DIRS, workspacePath } from "../../workspace/paths.js";
import { writeFileAtomicSync } from "./atomic.js";
import { isEnoent } from "./safe.js";

const root = (workspaceRoot?: string) => workspaceRoot ?? workspacePath;

function roleFilePath(roleId: string, workspaceRoot?: string): string {
  return path.join(root(workspaceRoot), WORKSPACE_DIRS.roles, `${roleId}.json`);
}

export function roleExists(roleId: string, workspaceRoot?: string): boolean {
  try {
    statSync(roleFilePath(roleId, workspaceRoot));
    return true;
  } catch {
    return false;
  }
}

// Returns false if not found.
export function deleteRole(roleId: string, workspaceRoot?: string): boolean {
  try {
    unlinkSync(roleFilePath(roleId, workspaceRoot));
    return true;
  } catch (err) {
    if (isEnoent(err)) return false;
    throw err;
  }
}

export function saveRole(roleId: string, data: unknown, workspaceRoot?: string): void {
  const dir = path.join(root(workspaceRoot), WORKSPACE_DIRS.roles);
  mkdirSync(dir, { recursive: true });
  writeFileAtomicSync(roleFilePath(roleId, workspaceRoot), JSON.stringify(data, null, 2));
}
