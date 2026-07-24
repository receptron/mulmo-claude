// Canonical text helpers. Browser-safe: pure string work, no node imports.

/** Clip a string to at most `max` chars. The ellipsis is part of the budget,
 *  so the result never exceeds `max`.
 *
 *  Edge cases:
 *  - `text.length <= max` → `text` unchanged.
 *  - `max <= 0` → empty string (callers asking for "no output" should get no
 *    output, not a stray ellipsis).
 *  - `ellipsis.length >= max` → the ellipsis itself is clipped to `max` rather
 *    than throwing. Dropping this guard is what let the pre-#2217 core copy
 *    return 3 chars for `truncate("hello", 2, "...")` while promising in its
 *    own docblock that output never exceeds `max`. */
export function truncate(text: string, max: number, ellipsis = "…"): string {
  if (max <= 0) return "";
  if (text.length <= max) return text;
  if (ellipsis.length >= max) return ellipsis.slice(0, max);
  return text.slice(0, max - ellipsis.length) + ellipsis;
}
