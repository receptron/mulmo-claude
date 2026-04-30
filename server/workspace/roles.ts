import path from "node:path";
import { BUILTIN_ROLES, RoleSchema, type Role } from "../../src/config/roles.js";
import { WORKSPACE_DIRS, workspacePath } from "./paths.js";
import { readdirUnderSync, readTextUnderSync } from "../utils/files/workspace-io.js";

export function loadCustomRoles(): Role[] {
  return readdirUnderSync(workspacePath, WORKSPACE_DIRS.roles)
    .filter((fileName) => fileName.endsWith(".json"))
    .flatMap((fileName) => {
      try {
        const raw = readTextUnderSync(workspacePath, path.posix.join(WORKSPACE_DIRS.roles, fileName));
        if (!raw) return [];
        return [RoleSchema.parse(JSON.parse(raw))];
      } catch {
        return [];
      }
    });
}

export function loadAllRoles(): Role[] {
  const custom = loadCustomRoles();
  const builtIn = BUILTIN_ROLES.filter((role) => !custom.find((customRole) => customRole.id === role.id));
  return [...builtIn, ...custom];
}

export function getRole(roleId: string): Role {
  return loadAllRoles().find((role) => role.id === roleId) ?? BUILTIN_ROLES[0];
}
