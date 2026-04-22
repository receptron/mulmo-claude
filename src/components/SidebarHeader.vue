<template>
  <div class="flex items-center gap-2">
    <img :src="logoUrl" alt="" class="h-[50px] w-auto -my-3.5 -ml-3 rounded object-contain shrink-0" />
    <h1 data-testid="app-title" class="text-sm font-semibold text-gray-800 mr-1" :style="titleStyle">MulmoClaude</h1>
    <div class="flex gap-2">
      <LockStatusPopup
        ref="lockPopup"
        :sandbox-enabled="sandboxEnabled"
        :open="lockPopupOpen"
        @update:open="lockPopupOpen = $event"
        @test-query="(q) => emit('testQuery', q)"
      />
      <NotificationBell :force-close="lockPopupOpen" @navigate="(action) => emit('notificationNavigate', action)" @update:open="onNotificationOpen" />
      <button
        class="text-gray-400 hover:text-gray-700"
        :class="{ 'text-blue-500': showRightSidebar }"
        :title="t('sidebarHeader.toolCallHistory')"
        @click="emit('toggleRightSidebar')"
      >
        <span class="material-icons">build</span>
      </button>
      <button
        class="text-gray-400 hover:text-gray-700"
        data-testid="settings-btn"
        :title="t('sidebarHeader.settings')"
        :aria-label="t('sidebarHeader.settings')"
        @click="emit('openSettings')"
      >
        <span class="material-icons">settings</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, type CSSProperties } from "vue";
import { useI18n } from "vue-i18n";
import LockStatusPopup from "./LockStatusPopup.vue";
import NotificationBell from "./NotificationBell.vue";
import { useClickOutside } from "../composables/useClickOutside";
import type { NotificationPayload } from "../types/notification";
import logoUrl from "../assets/mulmo_bw.png";

const { t } = useI18n();

defineProps<{
  sandboxEnabled: boolean;
  showRightSidebar: boolean;
  titleStyle?: CSSProperties;
}>();

const emit = defineEmits<{
  testQuery: [query: string];
  notificationNavigate: [action: NotificationPayload["action"]];
  toggleRightSidebar: [];
  openSettings: [];
}>();

const lockPopupOpen = ref(false);
const lockPopup = ref<{
  button: HTMLButtonElement | null;
  popup: HTMLDivElement | null;
} | null>(null);
const lockButton = computed(() => lockPopup.value?.button ?? null);
const lockPopupEl = computed(() => lockPopup.value?.popup ?? null);

const { handler } = useClickOutside({
  isOpen: lockPopupOpen,
  buttonRef: lockButton,
  popupRef: lockPopupEl,
});
onMounted(() => document.addEventListener("mousedown", handler));
onBeforeUnmount(() => document.removeEventListener("mousedown", handler));

function onNotificationOpen(isOpen: boolean): void {
  if (isOpen) lockPopupOpen.value = false;
}
</script>
