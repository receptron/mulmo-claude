// Cross-source dedup — pure.
//
// Per #188 Q3: per-source archives keep every item, but the daily
// summary step dedupes across sources so a single article that
// lands in three RSS feeds only appears once in the summary.
//
// Dedup key: `stableItemId` (SHA-256 prefix of the normalized URL,
// see server/sources/urls.ts — the item shape already carries this
// as `item.id`). Items retain the first-seen occurrence and drop
// subsequent ones. Order is preserved so the caller's sort (e.g.
// newest-first across all sources) survives dedup.

import type { SourceItem } from "../types.js";

export interface DedupStats {
  uniqueCount: number;
  duplicateCount: number;
  // The winning sourceSlug per duplicate id — useful for the
  // daily summary footer ("N duplicates across sources A, B"
  // without naming item titles).
  duplicateSlugsById: Map<string, string[]>;
}

export interface DedupResult {
  items: SourceItem[];
  stats: DedupStats;
}

// Dedup an item list by `id` (stableItemId from urls.ts). Keeps
// the first occurrence; stats record which OTHER source slugs
// had duplicates of each kept item so the summary footer can
// credit them if needed.
export function dedupAcrossSources(items: readonly SourceItem[]): DedupResult {
  const seen = new Set<string>();
  const kept: SourceItem[] = [];
  const duplicateSlugsById = new Map<string, string[]>();
  let duplicateCount = 0;
  for (const item of items) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      kept.push(item);
      continue;
    }
    duplicateCount++;
    const dupSlugs = duplicateSlugsById.get(item.id) ?? [];
    // Keep the slug list unique: a single source that emits the
    // same item twice (e.g. feed pagination overlap) shouldn't
    // inflate the "across sources" footer stat.
    if (!dupSlugs.includes(item.sourceSlug)) dupSlugs.push(item.sourceSlug);
    duplicateSlugsById.set(item.id, dupSlugs);
  }
  return {
    items: kept,
    stats: {
      uniqueCount: kept.length,
      duplicateCount,
      duplicateSlugsById,
    },
  };
}
