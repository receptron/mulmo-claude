<template>
  <div class="p-4 border-b border-gray-200 flex items-center justify-between">
    <div>
      <h1
        data-testid="app-title"
        class="text-lg font-semibold"
        :style="titleStyle"
      >
        MulmoClaude
      </h1>
    </div>
    <div class="flex gap-2">
      <LockStatusPopup
        ref="lockPopup"
        :sandbox-enabled="sandboxEnabled"
        :open="lockPopupOpen"
        @update:open="lockPopupOpen = $event"
        @test-query="(q) => emit('testQuery', q)"
      />
      <NotificationBell
        :force-close="lockPopupOpen"
        @navigate="(action) => emit('notificationNavigate', action)"
        @update:open="onNotificationOpen"
      />
      <button
        class="text-gray-400 hover:text-gray-700"
        :class="{ 'text-blue-500': showRightSidebar }"
        title="Tool call history"
        @click="emit('toggleRightSidebar')"
      >
        <span class="material-icons">build</span>
      </button>
      <button
        class="text-gray-400 hover:text-gray-700"
        data-testid="settings-btn"
        title="Settings"
        aria-label="Settings"
        @click="emit('openSettings')"
      >
        <span class="material-icons">settings</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  type CSSProperties,
} from "vue";
import LockStatusPopup from "./LockStatusPopup.vue";
import NotificationBell from "./NotificationBell.vue";
import { useClickOutside } from "../composables/useClickOutside";
import type { NotificationPayload } from "../types/notification";

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
