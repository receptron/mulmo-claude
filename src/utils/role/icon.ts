// Pure helpers that look up role metadata from a list of roles.
// Taking the role list as a parameter (instead of reading a Vue ref)
// keeps these dependency-free and unit-testable.

import type { Role } from "../../config/roles";

// Material Icon names use lowercase letters and underscores only.
// Custom roles may have stored an emoji or other freeform value in
// the icon field; fall back to a generic icon in that case so we
// don't render the literal text inside a Material Icons span.
const MATERIAL_ICON_RE = /^[a-z_]+$/;

export function roleIcon(roles: Role[], roleId: string): string {
  const icon = roles.find((role) => role.id === roleId)?.icon ?? "star";
  return MATERIAL_ICON_RE.test(icon) ? icon : "smart_toy";
}

export function roleName(roles: Role[], roleId: string): string {
  return roles.find((role) => role.id === roleId)?.name ?? roleId;
}
