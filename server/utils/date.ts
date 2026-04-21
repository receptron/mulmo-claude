// Shared date-formatting and date-validation helpers. Previously
// scattered across workspace/journal/paths.ts, journal/indexFile.ts,
// and workspace/tool-trace/writeSearch.ts.

/**
 * YYYY-MM-DD in the LOCAL timezone. Used for journal daily paths
 * and human-facing date labels — "what did I do on 2026-04-11"
 * is a wall-clock question, not a UTC question.
 */
export function toLocalIsoDate(input: Date | number): string {
  const d = typeof input === "number" ? new Date(input) : input;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * YYYY-MM-DD in UTC. Used for tool-trace search directories and
 * any context where the date must not shift with the server's
 * local timezone.
 */
export function toUtcIsoDate(ts: Date): string {
  const y = ts.getUTCFullYear();
  const m = String(ts.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ts.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Trim an ISO timestamp string to its YYYY-MM-DD date prefix.
 * Example: "2026-04-11T08:30:00Z" → "2026-04-11".
 */
export function isoDateOnly(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Strict validation of a YYYY-MM-DD string without regex —
 * checks length, separator positions, and numeric segments.
 * Does NOT validate month/day ranges (Feb 30 passes); that's the
 * caller's or LLM's responsibility.
 */
export function isValidIsoDate(s: string): boolean {
  if (s.length !== 10) return false;
  if (s[4] !== "-" || s[7] !== "-") return false;
  return isNumeric(s.slice(0, 4)) && isNumeric(s.slice(5, 7)) && isNumeric(s.slice(8, 10));
}

function isNumeric(s: string): boolean {
  if (s.length === 0) return false;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 48 || code > 57) return false;
  }
  return true;
}
