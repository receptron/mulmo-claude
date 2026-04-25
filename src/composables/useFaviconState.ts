// Dynamic favicon wiring.
//
// Assembles the full `FaviconContext` from reactive app signals
// (`isRunning`, `sessionsUnreadCount`, a ticking clock, server CPU
// load, optional user birthday), feeds it through the pure
// `resolveFaviconColor` rule chain, and hands the resolved color
// to `useDynamicFavicon` for painting.
//
// Every input is global: the user is frequently on /files or other
// non-chat views where `activeSession` is undefined, so relying on
// the on-screen session would silently miss background activity.

import { computed, onScopeDispose, ref, type ComputedRef, type Ref } from "vue";
import { useDynamicFavicon } from "./useDynamicFavicon";
import { useNotifications } from "./useNotifications";
import { resolveFaviconColor } from "./favicon/resolveColor";
import { FAVICON_STATES, type FaviconContext, type FaviconState } from "./favicon/types";
import type { SessionSummary } from "../types/session";

// Ticking cadence for the clock context. Once per minute is enough
// to cross the morning / late-night / weekend / running-long
// boundaries — we don't need second-level precision in a tab icon.
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

  // 4-state enum still drives state priority inside the resolver.
  // `done` here means "somebody somewhere has an unread reply", not
  // "the on-screen session finished" — the dot already communicates
  // that per session in the sidebar.
  const faviconState = computed<FaviconState>(() => {
    if (isRunning.value) return FAVICON_STATES.running;
    if (sessionsUnreadCount.value > 0) return FAVICON_STATES.done;
    return FAVICON_STATES.idle;
  });

  // Run-start timestamp — the **earliest** `updatedAt` across every
  // running session. `updatedAt` is bumped the moment the user sends
  // a message (right before a run begins) and stays pinned until the
  // run ends, so it's a safe proxy for "this run started at…".
  //
  // Caller passes `mergedSessions` (live in-memory state OR'd with
  // server summaries), so this scan picks up two things the raw
  // server `sessions` list would miss until the next /api/sessions
  // refetch:
  //   • `beginUserTurn`'s synchronous `live.updatedAt` stamp, so the
  //     runningLong clock is anchored to the actual user click, not
  //     the refetch arrival time.
  //   • `live.pendingGenerations` (folded into the merged summary's
  //     `isRunning`), so a generation kicked off by the bridge or a
  //     background tab counts the moment its event lands.
  //
  // Falls back to `Date.now()` only if no running session has a
  // parseable `updatedAt` (brand-new session before the first
  // server echo and before `beginUserTurn`).
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
