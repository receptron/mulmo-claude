// Composable that owns the active role list and its server-merge
// fetch. The selected role is owned by SessionHeaderControls via
// useCurrentRole — selection is a UI-local concern and lives next
// to the dropdown that drives it.

import { computed, ref, type Ref } from "vue";
import { API_ROUTES } from "../config/apiRoutes";
import { BUILTIN_ROLE_IDS, ROLES, type Role } from "../config/roles";
import { mergeRoles } from "../utils/role/merge";
import { apiGet } from "../utils/api";
import { useSystemConfig } from "./useSystemConfig";

export function applyDevModeFilter(allRoles: Role[], isDevMode: boolean): Role[] {
  if (isDevMode) return allRoles;
  return allRoles.filter((role) => role.id !== BUILTIN_ROLE_IDS.debug);
}

export function useRoles(): {
  roles: Ref<Role[]>;
  refreshRoles: () => Promise<void>;
} {
  // Composable invocation must happen inside the function body, not
  // at module top level. `useSystemConfig` triggers an `apiGet` on
  // first call; the bearer token is set from main.ts at boot, so the
  // first invocation has to land in setup-function timing (App.vue's
  // `<script setup>`) rather than during static module evaluation.
  const { devMode } = useSystemConfig();
  const allRoles = ref<Role[]>(ROLES);
  // Reactive: when `useSystemConfig` resolves and flips devMode, the
  // filtered list updates without consumers re-subscribing.
  const roles = computed(() => applyDevModeFilter(allRoles.value, devMode.value));

  async function refreshRoles(): Promise<void> {
    const result = await apiGet<Role[]>(API_ROUTES.roles.list);
    if (!result.ok) {
      // Keep the current role list on failure — losing custom roles
      // is preferable to crashing the UI on a transient API hiccup.
      console.warn(`[useRoles] refreshRoles failed: ${result.status} ${result.error}`);
      return;
    }
    allRoles.value = mergeRoles(ROLES, result.data);
  }

  return { roles, refreshRoles };
}
