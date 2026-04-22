// Dynamic favicon state: running → done (unread) → idle.
// Also drives the notification badge dot on the favicon.

import { computed, type ComputedRef } from "vue";
import { FAVICON_STATES, type FaviconState, useDynamicFavicon } from "./useDynamicFavicon";
import { useNotifications } from "./useNotifications";
import type { ActiveSession, SessionSummary } from "../types/session";

export function useFaviconState(opts: {
  isRunning: ComputedRef<boolean>;
  currentSummary: ComputedRef<SessionSummary | undefined>;
  activeSession: ComputedRef<ActiveSession | undefined>;
  // Number of sessions (across all tabs) with unread messages. We
  // light the badge dot when any session is unread, even if it's not
  // the currently-focused one, so background replies still surface in
  // the tab bar.
  sessionsUnreadCount: ComputedRef<number>;
}) {
  const { isRunning, currentSummary, activeSession, sessionsUnreadCount } = opts;

  const faviconState = computed<FaviconState>(() => {
    if (isRunning.value) return FAVICON_STATES.running;
    const hasUnread = currentSummary.value?.hasUnread ?? activeSession.value?.hasUnread ?? false;
    if (hasUnread) return FAVICON_STATES.done;
    return FAVICON_STATES.idle;
  });

  const { unreadCount: notificationUnreadCount } = useNotifications();
  // Badge dot covers two independent signals:
  //   1. Pub-sub notifications (scheduled tasks, etc.)
  //   2. Any session with unread chat messages (including background
  //      tabs the user isn't currently viewing).
  // Either one flips the dot on — the dot doesn't distinguish source,
  // just tells the user "there's something to look at".
  const hasNotificationBadge = computed(() => notificationUnreadCount.value > 0 || sessionsUnreadCount.value > 0);

  useDynamicFavicon({
    state: faviconState,
    hasNotification: hasNotificationBadge,
  });
}
