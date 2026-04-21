// Shared date-formatting and date-validation helpers. Previously
// scattered across workspace/journal/paths.ts, journal/indexFile.ts,
// and workspace/tool-trace/writeSearch.ts.

/**
 * YYYY-MM-DD in the LOCAL timezone. Used for journal daily paths
 * and human-facing date labels — "what did I do on 2026-04-11"
 * is a wall-clock question, not a UTC question.
 */
export function toLocalIsoDate(input: Date | number): string {
  const dateValue = typeof input === "number" ? new Date(input) : input;
  const year = dateValue.getFullYear();
  const month = String(dateValue.getMonth() + 1).padStart(2, "0");
  const day = String(dateValue.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * YYYY-MM-DD in UTC. Used for tool-trace search directories and
 * any context where the date must not shift with the server's
 * local timezone.
 */
export function toUtcIsoDate(timestamp: Date): string {
  const year = timestamp.getUTCFullYear();
  const month = String(timestamp.getUTCMonth() + 1).padStart(2, "0");
  const day = String(timestamp.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
export function isValidIsoDate(input: string): boolean {
  if (input.length !== 10) return false;
  if (input[4] !== "-" || input[7] !== "-") return false;
  return isNumeric(input.slice(0, 4)) && isNumeric(input.slice(5, 7)) && isNumeric(input.slice(8, 10));
}

function isNumeric(input: string): boolean {
  if (input.length === 0) return false;
  for (let index = 0; index < input.length; index++) {
    const code = input.charCodeAt(index);
    if (code < 48 || code > 57) return false;
  }
  return true;
}
