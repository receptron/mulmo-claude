// Dynamic favicon state: running → done (unread) → idle.
// Also drives the notification badge dot on the favicon.

import { computed, type ComputedRef } from "vue";
import {
  FAVICON_STATES,
  type FaviconState,
  useDynamicFavicon,
} from "./useDynamicFavicon";
import { useNotifications } from "./useNotifications";
import type { ActiveSession, SessionSummary } from "../types/session";

export function useFaviconState(opts: {
  isRunning: ComputedRef<boolean>;
  currentSummary: ComputedRef<SessionSummary | undefined>;
  activeSession: ComputedRef<ActiveSession | undefined>;
}) {
  const { isRunning, currentSummary, activeSession } = opts;

  const faviconState = computed<FaviconState>(() => {
    if (isRunning.value) return FAVICON_STATES.running;
    const hasUnread =
      currentSummary.value?.hasUnread ??
      activeSession.value?.hasUnread ??
      false;
    if (hasUnread) return FAVICON_STATES.done;
    return FAVICON_STATES.idle;
  });

  const { unreadCount: notificationUnreadCount } = useNotifications();
  const hasNotificationBadge = computed(
    () => notificationUnreadCount.value > 0,
  );

  useDynamicFavicon({
    state: faviconState,
    hasNotification: hasNotificationBadge,
  });
}
