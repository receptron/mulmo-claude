// Google Calendar date/dateTime → the shape a collection `datetime` field is
// validated against (#2310).
//
// Google answers with RFC3339 including a zone designator for timed events
// (`2026-05-12T08:45:00+09:00`, sometimes `…Z`) and a bare `YYYY-MM-DD` for
// all-day ones. `parseIsoDateTime` — which the record lint, the calendar grid
// and the day view all share — accepts only `YYYY-MM-DDTHH:MM[:SS]`, so both
// shapes were stored and then reported as data problems on every synced record.
//
// The offset is DROPPED, not applied: the stored clock is then the one the user
// reads off Google Calendar, and it stays that clock wherever the workspace is
// opened. Converting to the host's local time would make a record's value
// depend on the machine that happened to run the sync, and silently shift every
// record when that machine moves timezone.
//
// Pure: no I/O, no clock, no locale.

/** All-day events carry no clock; midnight is where the day view places them. */
const ALL_DAY_CLOCK = "00:00";
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** RFC3339 zone designator: `Z`, `+09:00`, `-0500`. */
const ZONE_SUFFIX_RE = /(?:Z|[+-]\d{2}:?\d{2})$/;
/** Fractional seconds have no place in the collection datetime shape. */
const FRACTIONAL_SECONDS_RE = /\.\d+$/;

/** Normalise one Google Calendar time value for storage in a `datetime` field.
 *  Anything that isn't a recognisable Google shape (empty string, non-string,
 *  free text) is returned untouched — the record lint should report it rather
 *  than have this function invent a value. */
export function toCollectionDateTime(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (DATE_ONLY_RE.test(trimmed)) return `${trimmed}T${ALL_DAY_CLOCK}`;
  if (!trimmed.includes("T")) return value;
  return trimmed.replace(ZONE_SUFFIX_RE, "").replace(FRACTIONAL_SECONDS_RE, "");
}
