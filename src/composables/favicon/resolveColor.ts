// Priority-ordered rule chain that picks the favicon's backing
// colour from the full runtime context. See
// `plans/done/feat-favicon-conditional-palette.md` for the reasoning
// behind the ordering and the chosen hex values.
//
// The function is pure: one input → one output. No clock, no DOM,
// no network. Every test pins the branch it wants by constructing
// the context verbatim.

import { FAVICON_REASONS, FAVICON_STATES, type FaviconContext, type FaviconPick } from "./types";
import { isBirthday, isChristmas, isLateNight, isManyUnread, isMorning, isNewYear, isOverloaded, isRunningLong, isWeekend } from "./conditions";

// Keeping the palette values adjacent to the resolver (rather than
// in a separate constants module) makes the "why does this colour
// fire?" audit a one-file read.
// "running" and "has-unread" no longer have background colors — the
// yellow dot (top-left) and red dot (top-right) communicate those
// states. The background is reserved for ambient context (error,
// load, calendar, time-of-day) plus the two *escalations* of the
// dot states (runningLong, manyUnread) that carry severity.
const COLORS = {
  error: "#DC2626", // red-600
  overloaded: "#EA580C", // orange-600 — machine is burning
  manyUnread: "#D946EF", // fuchsia-500 — attention pile-up
  runningLong: "#06B6D4", // cyan-500 — still thinking (> 60 s)
  birthday: "#EAB308", // yellow-500
  newYear: "#B91C1C", // red-700 — festive deeper red
  christmas: "#15803D", // green-700 — festive deeper green
  lateNight: "#6366F1", // indigo-500 — deep work
  morning: "#F59E0B", // amber-500 — sunrise
  weekend: "#14B8A6", // teal-500 — relaxed
  idle: "#6B7280", // gray-500 — fallback
} as const;

// Split the state-driven vs flavour branches so the priority
// argument is in one place and each helper stays under the
// cognitive-complexity threshold.

// Rules 1–4: error + load + escalations. These always fire when
// applicable, beating any flavour. The plain `running` and
// `hasUnread` rules are gone — the yellow / red corner dots own
// those signals now, so the background stays free for ambient
// context even while a session is running.
function resolveByState(ctx: FaviconContext): FaviconPick | null {
  if (ctx.state === FAVICON_STATES.error) {
    return { color: COLORS.error, reason: FAVICON_REASONS.error };
  }
  if (isOverloaded(ctx.cpuLoadRatio)) {
    return { color: COLORS.overloaded, reason: FAVICON_REASONS.overloaded };
  }
  if (isManyUnread(ctx.sessionsUnreadCount)) {
    return { color: COLORS.manyUnread, reason: FAVICON_REASONS.manyUnread };
  }
  if (ctx.state === FAVICON_STATES.running && isRunningLong(ctx.runningSinceMs, ctx.now)) {
    return { color: COLORS.runningLong, reason: FAVICON_REASONS.runningLong };
  }
  return null;
}

// Rules 7–12: flavour / easter eggs. Only consulted when no
// state-driven rule matched, so a running agent never gets a
// "cute" colour. Calendar beats clock; hour-based rules are
// disjoint so we pick whichever matches first.
function resolveByFlavour(ctx: FaviconContext): FaviconPick {
  if (isBirthday(ctx.now, ctx.userBirthdayMMDD)) {
    return { color: COLORS.birthday, reason: FAVICON_REASONS.birthday };
  }
  if (isNewYear(ctx.now)) {
    return { color: COLORS.newYear, reason: FAVICON_REASONS.newYear };
  }
  if (isChristmas(ctx.now)) {
    return { color: COLORS.christmas, reason: FAVICON_REASONS.christmas };
  }
  if (isLateNight(ctx.now)) {
    return { color: COLORS.lateNight, reason: FAVICON_REASONS.lateNight };
  }
  if (isMorning(ctx.now)) {
    return { color: COLORS.morning, reason: FAVICON_REASONS.morning };
  }
  if (isWeekend(ctx.now)) {
    return { color: COLORS.weekend, reason: FAVICON_REASONS.weekend };
  }
  return { color: COLORS.idle, reason: FAVICON_REASONS.idle };
}

export function resolveFaviconColor(ctx: FaviconContext): FaviconPick {
  return resolveByState(ctx) ?? resolveByFlavour(ctx);
}

// Expose the palette for test assertions so the hex values aren't
// hard-coded in two places. Not exported from types.ts because it's
// resolver-implementation state, not part of the public contract.
export const FAVICON_COLORS = COLORS;
