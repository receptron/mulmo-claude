// Dynamic favicon wiring.
//
// Assembles the full `FaviconContext` from reactive app signals
// (`isRunning`, `sessionsUnreadCount`, a ticking clock, server CPU
// load, optional user birthday), feeds it through the pure
// `resolveFaviconColor` rule chain, and hands the resolved color
// to `useDynamicFavicon` for painting.

import { computed, onScopeDispose, ref, type ComputedRef } from "vue";
import { useDynamicFavicon } from "./useDynamicFavicon";
import { useNotifications } from "./useNotifications";
import { resolveFaviconColor } from "./favicon/resolveColor";
import { FAVICON_STATES, type FaviconContext, type FaviconState } from "./favicon/types";
import type { ActiveSession, SessionSummary } from "../types/session";

// Ticking cadence for the clock context. Once per minute is enough
// to cross the morning / late-night / weekend / running-long
// boundaries — we don't need second-level precision in a tab icon.
const FAVICON_TICK_MS = 60_000;

export function useFaviconState(opts: {
  isRunning: ComputedRef<boolean>;
  currentSummary: ComputedRef<SessionSummary | undefined>;
  activeSession: ComputedRef<ActiveSession | undefined>;
  /** Unread count across every session, not just the active one. */
  sessionsUnreadCount: ComputedRef<number>;
  /** Server CPU load1 / cores, or null if not yet fetched / Windows. */
  cpuLoadRatio?: ComputedRef<number | null>;
  /** User birthday as "MM-DD" parsed from memory.md, or null. */
  userBirthdayMMDD?: ComputedRef<string | null>;
}) {
  const { isRunning, currentSummary, activeSession, sessionsUnreadCount, cpuLoadRatio, userBirthdayMMDD } = opts;

  // Legacy 4-state enum still drives state priority inside the
  // resolver. `running` vs `running-long` is split downstream by
  // the runningSinceMs clock.
  const faviconState = computed<FaviconState>(() => {
    if (isRunning.value) return FAVICON_STATES.running;
    const hasUnread = currentSummary.value?.hasUnread ?? activeSession.value?.hasUnread ?? false;
    if (hasUnread) return FAVICON_STATES.done;
    return FAVICON_STATES.idle;
  });

  // Run-start timestamp, derived from the session's `updatedAt` —
  // which the server bumps every time the user sends a message, i.e.
  // right before a run begins. That means:
  //   1. The clock is correct across a page reload or a second tab:
  //      a 5-minute-old run stays cyan instead of reverting to blue
  //      for 60 s after mount.
  //   2. We don't need a separate server "runStartedAt" field; the
  //      existing `updatedAt` already serves as the anchor because
  //      the session is locked during a run, so `updatedAt` can't
  //      change until this run ends.
  // Falls back to `Date.now()` only if the session has no
  // `updatedAt` (brand-new session before the first server echo).
  const runningSinceMs = computed<number | null>(() => {
    if (!isRunning.value) return null;
    const updatedAt = activeSession.value?.updatedAt;
    if (updatedAt) {
      const parsed = new Date(updatedAt).getTime();
      if (Number.isFinite(parsed)) return parsed;
    }
    return Date.now();
  });

  // Per-minute tick so time-of-day rules (morning, late-night,
  // weekend) pick up boundary crossings without the user needing to
  // interact. Also re-evaluates running-long so the cyan shift lands
  // within a minute of the 60-second mark.
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
  // Badge dot fires on either pub-sub notifications (scheduled
  // tasks, etc.) or any session carrying unread chat messages —
  // the dot itself doesn't distinguish source.
  const hasNotificationBadge = computed(() => notificationUnreadCount.value > 0 || sessionsUnreadCount.value > 0);

  useDynamicFavicon({
    color,
    isRunning,
    hasNotification: hasNotificationBadge,
  });
}
