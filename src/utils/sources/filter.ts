// Sources list filter chips (#768).
//
// Pure predicate / key set used by `SourcesManager.vue`'s chip group.
// Splitting these out of the SFC keeps the component thin and lets the
// filter rules be unit-tested without rendering Vue.
//
// Single-select today: the chip clicked replaces the active filter.
// Multi-select / AND-composition is deliberately out of scope (see
// `plans/feat-sources-filter-chips-768.md`).

import type { Source } from "../../plugins/manageSource/index";

// Order matters — `SourcesManager.vue` renders chips in this order, so
// kind chips and schedule chips stay grouped without an extra layout
// indirection.
export const SOURCE_FILTER_KEYS = ["all", "rss", "github", "arxiv", "schedule:daily", "schedule:weekly", "schedule:manual"] as const;

export type SourceFilterKey = (typeof SOURCE_FILTER_KEYS)[number];

const SOURCE_FILTER_KEY_SET: ReadonlySet<string> = new Set(SOURCE_FILTER_KEYS);

export function isSourceFilterKey(value: unknown): value is SourceFilterKey {
  return typeof value === "string" && SOURCE_FILTER_KEY_SET.has(value);
}

const SCHEDULE_PREFIX = "schedule:";

/**
 * Predicate: does `source` belong to the bucket selected by `filter`?
 *
 * - `all` matches every source.
 * - `rss` / `arxiv` match by exact `fetcherKind`.
 * - `github` matches both `github-releases` and `github-issues` so the
 *   chip groups the two GitHub-shaped fetchers under one bucket
 *   (`SourcesManager`'s kind badges still distinguish them visually).
 * - `schedule:<kind>` matches by exact `schedule`. The colon-prefixed
 *   key keeps schedule chips disjoint from kind chips in `SOURCE_FILTER_KEYS`
 *   so a future caller can switch on the prefix without a separate
 *   "is this a schedule key" check.
 */
export function matchesSourceFilter(source: Source, filter: SourceFilterKey): boolean {
  if (filter === "all") return true;
  if (filter === "rss") return source.fetcherKind === "rss";
  if (filter === "github") return source.fetcherKind === "github-releases" || source.fetcherKind === "github-issues";
  if (filter === "arxiv") return source.fetcherKind === "arxiv";
  // The remaining keys are all `schedule:*`; the type system narrowed
  // the union but a runtime startsWith guards against future additions
  // that aren't schedule-shaped.
  if (filter.startsWith(SCHEDULE_PREFIX)) {
    return source.schedule === filter.slice(SCHEDULE_PREFIX.length);
  }
  return false;
}

/**
 * Per-chip count in the same order as `SOURCE_FILTER_KEYS`. Returned
 * as a record so callers can `count[key]` directly. The total count
 * (`all`) is included so the chip can show `All (N)` without an extra
 * `sources.length` reference.
 */
export function countByFilter(sources: readonly Source[]): Record<SourceFilterKey, number> {
  const counts = Object.fromEntries(SOURCE_FILTER_KEYS.map((key) => [key, 0])) as Record<SourceFilterKey, number>;
  for (const source of sources) {
    for (const key of SOURCE_FILTER_KEYS) {
      if (matchesSourceFilter(source, key)) counts[key] += 1;
    }
  }
  return counts;
}
