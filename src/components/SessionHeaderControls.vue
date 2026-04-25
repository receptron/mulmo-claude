<template>
  <!-- Shared header cluster: role selector + new-session + side-panel
       toggle. Rendered in two places:
       1. Row 2 (top bar) when the session-history side panel is closed
       2. The side-panel's own header row when it's open
       The outer is `w-full`; parents constrain the width (the Row 2
       wrapper forces 264px to match the side-panel's internal width,
       so the controls don't visually shift when the panel toggles).
       Toggle behaviour differs slightly between callers — the side
       panel also collapses when hidden — so we emit a plain
       `update:sidePanelVisible` and let the parent decide.

       This component owns the dropdown's selected role via
       useCurrentRole (module-singleton state). The "+" button reads
       it and forwards it through `newSession` so callers don't need
       to track the selection themselves. -->
  <div class="flex items-center gap-2 w-full min-w-0">
    <RoleSelector v-model:current-role-id="currentRoleId" :roles="roles" fluid @change="emit('roleChange', currentRoleId)" />
    <div class="flex items-center gap-0.5 shrink-0">
      <button
        class="flex-shrink-0 h-8 w-8 flex items-center justify-center rounded border border-dashed border-gray-300 text-gray-400 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50 transition-colors"
        data-testid="new-session-btn"
        :title="t('sessionTabBar.newSession')"
        :aria-label="t('sessionTabBar.newSession')"
        @click="emit('newSession', currentRoleId)"
      >
        <span class="material-icons text-sm">add</span>
      </button>
      <SessionHistoryToggleButton
        :model-value="sidePanelVisible"
        :active-session-count="activeSessionCount"
        :unread-count="unreadCount"
        @update:model-value="(value: boolean) => emit('update:sidePanelVisible', value)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { toRef } from "vue";
import { useI18n } from "vue-i18n";
import type { Role } from "../config/roles";
import { useCurrentRole } from "../composables/useCurrentRole";
import RoleSelector from "./RoleSelector.vue";
import SessionHistoryToggleButton from "./SessionHistoryToggleButton.vue";

const { t } = useI18n();

const props = defineProps<{
  roles: Role[];
  sidePanelVisible: boolean;
  activeSessionCount: number;
  unreadCount: number;
}>();

const emit = defineEmits<{
  roleChange: [roleId: string];
  newSession: [roleId: string];
  "update:sidePanelVisible": [value: boolean];
}>();

const { currentRoleId } = useCurrentRole(toRef(props, "roles"));
</script>
