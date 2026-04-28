// Filter keys for the session-history panel. Kept here (not in
// `types/session.ts`) because `all` and `unread` are UI concepts — not
// session-origin values — even though the four origin filters reuse
// `SESSION_ORIGINS` verbatim so a single source of truth stays per
// concept.

import { SESSION_ORIGINS } from "../types/session";

export const HISTORY_FILTERS = {
  all: "all",
  unread: "unread",
  bookmarked: "bookmarked",
  human: SESSION_ORIGINS.human,
  scheduler: SESSION_ORIGINS.scheduler,
  skill: SESSION_ORIGINS.skill,
  bridge: SESSION_ORIGINS.bridge,
} as const;

export type HistoryFilter = (typeof HISTORY_FILTERS)[keyof typeof HISTORY_FILTERS];

// Display order for the pill row. `all` is always first; `unread` and
// `bookmarked` sit between `all` and the origin filters because they
// are user-state filters, not origin sub-filters.
export const HISTORY_FILTER_ORDER: readonly HistoryFilter[] = [
  HISTORY_FILTERS.all,
  HISTORY_FILTERS.unread,
  HISTORY_FILTERS.bookmarked,
  HISTORY_FILTERS.human,
  HISTORY_FILTERS.scheduler,
  HISTORY_FILTERS.skill,
  HISTORY_FILTERS.bridge,
] as const;
