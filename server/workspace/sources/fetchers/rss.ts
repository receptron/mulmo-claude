// RSS / Atom source fetcher.
//
// Flow:
//   1. fetchPolite(source.url) — respects robots, User-Agent,
//      rate limit, timeout
//   2. parseFeed(bodyText) — pure XML → ParsedFeed
//   3. normalizeToSourceItems(...) — ParsedFeedItem[] → SourceItem[]
//      with cursor filtering so we only emit items newer than the
//      last-seen pubDate
//   4. updateCursor(...) — advance the cursor to the most-recent
//      publishedAt across ALL items in this response (not just
//      the emitted ones) so a quiet feed doesn't keep replaying
//      old items after a one-shot republish
//
// The parser / normalizer / cursor logic are pure functions
// exported for direct unit tests. The `rssFetcher` object is the
// Promise-aware orchestrator that stitches them together.

import { fetchPolite } from "../httpFetcher.js";
import { normalizeUrl, stableItemId } from "../urls.js";
import type { Source, SourceItem, SourceState } from "../types.js";
import type { FetcherDeps, FetchResult, SourceFetcher } from "./index.js";
import { registerFetcher } from "./index.js";
import { parseFeed, type ParsedFeed, type ParsedFeedItem } from "./rssParser.js";

// Cursor key we store in SourceState.cursor for RSS feeds.
// ISO timestamp of the most-recent item's publishedAt we've seen.
// Items whose publishedAt is <= this value are skipped on the
// next run. Separate key name from other fetchers so adding
// GitHub / arXiv cursors next to RSS ones on the same source
// never conflicts.
export const RSS_CURSOR_KEY = "rss_last_seen_at";

export class RssFetcherError extends Error {
  readonly url: string;
  readonly status: number | null;
  constructor(url: string, status: number | null, message: string) {
    super(message);
    this.name = "RssFetcherError";
    this.url = url;
    this.status = status;
  }
}

// Filter raw parsed items against the cursor and normalize into
// the pipeline's `SourceItem` shape. Pure — exported so tests
// can exercise cursor semantics with fabricated ParsedFeed
// structures without spinning up HTTP.
export function normalizeToSourceItems(feed: ParsedFeed, source: Source, cursor: Record<string, string>, maxItems: number): SourceItem[] {
  const lastSeen = cursor[RSS_CURSOR_KEY] ?? null;
  const lastSeenTs = lastSeen ? Date.parse(lastSeen) : null;
  const items: SourceItem[] = [];

  for (const entry of feed.items) {
    if (items.length >= maxItems) break;
    const item = entryToSourceItem(entry, source, lastSeenTs);
    if (item) items.push(item);
  }
  return items;
}

function entryToSourceItem(entry: ParsedFeedItem, source: Source, lastSeenTs: number | null): SourceItem | null {
  if (!entry.link) return null;
  const normalizedUrl = normalizeUrl(entry.link);
  if (!normalizedUrl) return null;
  // Cursor comparison: drop items at or older than the last-seen
  // timestamp. Null publishedAt → keep (rare but happens with
  // misformatted feeds; we'd rather emit a dup once than lose
  // an item forever).
  if (entry.publishedAt && lastSeenTs !== null) {
    const itemTs = Date.parse(entry.publishedAt);
    if (Number.isFinite(itemTs) && itemTs <= lastSeenTs) return null;
  }
  // Use the feed's own id as a hint, but always derive the
  // SourceItem.id from the normalized URL so cross-source dedup
  // (see #188 Q3) lines up regardless of feed conventions.
  const id = stableItemId(normalizedUrl);
  const publishedAt =
    entry.publishedAt ??
    // Synthesize a fetch-time timestamp when the feed didn't
    // provide one, so downstream sorting has a monotonic key.
    new Date().toISOString();

  // Build the SourceItem with conditional spreads so we don't
  // carry `undefined` fields that break exactOptionalPropertyTypes
  // on the server tsconfig.
  return {
    id,
    title: entry.title,
    url: normalizedUrl,
    publishedAt,
    ...(entry.summary !== null && { summary: entry.summary }),
    ...(entry.content !== null && { content: entry.content }),
    categories: source.categories,
    sourceSlug: source.slug,
  };
}

// After filtering, advance the cursor to the newest publishedAt
// in the full ParsedFeed (not just the emitted items). Doing
// this on the full set prevents a feed that republishes older
// items without updating pubDate from causing us to re-emit
// them forever.
//
// Exported pure so tests can pin the advancement policy down.
export function updateCursor(current: Record<string, string>, feed: ParsedFeed): Record<string, string> {
  let newest: number | null = null;
  for (const entry of feed.items) {
    if (!entry.publishedAt) continue;
    const ts = Date.parse(entry.publishedAt);
    if (!Number.isFinite(ts)) continue;
    if (newest === null || ts > newest) newest = ts;
  }
  if (newest === null) return current;
  // Only advance forwards. A feed whose newest item is older
  // than our cursor should leave the cursor where it was so
  // we don't retroactively re-emit everything on the next run.
  const currentTs = current[RSS_CURSOR_KEY] ? Date.parse(current[RSS_CURSOR_KEY]) : -Infinity;
  if (newest <= currentTs) return current;
  return { ...current, [RSS_CURSOR_KEY]: new Date(newest).toISOString() };
}

export const rssFetcher: SourceFetcher = {
  kind: "rss",
  async fetch(source: Source, state: SourceState, deps: FetcherDeps): Promise<FetchResult> {
    const res = await fetchPolite(source.url, deps.http);
    if (!res.ok) {
      throw new RssFetcherError(source.url, res.status, `RSS fetch ${source.url} failed with HTTP ${res.status}`);
    }
    const body = await res.text();
    const feed = parseFeed(body);
    if (!feed) {
      throw new RssFetcherError(source.url, res.status, `RSS body at ${source.url} did not parse as RSS / Atom / RDF`);
    }
    const items = normalizeToSourceItems(feed, source, state.cursor, source.maxItemsPerFetch);
    const cursor = updateCursor(state.cursor, feed);
    return { items, cursor };
  },
};

registerFetcher(rssFetcher);
