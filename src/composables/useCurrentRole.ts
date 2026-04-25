// Singleton state for the role-selector dropdown's selected role.
// Lives at module scope so SessionHeaderControls — which mounts and
// unmounts whenever the session-history side panel toggles — keeps
// the user's choice across remounts, and so App.vue can read the
// current selection when creating a new session for callers that
// don't pass an explicit roleId (e.g. wiki composer's
// `appApi.startNewChat(message)` — see useAppApi).

import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import type { Role } from "../config/roles";

const currentRoleId = ref<string>("");

export function useCurrentRole(roles: Ref<Role[]> | ComputedRef<Role[]>): {
  currentRoleId: Ref<string>;
  currentRole: ComputedRef<Role>;
} {
  // Seed once roles arrive (the initial fetch is async) and re-seed
  // if the chosen id disappears from the list (e.g. a custom role
  // was deleted out from under us).
  watch(
    roles,
    (next) => {
      if (next.length === 0) return;
      const exists = next.some((role) => role.id === currentRoleId.value);
      if (!exists) currentRoleId.value = next[0].id;
    },
    { immediate: true },
  );
  const currentRole = computed(() => roles.value.find((role) => role.id === currentRoleId.value) ?? roles.value[0]);
  return { currentRoleId, currentRole };
}
