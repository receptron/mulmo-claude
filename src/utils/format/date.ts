// Pure date/time formatting helpers for the Vue frontend.
// All functions are locale-aware on purpose; tests assert
// structural properties only, not exact strings.

/** "Apr 11 06:32" — short month + day + 24h time. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  return (
    date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  );
}

/** "Apr 11 06:32" — same format as formatDate but from epoch ms. */
export function formatDateTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "06:32:15" — locale time string from epoch ms. */
export function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString();
}

/** "06:32" — short HH:MM. Accepts Date, epoch ms, or ISO string. */
export function formatShortTime(value: Date | number | string): string {
  try {
    const date = value instanceof Date ? value : new Date(value);
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(value);
  }
}

/** "Apr 11" — short month + day. Accepts Date, epoch ms, or ISO string. */
export function formatShortDate(value: Date | number | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** True when two Dates fall on the same calendar day. */
export function isSameDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

/** True when the given Date is today. */
export function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

/** "14:32" for today, "Apr 16 14:32" for past dates. Works with
 *  both epoch ms (number) and ISO strings. */
export function formatSmartTime(value: number | string): string {
  const date = new Date(value);
  const time = formatShortTime(date);
  if (isToday(date)) return time;
  return `${formatShortDate(date)} ${time}`;
}

const ONE_MINUTE = 60_000;
const ONE_HOUR = 3_600_000;
const ONE_DAY = 86_400_000;

/** "just now", "5m ago", "2h ago", "Apr 11" — relative time from ISO string. */
export function formatRelativeTime(iso: string): string {
  try {
    const date = new Date(iso);
    const diffMs = Date.now() - date.getTime();
    if (diffMs < ONE_MINUTE) return "just now";
    if (diffMs < ONE_HOUR) return `${Math.floor(diffMs / ONE_MINUTE)}m ago`;
    if (diffMs < ONE_DAY) return `${Math.floor(diffMs / ONE_HOUR)}h ago`;
    return formatShortDate(date);
  } catch {
    return iso;
  }
}
