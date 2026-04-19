<script setup lang="ts">
import { ref, watch } from "vue";
import {
  useNotifications,
  type NotificationItem,
} from "../composables/useNotifications";

// Simple top-right toast — PoC for #144. A production notification
// center would stack / persist / auto-dismiss per-item with
// configurable duration; this one just shows the latest inbound
// message for `AUTO_HIDE_MS` before fading. Anything new that
// arrives while a toast is up replaces the current one.

const AUTO_HIDE_MS = 5000;

const { latest } = useNotifications();
const visible = ref<NotificationItem | null>(null);
let hideTimer: ReturnType<typeof setTimeout> | null = null;

watch(latest, (item) => {
  if (!item) return;
  visible.value = item;
  if (hideTimer !== null) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    visible.value = null;
    hideTimer = null;
  }, AUTO_HIDE_MS);
});

function dismiss(): void {
  if (hideTimer !== null) clearTimeout(hideTimer);
  hideTimer = null;
  visible.value = null;
}
</script>

<template>
  <Transition name="toast">
    <div
      v-if="visible"
      data-testid="notification-toast"
      class="fixed top-4 right-4 z-50 max-w-sm rounded-lg bg-slate-800 text-white shadow-lg p-4 flex items-start gap-3"
    >
      <span class="material-icons text-sky-300" aria-hidden="true">
        notifications
      </span>
      <div class="flex-1 min-w-0">
        <p class="text-sm break-words">{{ visible.message }}</p>
        <p class="mt-1 text-xs text-slate-400">{{ visible.firedAt }}</p>
      </div>
      <button
        type="button"
        class="text-slate-400 hover:text-white"
        aria-label="Dismiss"
        @click="dismiss"
      >
        <span class="material-icons text-base">close</span>
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 200ms ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
