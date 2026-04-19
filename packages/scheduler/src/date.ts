/** Format a Date as "YYYY-MM-DD" in UTC. */
export function toUtcIsoDate(ts: Date): string {
  const y = ts.getUTCFullYear();
  const m = String(ts.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ts.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
