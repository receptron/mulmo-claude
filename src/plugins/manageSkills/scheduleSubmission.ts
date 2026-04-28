// Pure helpers shared between SkillScheduleDialog.vue (the form that
// produces the payload) and the unit tests that pin the conversion
// logic. Kept dependency-free so node:test can import without Vue.

export type ScheduleSubmission = { type: "daily"; time: string } | { type: "interval"; intervalMs: number };

const ONE_MINUTE_MS = 60_000;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;

export const DAILY_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

// The daily-task wire format is UTC "HH:MM" (see formatSchedule.ts),
// but `<input type="time">` returns local. Convert through a Date
// anchored to `anchor` so DST is handled correctly. `anchor` defaults
// to "now" because the next firing is "today at HH:MM local" — using
// today's calendar day is what makes the DST math accurate.
export function localHHMMToUtcHHMM(local: string, anchor: Date = new Date()): string {
  const [hourStr, minuteStr] = local.split(":");
  const date = new Date(anchor.getTime());
  date.setHours(Number(hourStr), Number(minuteStr), 0, 0);
  const utcHour = String(date.getUTCHours()).padStart(2, "0");
  const utcMinute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${utcHour}:${utcMinute}`;
}

export interface DailyDraft {
  localTime: string;
}

export interface IntervalDraft {
  amount: number;
  unit: "minutes" | "hours";
}

// Returns null for invalid input — callers (the dialog) treat null as
// "do nothing", same shape the previous inline `submit()` used.
export function buildScheduleSubmission(
  type: "daily" | "interval",
  daily: DailyDraft,
  interval: IntervalDraft,
  anchor: Date = new Date(),
): ScheduleSubmission | null {
  if (type === "daily") {
    if (!DAILY_TIME_RE.test(daily.localTime)) return null;
    return { type: "daily", time: localHHMMToUtcHHMM(daily.localTime, anchor) };
  }
  const amount = Number(interval.amount);
  if (!Number.isFinite(amount) || amount < 1) return null;
  const unitMs = interval.unit === "hours" ? ONE_HOUR_MS : ONE_MINUTE_MS;
  return { type: "interval", intervalMs: Math.floor(amount) * unitMs };
}
