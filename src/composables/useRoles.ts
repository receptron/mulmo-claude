// Composable that owns the active role list and its server-merge
// fetch. The selected role is owned by SessionHeaderControls via
// useCurrentRole — selection is a UI-local concern and lives next
// to the dropdown that drives it.

import { ref, type Ref } from "vue";
import { API_ROUTES } from "../config/apiRoutes";
import { ROLES, type Role } from "../config/roles";
import { mergeRoles } from "../utils/role/merge";
import { apiGet } from "../utils/api";

export function useRoles(): {
  roles: Ref<Role[]>;
  refreshRoles: () => Promise<void>;
} {
  const roles = ref<Role[]>(ROLES);

  async function refreshRoles(): Promise<void> {
    const result = await apiGet<Role[]>(API_ROUTES.roles.list);
    if (!result.ok) {
      // Keep the current role list on failure — losing custom roles
      // is preferable to crashing the UI on a transient API hiccup.
      console.warn(`[useRoles] refreshRoles failed: ${result.status} ${result.error}`);
      return;
    }
    roles.value = mergeRoles(ROLES, result.data);
  }

  return { roles, refreshRoles };
}
