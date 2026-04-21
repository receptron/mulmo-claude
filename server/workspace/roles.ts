import path from "node:path";
import { BUILTIN_ROLES, RoleSchema, type Role } from "../../src/config/roles.js";
import { WORKSPACE_DIRS } from "./paths.js";
import { readdirUnderSync, readTextUnderSync } from "../utils/files/workspace-io.js";
import { workspacePath } from "./paths.js";

function withSwitchRole(role: Role): Role {
  if (role.availablePlugins.includes("switchRole")) return role;
  return {
    ...role,
    availablePlugins: [...role.availablePlugins, "switchRole"],
  };
}

export function loadCustomRoles(): Role[] {
  return readdirUnderSync(workspacePath, WORKSPACE_DIRS.roles)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => {
      try {
        const raw = readTextUnderSync(workspacePath, path.posix.join(WORKSPACE_DIRS.roles, f));
        if (!raw) return [];
        return [withSwitchRole(RoleSchema.parse(JSON.parse(raw)))];
      } catch {
        return [];
      }
    });
}

export function loadAllRoles(): Role[] {
  const custom = loadCustomRoles();
  const builtIn = BUILTIN_ROLES.filter((r) => !custom.find((c) => c.id === r.id));
  return [...builtIn, ...custom];
}

export function getRole(id: string): Role {
  return loadAllRoles().find((r) => r.id === id) ?? BUILTIN_ROLES[0];
}
