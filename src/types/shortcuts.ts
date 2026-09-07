// Shared shape for a launcher shortcut (pinned collection / feed).
//
// A shortcut is a thin, generic record — it carries NO collection- or
// feed-specific logic. `kind` selects which existing route family the
// host navigates to (`/collections/:slug` or `/feeds/:slug`), and
// `title` / `icon` are cached at pin time so the launcher renders
// without re-fetching every index. A stale cached label (collection
// renamed) is acceptable; it self-heals on the next index visit.
//
// Browser-safe (no Node imports) so both the Vue frontend and the
// Express server can import this single definition.

/** Which route family a shortcut points at. */
export const SHORTCUT_KINDS = ["collection", "feed"] as const;
export type ShortcutKind = (typeof SHORTCUT_KINDS)[number];

/** What MulmoClaude understands a shortcut to be — a SUBSET of what a stored
 *  record may hold, not the whole of it.
 *
 *  `config/shortcuts.json` is shared with MulmoTerminal, so the file is the
 *  union of every version of both apps that has written it and a record can
 *  carry fields this build has never heard of. Those are carried through rather
 *  than dropped (`unknownShortcutFields` below, #3055). */
export interface Shortcut {
  /** Which route family — drives `router.push({ name: kind, ... })`. */
  kind: ShortcutKind;
  /** The `:slug` route param for the target collection / feed. */
  slug: string;
  /** Cached display label (user-named) — refreshed on reconcile. */
  title: string;
  /** Cached material-symbols glyph — refreshed on reconcile. */
  icon: string;
  /** Cached accent colour name — refreshed on reconcile. Absent when the
   *  collection / feed names none, which reads as the unstyled default. */
  color?: string;
}

/** On-disk shape of `config/shortcuts.json`. Object wrapper (not a
 *  bare array) so the schema can grow without a migration. */
export interface ShortcutsFile {
  shortcuts: Shortcut[];
}

/** The fields this build names. Decides what gets VALIDATED and rebuilt — not
 *  what a stored record may contain. */
export const KNOWN_SHORTCUT_KEYS: readonly (keyof Shortcut)[] = ["kind", "slug", "title", "icon", "color"];

/** Everything in a stored record that this build does not name, to be spread
 *  back UNDER the known fields so a validated value always wins.
 *
 *  Both apps rebuild every record they write, so a field only one of them names
 *  is deleted by the other — silently, and visibly only to whoever opens the app
 *  that lost it. `color` was exactly that (#2987 here, mulmoterminal#1993 the
 *  other way). Naming each new field in both apps is a rule someone has to
 *  remember; carrying the rest through is not.
 *
 *  Built with `Object.fromEntries` rather than by assignment: a key named
 *  `__proto__` is a setter on `Object.prototype`, so assigning it re-parents the
 *  object and drops the key from the JSON entirely. `fromEntries` defines an own
 *  property, leaving it as ordinary data. */
export function unknownShortcutFields(raw: Shortcut | Record<string, unknown>): Record<string, unknown> {
  const entries: [string, unknown][] = Object.entries(raw);
  return Object.fromEntries(entries.filter(([key]) => !KNOWN_SHORTCUT_KEYS.some((known) => known === key)));
}

/** True when two shortcuts target the same thing (the dedupe key). */
export function sameShortcut(left: Pick<Shortcut, "kind" | "slug">, right: Pick<Shortcut, "kind" | "slug">): boolean {
  return left.kind === right.kind && left.slug === right.slug;
}
