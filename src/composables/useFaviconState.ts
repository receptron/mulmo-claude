// Inputs are global on purpose — on /files or other non-chat views activeSession is undefined, so an on-screen-only
// signal would silently miss background activity.

import { computed, onScopeDispose, ref, type ComputedRef, type Ref } from "vue";
import { useDynamicFavicon } from "./useDynamicFavicon";
import { useNotifications } from "./useNotifications";
import { resolveFaviconColor } from "./favicon/resolveColor";
import { FAVICON_STATES, type FaviconContext, type FaviconState } from "./favicon/types";
import type { SessionSummary } from "../types/session";

// One minute is enough to cross morning/late-night/weekend/running-long boundaries — no need for second-level precision.
const FAVICON_TICK_MS = 60_000;

export function useFaviconState(opts: {
  isRunning: ComputedRef<boolean>;
  /** Every known session summary — scanned for running / updatedAt. */
  sessions: Ref<SessionSummary[]> | ComputedRef<SessionSummary[]>;
  /** Unread count across every session, not just the active one. */
  sessionsUnreadCount: ComputedRef<number>;
  /** Server CPU load1 / cores, or null if not yet fetched / Windows. */
  cpuLoadRatio?: ComputedRef<number | null>;
  /** User birthday as "MM-DD" parsed from memory.md, or null. */
  userBirthdayMMDD?: ComputedRef<string | null>;
}) {
  const { isRunning, sessions, sessionsUnreadCount, cpuLoadRatio, userBirthdayMMDD } = opts;

  // `done` means "somebody somewhere has an unread reply" — per-session done is already communicated by the sidebar dot.
  const faviconState = computed<FaviconState>(() => {
    if (isRunning.value) return FAVICON_STATES.running;
    if (sessionsUnreadCount.value > 0) return FAVICON_STATES.done;
    return FAVICON_STATES.idle;
  });

  // Earliest updatedAt across running sessions. updatedAt is bumped on user-send (before the run begins) and stays
  // pinned until the run ends, so it's a safe "this run started at…" proxy. Caller passes mergedSessions (live OR
  // server) so beginUserTurn's synchronous stamp + live.pendingGenerations land before the next /api/sessions refetch.
  const runningSinceMs = computed<number | null>(() => {
    if (!isRunning.value) return null;
    let earliest = Number.POSITIVE_INFINITY;
    for (const session of sessions.value) {
      if (!session.isRunning) continue;
      const parsed = new Date(session.updatedAt).getTime();
      if (Number.isFinite(parsed) && parsed < earliest) earliest = parsed;
    }
    return Number.isFinite(earliest) ? earliest : Date.now();
  });

  // Per-minute tick: drives boundary crossings (morning/late-night/weekend) without needing user interaction, and lets
  // running-long flip cyan within a minute of the 60-second mark.
  const clockTick = ref<Date>(new Date());
  const tickHandle = window.setInterval(() => {
    clockTick.value = new Date();
  }, FAVICON_TICK_MS);
  onScopeDispose(() => window.clearInterval(tickHandle));

  const color = computed<string>(() => {
    const context: FaviconContext = {
      state: faviconState.value,
      sessionsUnreadCount: sessionsUnreadCount.value,
      runningSinceMs: runningSinceMs.value,
      now: clockTick.value,
      userBirthdayMMDD: userBirthdayMMDD?.value ?? null,
      cpuLoadRatio: cpuLoadRatio?.value ?? null,
    };
    return resolveFaviconColor(context).color;
  });

  const { unreadCount: notificationUnreadCount } = useNotifications();
  // The dot doesn't distinguish source: pub-sub notifications OR any session with unread chat both trigger it.
  const hasNotificationBadge = computed(() => notificationUnreadCount.value > 0 || sessionsUnreadCount.value > 0);

  useDynamicFavicon({
    color,
    isRunning,
    hasNotification: hasNotificationBadge,
  });
}
