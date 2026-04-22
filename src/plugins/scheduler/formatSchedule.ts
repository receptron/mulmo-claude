// Pure formatters for scheduler-task display. Extracted from
// TasksTab.vue so the UTC → local conversion can be unit-tested
// without spinning up Vue.
//
// Internally every task stores its daily trigger as `HH:MM` in UTC
// (that's what the scheduler engine fires on). The UI should show the
// same moment in the viewer's local timezone so a user in Tokyo sees
// "Daily 05:00 JST" instead of "Daily 20:00 UTC".

export interface DailySchedule {
  type: "daily";
  time: string; // "HH:MM" in UTC
}

export interface IntervalSchedule {
  type: "interval";
  intervalMs: number;
}

export type TaskSchedule = DailySchedule | IntervalSchedule | { type: string; [k: string]: unknown };

const DAILY_TIME_RE = /^(\d{1,2}):(\d{2})$/;

// Build a Date anchored to `now`'s local calendar day but at the
// requested UTC wall-clock hour/minute. Using today's date (rather
// than epoch 1970) makes the DST/TZ conversion accurate for the
// viewer's current moment — "20:00 UTC every day" in Europe/London
// can differ by an hour between summer and winter.
function buildUtcInstant(utcHour: number, utcMinute: number, now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), utcHour, utcMinute));
}

// Intl formatter configured to surface HH:MM + the short timezone
// name (e.g. "JST", "PDT"). When the browser can't resolve a zone
// abbreviation it falls back to the offset string ("GMT+9"), which
// is fine — the point is that the user doesn't have to mentally
// convert from UTC.
const LOCAL_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZoneName: "short",
});

function extractHourMinuteTz(date: Date): { hourMinute: string; tzLabel: string } | null {
  try {
    const parts = LOCAL_TIME_FORMATTER.formatToParts(date);
    const hour = parts.find((part) => part.type === "hour")?.value ?? "";
    const minute = parts.find((part) => part.type === "minute")?.value ?? "";
    const tzLabel = parts.find((part) => part.type === "timeZoneName")?.value ?? "";
    if (!hour || !minute) return null;
    // Intl returns "24" for midnight hour under `hour: "2-digit"` on
    // some runtimes — normalize so "Daily 24:00 JST" never appears.
    const normalizedHour = hour === "24" ? "00" : hour;
    return { hourMinute: `${normalizedHour}:${minute}`, tzLabel };
  } catch {
    return null;
  }
}

// Convert a UTC "HH:MM" into "Daily HH:MM <tz>" in the viewer's
// local zone. Returns the original "Daily HH:MM UTC" string if the
// input is malformed or the Intl machinery is unavailable — callers
// never see `null`/throw for a scheduler entry.
export function formatDailyLocal(utcHHMM: string, now: Date = new Date()): string {
  const match = DAILY_TIME_RE.exec(utcHHMM);
  if (!match) return `Daily ${utcHHMM} UTC`;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) {
    return `Daily ${utcHHMM} UTC`;
  }
  const extracted = extractHourMinuteTz(buildUtcInstant(hour, minute, now));
  if (!extracted) return `Daily ${utcHHMM} UTC`;
  return `Daily ${extracted.hourMinute} ${extracted.tzLabel}`;
}

export function formatInterval(intervalMs: number): string {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return "Every ?";
  const mins = Math.round(intervalMs / 60_000);
  if (mins >= 60) return `Every ${Math.round(mins / 60)}h`;
  return `Every ${mins}m`;
}

export function formatSchedule(schedule: TaskSchedule, now: Date = new Date()): string {
  if (schedule.type === "interval" && typeof (schedule as IntervalSchedule).intervalMs === "number") {
    return formatInterval((schedule as IntervalSchedule).intervalMs);
  }
  if (schedule.type === "daily" && typeof (schedule as DailySchedule).time === "string") {
    return formatDailyLocal((schedule as DailySchedule).time, now);
  }
  return JSON.stringify(schedule);
}
