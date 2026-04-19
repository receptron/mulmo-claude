// Web-side subscriber for the `notifications` pub-sub channel the
// server publishes on when a scheduled push fires. Pairs with the
// PoC endpoint `POST /api/notifications/test`
// (`server/api/routes/notifications.ts`).
//
// Scope for this scaffold: keep a rolling tail of the last N
// notifications so the toast component can render the most recent
// one. No dedup, no dismissal persistence, no per-session
// targeting — those land with the real notification center (#144).

import { onUnmounted, ref, type Ref } from "vue";
import { PUBSUB_CHANNELS } from "../config/pubsubChannels";
import { usePubSub } from "./usePubSub";

export interface NotificationItem {
  /** Monotonic id so consumers can `v-for :key` cleanly even when
   *  two notifications arrive in the same millisecond. */
  id: number;
  message: string;
  /** ISO8601 from the server at fire time (not receipt time). */
  firedAt: string;
}

const MAX_RECENT = 20;

function isNotificationData(
  value: unknown,
): value is { message: string; firedAt: string } {
  if (value === null || typeof value !== "object") return false;
  if (!("message" in value) || typeof value.message !== "string") return false;
  if (!("firedAt" in value) || typeof value.firedAt !== "string") return false;
  return true;
}

export function useNotifications(): {
  notifications: Ref<NotificationItem[]>;
  latest: Ref<NotificationItem | null>;
} {
  const notifications = ref<NotificationItem[]>([]);
  const latest = ref<NotificationItem | null>(null);
  let nextId = 0;

  const { subscribe } = usePubSub();
  const unsubscribe = subscribe(PUBSUB_CHANNELS.notifications, (data) => {
    if (!isNotificationData(data)) return;
    const item: NotificationItem = {
      id: nextId++,
      message: data.message,
      firedAt: data.firedAt,
    };
    // Newest-first. Cap the tail so a busy server can't grow the
    // array unbounded.
    notifications.value = [item, ...notifications.value].slice(0, MAX_RECENT);
    latest.value = item;
  });

  onUnmounted(() => {
    unsubscribe();
  });

  return { notifications, latest };
}
