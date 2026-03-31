import path from "path";
import fs from "fs";
import os from "os";
import { BUILTIN_ROLES } from "../src/config/roles.js";
import type { Role } from "../src/config/roles.js";

const rolesDir = path.join(os.homedir(), "mulmoclaude", "roles");

export function loadCustomRoles(): Role[] {
  if (!fs.existsSync(rolesDir)) return [];
  return fs
    .readdirSync(rolesDir)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => {
      try {
        const raw = fs.readFileSync(path.join(rolesDir, f), "utf-8");
        return [JSON.parse(raw) as Role];
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
