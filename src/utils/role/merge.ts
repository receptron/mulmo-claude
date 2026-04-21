// Pure helper for merging custom (server-loaded) roles into the
// built-in role list. Custom roles override built-ins with the
// same id, then any additional custom roles are appended.

import type { Role } from "../../config/roles";

export function mergeRoles(builtin: Role[], custom: Role[]): Role[] {
  const customIds = new Set(custom.map((role) => role.id));
  return [...builtin.filter((role) => !customIds.has(role.id)), ...custom];
}
