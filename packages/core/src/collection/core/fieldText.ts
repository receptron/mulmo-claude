// Turning a record field into text.
//
// `CollectionItem` is `Record<string, unknown>`, so a field holds whatever the
// record's JSON had — including arrays and objects (real workspace data has
// plenty: weather `hourly`, GeoJSON `geometry`, `sites` lists). Bare
// `String(value)` on one of those yields `"[object Object]"`, which then gets
// compared, matched or displayed as if it were a value. Nothing throws; a
// predicate just silently stops matching, or the UI shows `[object Object]`.
//
// These two helpers are the only sanctioned way to read a field as text. The
// rule they encode was already in `itemLabelOf`: accept primitives, let
// everything else fall through to the caller's fallback.

/** A field value that has a meaningful text form. Dates are included because
 *  a JSON record can carry one once it has been revived. */
const isTextable = (value: unknown): value is string | number | boolean | Date =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value instanceof Date;

/** The field's text, or `null` when it has no meaningful one (absent, or an
 *  array/object that would stringify to `"[object Object]"`).
 *
 *  Returning `null` rather than `""` keeps "the field is empty" distinct from
 *  "the field can't be text" — a matcher must not treat an object-valued field
 *  as an empty string and match `""`. */
export function fieldTextOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (!isTextable(value)) return null;
  if (value instanceof Date) {
    // `new Date("nonsense")` is still `instanceof Date`, and `toISOString()`
    // throws `RangeError` on it. This helper sits on the match, sort and
    // display paths, so one unparseable date in one record would take the whole
    // render down — the loud version of the bug this module exists to prevent.
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  return String(value);
}

/** The field's text, or `fallback` (default `""`) when it has none. Use where
 *  a string is required and an empty one is a safe stand-in — display, sort
 *  keys, CSV cells. Where the distinction matters, use {@link fieldTextOrNull}. */
export function fieldText(value: unknown, fallback = ""): string {
  return fieldTextOrNull(value) ?? fallback;
}
