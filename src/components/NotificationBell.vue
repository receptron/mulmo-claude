<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from "vue";
import { useNotifications } from "../composables/useNotifications";
import { formatRelativeTime } from "../utils/format/date";
import {
  NOTIFICATION_ICONS,
  NOTIFICATION_ACTION_TYPES,
  NOTIFICATION_PRIORITIES,
} from "../types/notification";
import type { NotificationPayload } from "../types/notification";

const { notifications, unreadCount, markAllRead, dismiss } = useNotifications();
const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);

function onDocumentClick(e: MouseEvent): void {
  if (!open.value || !rootRef.value) return;
  if (!rootRef.value.contains(e.target as Node)) {
    close();
  }
}

onMounted(() => document.addEventListener("mousedown", onDocumentClick));
onUnmounted(() => document.removeEventListener("mousedown", onDocumentClick));

const props = defineProps<{
  forceClose?: boolean;
}>();

const emit = defineEmits<{
  navigate: [action: NotificationPayload["action"]];
  "update:open": [open: boolean];
}>();

watch(
  () => props.forceClose,
  (v) => {
    if (v && open.value) close();
  },
);

function toggle(): void {
  open.value = !open.value;
  if (open.value) markAllRead();
  emit("update:open", open.value);
}

function close(): void {
  open.value = false;
  emit("update:open", false);
}

function iconName(n: NotificationPayload): string {
  return n.icon ?? NOTIFICATION_ICONS[n.kind] ?? "notifications";
}

function formatTime(iso: string): string {
  return formatRelativeTime(iso);
}

function handleClick(n: NotificationPayload): void {
  if (n.action.type === NOTIFICATION_ACTION_TYPES.navigate) {
    emit("navigate", n.action);
    close();
  }
}

function handleDismiss(e: Event, id: string): void {
  e.stopPropagation();
  dismiss(id);
}
</script>

<template>
  <div ref="rootRef" class="relative">
    <!-- Bell button -->
    <button
      class="relative text-gray-400 hover:text-gray-700"
      data-testid="notification-bell"
      aria-label="Notifications"
      @click="toggle"
    >
      <span class="material-icons">notifications</span>
      <span
        v-if="unreadCount > 0"
        class="absolute -top-1.5 -right-1.5 min-w-[1rem] h-4 px-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none"
        data-testid="notification-badge"
      >
        {{ unreadCount > 99 ? "99+" : unreadCount }}
      </span>
    </button>

    <!-- Dropdown panel -->
    <div
      v-if="open"
      class="absolute left-0 top-full mt-1 w-72 max-h-80 overflow-y-auto rounded-lg shadow-xl border border-gray-200 bg-white z-50"
      data-testid="notification-panel"
    >
      <!-- Header -->
      <div
        class="flex items-center justify-between px-4 py-2 border-b border-gray-100"
      >
        <span class="text-sm font-semibold text-gray-700">Notifications</span>
        <button
          class="text-xs text-blue-500 hover:text-blue-700"
          data-testid="notification-mark-all-read"
          @click="markAllRead"
        >
          Mark all read
        </button>
      </div>

      <!-- Empty state -->
      <div
        v-if="notifications.length === 0"
        class="py-8 text-center text-sm text-gray-400"
      >
        No notifications
      </div>

      <!-- Items -->
      <div v-else>
        <div
          v-for="n in notifications"
          :key="n.id"
          role="button"
          tabindex="0"
          class="flex items-start gap-3 px-4 py-3 border-b border-gray-50 hover:bg-gray-50 focus:bg-gray-100 cursor-pointer outline-none"
          :data-testid="`notification-item-${n.id}`"
          :aria-label="n.title"
          @click="handleClick(n)"
          @keydown.enter="handleClick(n)"
        >
          <span
            class="material-icons text-lg mt-0.5 shrink-0"
            :class="
              n.priority === NOTIFICATION_PRIORITIES.high
                ? 'text-red-500'
                : 'text-gray-400'
            "
          >
            {{ iconName(n) }}
          </span>
          <div class="flex-1 min-w-0">
            <p class="text-sm text-gray-800 truncate">{{ n.title }}</p>
            <p v-if="n.body" class="text-xs text-gray-500 truncate mt-0.5">
              {{ n.body }}
            </p>
            <p class="text-xs text-gray-400 mt-0.5">
              {{ formatTime(n.firedAt) }}
            </p>
          </div>
          <button
            class="text-gray-300 hover:text-gray-500 shrink-0 mt-0.5"
            aria-label="Dismiss"
            @click="handleDismiss($event, n.id)"
          >
            <span class="material-icons text-sm">close</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
