// Composable that owns the active role list, the currently
// selected role id, and the refresh-from-server fetch. The merge
// rule lives in src/utils/roleMerge so it can be unit-tested
// independently.

import { computed, ref, type ComputedRef, type Ref } from "vue";
import { API_ROUTES } from "../config/apiRoutes";
import { ROLES, type Role } from "../config/roles";
import { mergeRoles } from "../utils/role/merge";
import { apiGet } from "../utils/api";

export function useRoles(): {
  roles: Ref<Role[]>;
  currentRoleId: Ref<string>;
  currentRole: ComputedRef<Role>;
  refreshRoles: () => Promise<void>;
} {
  const roles = ref<Role[]>(ROLES);
  const currentRoleId = ref(ROLES[0].id);
  const currentRole = computed(() => roles.value.find((r) => r.id === currentRoleId.value) ?? roles.value[0]);

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

  return { roles, currentRoleId, currentRole, refreshRoles };
}
