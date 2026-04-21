// arXiv fetcher.
//
// arXiv's query API returns Atom 1.0 XML, which parseFeed already
// handles — so this fetcher is mostly "build URL + parse + filter
// by cursor". The arxiv-specific value-adds are:
//
//   1. Query-URL builder with sensible defaults
//      (sort=submittedDate, descending) and a defensive cap on
//      max_results (arXiv's own cap is 2000 but our phase-1
//      source model caps at maxItemsPerFetch)
//   2. Separate cursor key so a source that migrates between
//      fetcher kinds doesn't mishandle state
//
// Source config:
//
//   fetcher_kind: arxiv
//   arxiv_query: cat:cs.CL OR ti:"large language model"
//   arxiv_sort: submittedDate   # optional: submittedDate | lastUpdatedDate | relevance
//   arxiv_order: descending     # optional: ascending | descending
//
// The `arxiv_query` string goes straight into the API's
// `search_query` parameter (URL-encoded). arXiv's own query
// syntax supports boolean AND/OR/ANDNOT, field prefixes
// (ti:, au:, abs:, cat:, ...), and quoted phrases — we pass
// through verbatim.

import { normalizeUrl, stableItemId } from "../urls.js";
import type { Source, SourceItem, SourceState } from "../types.js";
import type { FetcherDeps, FetchResult, SourceFetcher } from "./index.js";
import { registerFetcher } from "./index.js";
import { fetchPolite } from "../httpFetcher.js";
import { parseFeed, type ParsedFeed } from "./rssParser.js";

export const ARXIV_CURSOR_KEY = "arxiv_last_published_at";

export const ARXIV_API_BASE = "https://export.arxiv.org/api/query";

const ALLOWED_SORT = new Set(["submittedDate", "lastUpdatedDate", "relevance"]);
const ALLOWED_ORDER = new Set(["ascending", "descending"]);

export class ArxivFetcherError extends Error {
  readonly url: string;
  readonly status: number | null;
  constructor(url: string, status: number | null, message: string) {
    super(message);
    this.name = "ArxivFetcherError";
    this.url = url;
    this.status = status;
  }
}

// Build the arXiv query URL. Validates and defaults sort / order
// so a typo in a source file falls back to a safe configuration
// rather than 400-ing from the API.
export function arxivUrl(query: string, sort: string, order: string, maxResults: number): string {
  const safeSort = ALLOWED_SORT.has(sort) ? sort : "submittedDate";
  const safeOrder = ALLOWED_ORDER.has(order) ? order : "descending";
  // arXiv caps at 2000 items per response; our maxItemsPerFetch
  // is usually 30-ish but clamp defensively so a mistyped large
  // value doesn't waste bandwidth.
  const clamped = Math.max(1, Math.min(200, Math.floor(maxResults)));
  const params = new URLSearchParams();
  params.set("search_query", query);
  params.set("start", "0");
  params.set("max_results", String(clamped));
  params.set("sortBy", safeSort);
  params.set("sortOrder", safeOrder);
  return `${ARXIV_API_BASE}?${params.toString()}`;
}

// Pure: given a parsed feed and the parent source, apply the
// cursor filter and normalize to SourceItem[]. Capped at
// `source.maxItemsPerFetch`. arXiv's feed items carry ISO
// publishedAt so the same comparison semantics as RSS apply —
// items at-or-older than the cursor are dropped.
export function normalizeArxivFeed(feed: ParsedFeed, source: Source, cursor: Record<string, string>): SourceItem[] {
  const lastSeenTs = parseCursorTs(cursor);
  const items: SourceItem[] = [];
  for (const entry of feed.items) {
    if (items.length >= source.maxItemsPerFetch) break;
    const item = feedItemToSourceItem(entry, source, lastSeenTs);
    if (item) items.push(item);
  }
  return items;
}

// Extract the cursor's ISO timestamp into a ms-since-epoch number
// usable for `<=` comparison. Returns null when absent or invalid
// (either case means "no cursor filtering, emit everything").
function parseCursorTs(cursor: Record<string, string>): number | null {
  const raw = cursor[ARXIV_CURSOR_KEY];
  if (!raw) return null;
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : null;
}

// Decide whether one ParsedFeedItem produces a SourceItem given
// the cursor. Returns null when the item should be skipped
// (missing link, unparseable URL, at-or-older than cursor).
// Extracted so `normalizeArxivFeed` stays under the cognitive-
// complexity threshold.
function feedItemToSourceItem(entry: ParsedFeed["items"][number], source: Source, lastSeenTs: number | null): SourceItem | null {
  if (!entry.link) return null;
  const normalizedUrl = normalizeUrl(entry.link);
  if (!normalizedUrl) return null;
  if (entry.publishedAt && lastSeenTs !== null) {
    const ts = Date.parse(entry.publishedAt);
    if (Number.isFinite(ts) && ts <= lastSeenTs) return null;
  }
  const publishedAt = entry.publishedAt ?? new Date().toISOString();
  return {
    id: stableItemId(normalizedUrl),
    title: entry.title,
    url: normalizedUrl,
    publishedAt,
    ...(entry.summary !== null && { summary: entry.summary }),
    ...(entry.content !== null && { content: entry.content }),
    categories: source.categories,
    sourceSlug: source.slug,
  };
}

// Advance the cursor to the newest publishedAt across the parsed
// feed (not just the emitted items), same pattern as the RSS /
// GitHub fetchers so a quiet arXiv query doesn't keep re-emitting
// the same papers after a one-off republish.
export function updateArxivCursor(current: Record<string, string>, feed: ParsedFeed): Record<string, string> {
  let newest: number | null = null;
  for (const entry of feed.items) {
    if (!entry.publishedAt) continue;
    const ts = Date.parse(entry.publishedAt);
    if (!Number.isFinite(ts)) continue;
    if (newest === null || ts > newest) newest = ts;
  }
  if (newest === null) return current;
  const currentTs = current[ARXIV_CURSOR_KEY] ? Date.parse(current[ARXIV_CURSOR_KEY]) : -Infinity;
  if (newest <= currentTs) return current;
  return {
    ...current,
    [ARXIV_CURSOR_KEY]: new Date(newest).toISOString(),
  };
}

export const arxivFetcher: SourceFetcher = {
  kind: "arxiv",
  async fetch(source: Source, state: SourceState, deps: FetcherDeps): Promise<FetchResult> {
    const query = source.fetcherParams["arxiv_query"];
    if (typeof query !== "string" || query.trim().length === 0) {
      throw new ArxivFetcherError(source.url, null, "arxiv_query param is required");
    }
    const sort = source.fetcherParams["arxiv_sort"] ?? "submittedDate";
    const order = source.fetcherParams["arxiv_order"] ?? "descending";
    const url = arxivUrl(query, sort, order, source.maxItemsPerFetch);
    const res = await fetchPolite(url, deps.http);
    if (!res.ok) {
      throw new ArxivFetcherError(url, res.status, `arXiv fetch failed with HTTP ${res.status}`);
    }
    const body = await res.text();
    const feed = parseFeed(body);
    if (!feed) {
      throw new ArxivFetcherError(url, res.status, `arXiv response did not parse as Atom / RSS`);
    }
    return {
      items: normalizeArxivFeed(feed, source, state.cursor),
      cursor: updateArxivCursor(state.cursor, feed),
    };
  },
};

registerFetcher(arxivFetcher);
