// Pure schedule-window computation. Zero side effects, zero I/O.
// Given a schedule and a time range, enumerate every window that
// should have fired. Used by the catch-up algorithm and by the
// tick loop's "is this task due NOW?" check.

import type { TaskSchedule } from "./types.js";
import { SCHEDULE_TYPES } from "./types.js";

const MS_PER_SEC = 1000;
const MS_PER_MIN = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/** Parse "HH:MM" to milliseconds since midnight (UTC). */
export function parseTimeToMs(time: string): number {
  const [hh, mm] = time.split(":").map(Number);
  return hh * MS_PER_HOUR + mm * MS_PER_MIN;
}

/**
 * Compute the next window at or after `afterMs` for the given schedule.
 * Returns the window's epoch-ms timestamp, or `null` for `once`
 * schedules whose `at` has already passed.
 */
export function nextWindowAfter(
  schedule: TaskSchedule,
  afterMs: number,
): number | null {
  if (schedule.type === SCHEDULE_TYPES.interval) {
    const intervalMs = schedule.intervalSec * MS_PER_SEC;
    // Intervals are anchored to epoch — the Nth window is N * interval.
    // Find the smallest multiple >= afterMs.
    return Math.ceil(afterMs / intervalMs) * intervalMs;
  }

  if (schedule.type === SCHEDULE_TYPES.daily) {
    return nextDailyWindow(parseTimeToMs(schedule.time), afterMs);
  }

  if (schedule.type === SCHEDULE_TYPES.weekly) {
    return nextWeeklyWindow(
      schedule.daysOfWeek,
      parseTimeToMs(schedule.time),
      afterMs,
    );
  }

  if (schedule.type === SCHEDULE_TYPES.once) {
    const atMs = new Date(schedule.at).getTime();
    return atMs >= afterMs ? atMs : null;
  }

  return null;
}

/**
 * List every window that should have fired in the half-open range
 * `(afterMs, untilMs]`. Used by the catch-up algorithm to enumerate
 * missed runs.
 */
export function listMissedWindows(
  schedule: TaskSchedule,
  afterMs: number,
  untilMs: number,
  maxWindows = 24,
): number[] {
  const windows: number[] = [];
  // Start searching from just after the last-run timestamp.
  let cursor = afterMs + 1;
  while (windows.length < maxWindows) {
    const next = nextWindowAfter(schedule, cursor);
    if (next === null || next > untilMs) break;
    windows.push(next);
    cursor = next + 1;
  }
  return windows;
}

/**
 * Check whether the given `nowMs` falls within a tick-aligned window
 * for the schedule. `tickMs` is the scheduler's polling interval
 * (default 60s). A window "hits" if the tick that contains `nowMs`
 * also contains the scheduled instant.
 */
export function isDueAt(
  schedule: TaskSchedule,
  nowMs: number,
  tickMs: number,
): boolean {
  const next = nextWindowAfter(schedule, nowMs - tickMs + 1);
  if (next === null) return false;
  // The window hits if it falls within [nowMs - tickMs + 1, nowMs].
  return next <= nowMs;
}

// ── Internal helpers ─────────────────────────────────────────────

function nextDailyWindow(timeOfDayMs: number, afterMs: number): number {
  const d = new Date(afterMs);
  // Today's candidate: midnight UTC + timeOfDayMs
  const todayMidnight = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
  );
  const candidate = todayMidnight + timeOfDayMs;
  return candidate >= afterMs ? candidate : candidate + MS_PER_DAY;
}

function nextWeeklyWindow(
  daysOfWeek: number[],
  timeOfDayMs: number,
  afterMs: number,
): number | null {
  if (daysOfWeek.length === 0) return null;
  const daySet = new Set(daysOfWeek);
  // Check today + next 7 days
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = nextDailyWindow(
      timeOfDayMs,
      afterMs + offset * MS_PER_DAY,
    );
    const dow = new Date(candidate).getUTCDay();
    if (daySet.has(dow) && candidate >= afterMs) return candidate;
  }
  return null;
}
