import path from "path";
import fs from "fs";
import os from "os";
import { BUILTIN_ROLES, RoleSchema, type Role } from "../src/config/roles.js";

const rolesDir = path.join(os.homedir(), "mulmoclaude", "roles");

function withSwitchRole(role: Role): Role {
  if (role.availablePlugins.includes("switchRole")) return role;
  return {
    ...role,
    availablePlugins: [...role.availablePlugins, "switchRole"],
  };
}

export function loadCustomRoles(): Role[] {
  if (!fs.existsSync(rolesDir)) return [];
  return fs
    .readdirSync(rolesDir)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => {
      try {
        const raw = fs.readFileSync(path.join(rolesDir, f), "utf-8");
        return [withSwitchRole(RoleSchema.parse(JSON.parse(raw)))];
      } catch {
        return [];
      }
    });
}

export function loadAllRoles(): Role[] {
  const custom = loadCustomRoles();
  const builtIn = BUILTIN_ROLES.filter(
    (r) => !custom.find((c) => c.id === r.id),
  );
  return [...builtIn, ...custom];
}

export function getRole(id: string): Role {
  return loadAllRoles().find((r) => r.id === id) ?? BUILTIN_ROLES[0];
}
