// Web-side subscriber for the `notifications` pub-sub channel.
// Stores incoming NotificationPayloads for the bell badge + panel.
//
// Uses a singleton subscription pattern: the first component that
// calls useNotifications() subscribes to the pub-sub channel; the
// last one to unmount unsubscribes. All consumers share the same
// module-level state (notifications + readAt).

import { onUnmounted, ref, computed, type Ref, type ComputedRef } from "vue";
import { PUBSUB_CHANNELS } from "../config/pubsubChannels";
import { usePubSub } from "./usePubSub";
import { NOTIFICATION_KINDS } from "../types/notification";
import type { NotificationPayload } from "../types/notification";
import { isRecord } from "../utils/types";

const MAX_RECENT = 50;

const VALID_KINDS = new Set<string>(Object.values(NOTIFICATION_KINDS));

function isNotificationPayload(value: unknown): value is NotificationPayload {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.kind !== "string" || !VALID_KINDS.has(value.kind)) return false;
  if (typeof value.title !== "string") return false;
  if (typeof value.firedAt !== "string") return false;
  if (!isValidAction(value.action)) return false;
  return true;
}

function isValidAction(action: unknown): boolean {
  if (!isRecord(action)) return false;
  return typeof action.type === "string";
}

// Module-level state so all components share the same list.
const notifications = ref<NotificationPayload[]>([]);
const readAt = ref<string | null>(null);

// Singleton subscription — ref-counted across consumers.
let subscriberCount = 0;
let unsubscribeFn: (() => void) | null = null;

function ensureSubscribed(subscribe: ReturnType<typeof usePubSub>["subscribe"]): void {
  subscriberCount++;
  if (unsubscribeFn) return; // already listening
  unsubscribeFn = subscribe(PUBSUB_CHANNELS.notifications, (data) => {
    if (!isNotificationPayload(data)) return;
    notifications.value = [data, ...notifications.value].slice(0, MAX_RECENT);
  });
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
  markAllRead: () => void;
  dismiss: (id: string) => void;
} {
  const { subscribe } = usePubSub();
  ensureSubscribed(subscribe);
  onUnmounted(releaseSubscription);

  const latest = computed(() => notifications.value[0] ?? null);

  const unreadCount = computed(() => {
    if (!readAt.value) return notifications.value.length;
    return notifications.value.filter((notif) => notif.firedAt > readAt.value!).length;
  });

  function markAllRead(): void {
    if (notifications.value.length > 0) {
      readAt.value = notifications.value[0].firedAt;
    }
  }

  function dismiss(notifId: string): void {
    notifications.value = notifications.value.filter((notif) => notif.id !== notifId);
  }

  return { notifications, latest, unreadCount, markAllRead, dismiss };
}
