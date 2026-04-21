<script setup lang="ts">
import { ref, watch } from "vue";
import { useNotifications } from "../composables/useNotifications";
import { NOTIFICATION_ICONS } from "../types/notification";
import type { NotificationPayload } from "../types/notification";
import { ONE_SECOND_MS } from "../../server/utils/time";
import { formatSmartTime } from "../utils/format/date";

const AUTO_HIDE_MS = 5 * ONE_SECOND_MS;

const { latest } = useNotifications();
const visible = ref<NotificationPayload | null>(null);
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

function iconName(notif: NotificationPayload): string {
  return notif.icon ?? NOTIFICATION_ICONS[notif.kind] ?? "notifications";
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
        {{ iconName(visible) }}
      </span>
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium break-words">{{ visible.title }}</p>
        <p v-if="visible.body" class="mt-0.5 text-xs text-slate-300 break-words">
          {{ visible.body }}
        </p>
        <p class="mt-1 text-xs text-slate-400">
          {{ formatSmartTime(visible.firedAt) }}
        </p>
      </div>
      <button type="button" class="text-slate-400 hover:text-white" aria-label="Dismiss" @click="dismiss">
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
