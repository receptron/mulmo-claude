// Singleton subscription, ref-counted across consumers; module-level state shared by every caller.
// Opening the panel does NOT auto-mark everything read — user must click each item or hit "Mark all read".

import { onUnmounted, ref, computed, type Ref, type ComputedRef } from "vue";
import { PUBSUB_CHANNELS } from "../config/pubsubChannels";
import { usePubSub } from "./usePubSub";
import { NOTIFICATION_ACTION_TYPES, NOTIFICATION_KINDS, NOTIFICATION_VIEWS } from "../types/notification";
import type { NotificationPayload } from "../types/notification";
import { isRecord } from "../utils/types";

const MAX_RECENT = 50;

const VALID_KINDS = new Set<string>(Object.values(NOTIFICATION_KINDS));
const VALID_VIEWS = new Set<string>(Object.values(NOTIFICATION_VIEWS));

function isNotificationPayload(value: unknown): value is NotificationPayload {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.kind !== "string" || !VALID_KINDS.has(value.kind)) return false;
  if (typeof value.title !== "string") return false;
  if (typeof value.firedAt !== "string") return false;
  if (!isValidAction(value.action)) return false;
  return true;
}

// Stop malformed payloads from landing in the panel and crashing later in the click handler.
function isValidAction(action: unknown): boolean {
  if (!isRecord(action)) return false;
  if (action.type === NOTIFICATION_ACTION_TYPES.none) return true;
  if (action.type !== NOTIFICATION_ACTION_TYPES.navigate) return false;
  const target = action.target;
  if (!isRecord(target)) return false;
  return typeof target.view === "string" && VALID_VIEWS.has(target.view);
}

const notifications = ref<NotificationPayload[]>([]);
const readIds = ref<Set<string>>(new Set());

let subscriberCount = 0;
let unsubscribeFn: (() => void) | null = null;

function ensureSubscribed(subscribe: ReturnType<typeof usePubSub>["subscribe"]): void {
  subscriberCount++;
  if (unsubscribeFn) return; // already listening
  unsubscribeFn = subscribe(PUBSUB_CHANNELS.notifications, (data) => {
    if (!isNotificationPayload(data)) return;
    const next = [data, ...notifications.value].slice(0, MAX_RECENT);
    notifications.value = next;
    // Without pruning, readIds is an unbounded leak across a long-lived session.
    pruneReadIds(next);
  });
}

function pruneReadIds(currentList: readonly NotificationPayload[]): void {
  if (readIds.value.size === 0) return;
  const liveIds = new Set(currentList.map((notif) => notif.id));
  const next = new Set<string>();
  for (const readId of readIds.value) {
    if (liveIds.has(readId)) next.add(readId);
  }
  // Skip the assignment when nothing rolled off, to avoid reactive churn.
  if (next.size !== readIds.value.size) {
    readIds.value = next;
  }
}

function releaseSubscription(): void {
  subscriberCount--;
  if (subscriberCount <= 0 && unsubscribeFn) {
    unsubscribeFn();
    unsubscribeFn = null;
    subscriberCount = 0;
  }
}

export function useNotifications(): {
  notifications: Ref<NotificationPayload[]>;
  latest: ComputedRef<NotificationPayload | null>;
  unreadCount: ComputedRef<number>;
  isRead: (id: string) => boolean;
  markRead: (id: string) => void;
  markAllRead: () => void;
  dismiss: (id: string) => void;
} {
  const { subscribe } = usePubSub();
  ensureSubscribed(subscribe);
  onUnmounted(releaseSubscription);

  const latest = computed(() => notifications.value[0] ?? null);

  const unreadCount = computed(() => notifications.value.filter((notif) => !readIds.value.has(notif.id)).length);

  function isRead(notifId: string): boolean {
    return readIds.value.has(notifId);
  }

  function markRead(notifId: string): void {
    if (readIds.value.has(notifId)) return;
    // Replace the Set so Vue's reactivity fires for unreadCount / isRead consumers.
    const next = new Set(readIds.value);
    next.add(notifId);
    readIds.value = next;
  }

  function markAllRead(): void {
    if (notifications.value.length === 0) return;
    const next = new Set(readIds.value);
    for (const notif of notifications.value) {
      next.add(notif.id);
    }
    readIds.value = next;
  }

  function dismiss(notifId: string): void {
    notifications.value = notifications.value.filter((notif) => notif.id !== notifId);
    // Drop the matching readIds entry too — without it, dismissing thousands of notifications leaks ~36 chars each.
    if (readIds.value.has(notifId)) {
      const next = new Set(readIds.value);
      next.delete(notifId);
      readIds.value = next;
    }
  }

  return { notifications, latest, unreadCount, isRead, markRead, markAllRead, dismiss };
}
