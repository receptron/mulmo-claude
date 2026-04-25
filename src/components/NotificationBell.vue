<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { useNotifications } from "../composables/useNotifications";
import { formatRelativeTime } from "../utils/format/date";
import { NOTIFICATION_ICONS, NOTIFICATION_ACTION_TYPES, NOTIFICATION_PRIORITIES } from "../types/notification";
import type { NotificationPayload } from "../types/notification";

const { t } = useI18n();
const { notifications, unreadCount, isRead, markRead, markAllRead, dismiss } = useNotifications();
const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);

function onDocumentClick(event: MouseEvent): void {
  if (!open.value || !rootRef.value) return;
  if (!rootRef.value.contains(event.target as Node)) {
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
  (shouldClose) => {
    if (shouldClose && open.value) close();
  },
);

function toggle(): void {
  open.value = !open.value;
  // Opening the panel does NOT auto-mark items as read — the user
  // has to click an item (markRead via handleClick) or dismiss it
  // (× button) for the unread badge to drop. The "Mark all read"
  // button in the panel header still bulk-clears.
  emit("update:open", open.value);
}

function close(): void {
  open.value = false;
  emit("update:open", false);
}

function iconName(notification: NotificationPayload): string {
  return notification.icon ?? NOTIFICATION_ICONS[notification.kind] ?? "notifications";
}

function formatTime(iso: string): string {
  return formatRelativeTime(iso);
}

function handleClick(notification: NotificationPayload): void {
  // Mark this single item read regardless of whether it has a
  // navigate action — the user has explicitly engaged with it,
  // which is the unambiguous "I've seen this" signal.
  markRead(notification.id);
  if (notification.action.type === NOTIFICATION_ACTION_TYPES.navigate) {
    emit("navigate", notification.action);
    close();
  }
}

function handleDismiss(event: Event, notificationId: string): void {
  event.stopPropagation();
  // dismiss removes the entry from the list, so its contribution
  // to unreadCount drops automatically. No separate markRead call
  // needed — and we don't want the entry to linger as "read" if
  // the user explicitly chose to remove it.
  dismiss(notificationId);
}
</script>

<template>
  <div ref="rootRef" class="relative">
    <!-- Bell button -->
    <button
      class="relative h-8 w-8 flex items-center justify-center rounded text-gray-400 hover:text-gray-700"
      data-testid="notification-bell"
      :aria-label="t('notificationBell.notifications')"
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
      <div class="flex items-center justify-between px-4 py-2 border-b border-gray-100">
        <span class="text-sm font-semibold text-gray-700">{{ t("notificationBell.notifications") }}</span>
        <button class="text-xs text-blue-500 hover:text-blue-700" data-testid="notification-mark-all-read" @click="markAllRead">
          {{ t("notificationBell.markAllRead") }}
        </button>
      </div>

      <!-- Empty state -->
      <div v-if="notifications.length === 0" class="py-8 text-center text-sm text-gray-400">{{ t("notificationBell.noNotifications") }}</div>

      <!-- Items -->
      <div v-else>
        <div
          v-for="n in notifications"
          :key="n.id"
          role="button"
          tabindex="0"
          class="flex items-start gap-3 px-4 py-3 border-b border-gray-50 hover:bg-gray-50 focus:bg-gray-100 cursor-pointer outline-none"
          :class="isRead(n.id) ? 'bg-white' : 'bg-blue-50/40'"
          :data-testid="`notification-item-${n.id}`"
          :data-unread="isRead(n.id) ? 'false' : 'true'"
          :aria-label="n.title"
          @click="handleClick(n)"
          @keydown.enter.prevent.self="(e) => !e.repeat && handleClick(n)"
          @keydown.space.prevent.self="(e) => !e.repeat && handleClick(n)"
        >
          <!-- Unread dot — small leading marker so the user can scan
               the panel for what's new. Hidden once `markRead` fires. -->
          <span class="w-2 h-2 mt-2 shrink-0 rounded-full" :class="isRead(n.id) ? 'bg-transparent' : 'bg-blue-500'" aria-hidden="true" />
          <span class="material-icons text-lg mt-0.5 shrink-0" :class="n.priority === NOTIFICATION_PRIORITIES.high ? 'text-red-500' : 'text-gray-400'">
            {{ iconName(n) }}
          </span>
          <div class="flex-1 min-w-0">
            <p class="text-sm truncate" :class="isRead(n.id) ? 'text-gray-600 font-normal' : 'text-gray-900 font-semibold'">{{ n.title }}</p>
            <p v-if="n.body" class="text-xs text-gray-500 truncate mt-0.5">
              {{ n.body }}
            </p>
            <p class="text-xs text-gray-400 mt-0.5">
              {{ formatTime(n.firedAt) }}
            </p>
          </div>
          <button class="text-gray-300 hover:text-gray-500 shrink-0 mt-0.5" :aria-label="t('notificationBell.dismiss')" @click="handleDismiss($event, n.id)">
            <span class="material-icons text-sm">close</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
