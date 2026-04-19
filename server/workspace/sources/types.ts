// Data model for the information-source registry. Every source
// lives as one markdown file under `workspace/sources/<slug>.md`,
// with these fields in the YAML frontmatter plus optional free-form
// markdown notes in the body.
//
// Design invariants the consumer code relies on:
//
// - `slug` is the primary key and matches the filename exactly.
//   Enforced by `registry.ts` on both read and write.
// - `url` is always the normalized form (see urls.ts) so dedup
//   across sources works by string equality.
// - `fetcherKind` is one of a closed set so the fetcher dispatcher
//   can look up the right handler without `any`.
// - `schedule` drives the daily / weekly aggregation pipeline.
// - `categories` contains only valid CategorySlug values
//   (runtime-validated on read).
//
// Secrets (API tokens, bearer auth) are NEVER stored here —
// phase-1 scope is public sources only. Phase-3 authed fetchers
// will read credentials from `.env` at runtime by name; the name
// reference lives in `fetcherParams` as an `envVar` field.

import type { CategorySlug } from "./taxonomy.js";

// Closed set of fetcher kinds we can dispatch on. Adding a new
// fetcher means: add the string literal here, implement a matching
// module under `server/sources/fetchers/<kind>.ts`, and register
// it in the fetcher index. Nothing else in the framework needs to
// change.
//
// Phase-1 surface:
//   "rss"                — public RSS / Atom feeds (server-side fetch)
//   "github-releases"    — GitHub /releases endpoint, unauthenticated
//   "github-issues"      — GitHub /issues + /pulls, unauthenticated
//   "arxiv"              — arXiv query API
//   "web-fetch"          — one-shot page fetch via Claude's web_fetch
//   "web-search"         — ad-hoc query via Claude's web_search
export const FETCHER_KINDS = [
  "rss",
  "github-releases",
  "github-issues",
  "arxiv",
  "web-fetch",
  "web-search",
] as const;

export type FetcherKind = (typeof FETCHER_KINDS)[number];

const FETCHER_KIND_SET: ReadonlySet<string> = new Set(FETCHER_KINDS);

export function isFetcherKind(value: unknown): value is FetcherKind {
  return typeof value === "string" && FETCHER_KIND_SET.has(value);
}

// How often the daily pipeline is expected to refresh this source.
// `on-demand` sources are never auto-fetched; they only respond to
// the `manageSource fetch` action or the on-demand research
// workflow.
export const SOURCE_SCHEDULES = [
  "hourly",
  "daily",
  "weekly",
  "on-demand",
] as const;

export type SourceSchedule = (typeof SOURCE_SCHEDULES)[number];

const SOURCE_SCHEDULE_SET: ReadonlySet<string> = new Set(SOURCE_SCHEDULES);

export function isSourceSchedule(value: unknown): value is SourceSchedule {
  return typeof value === "string" && SOURCE_SCHEDULE_SET.has(value);
}

// Per-fetcher extra parameters carried on the Source file. Flat
// string map on disk so the minimal frontmatter parser can handle
// it without nested YAML. Fetchers interpret the keys they care
// about and ignore the rest — keeps cross-fetcher rewiring cheap.
export type FetcherParams = Record<string, string>;

// The on-disk configuration for one source. This is the exact
// shape serialized into the YAML frontmatter of
// `workspace/sources/<slug>.md` — state (cursors, etags, failure
// counts) lives separately under `_state/<slug>.json`.
export interface Source {
  slug: string;
  title: string;
  url: string;
  fetcherKind: FetcherKind;
  fetcherParams: FetcherParams;
  schedule: SourceSchedule;
  categories: CategorySlug[];
  maxItemsPerFetch: number;
  addedAt: string; // ISO timestamp
  notes: string; // markdown body of the file
}

// One normalized item after a fetch. All fetchers produce this
// shape regardless of source type so the pipeline / dedup / summary
// layers don't care where items came from.
export interface SourceItem {
  // Stable unique id for dedup. Hash of the normalized URL, or
  // the fetcher's native id (e.g. GitHub release id) when one is
  // available.
  id: string;
  title: string;
  url: string;
  publishedAt: string; // ISO timestamp
  // Short one-line summary if the fetcher can produce one without
  // LLM help. The pipeline's summarize step may replace this with
  // a richer LLM-generated version.
  summary?: string;
  // Full body content if available (RSS description, GitHub release
  // body, etc.). The summarize step reads this when the short
  // summary is insufficient.
  content?: string;
  // Categories inherited from the source this item came from.
  // Duplicated on the item so per-category daily rollups don't
  // need a re-join.
  categories: CategorySlug[];
  // Slug of the parent Source so the dashboard / notification
  // layer can link back.
  sourceSlug: string;
  // Optional severity hint set by the classifier or the fetcher
  // itself (security advisories set `critical`). Daily pipeline
  // uses this to decide whether to notify.
  severity?: "info" | "warn" | "critical";
}

// Per-source runtime state, NOT committed to git. Mirrors the
// Source-vs-_state split described in plans/feat-source-registry.md.
export interface SourceState {
  slug: string;
  // Last successful fetch.
  lastFetchedAt: string | null;
  // Fetcher-specific cursor — ISO timestamp, etag, GitHub release
  // id, arXiv last-seen, whatever the fetcher persists to
  // de-duplicate across runs. Free-form string map so the fetcher
  // interface doesn't need to know the shape upfront.
  cursor: Record<string, string>;
  // Consecutive failure count. Incremented per failed fetch,
  // reset to 0 on success. Drives exponential backoff.
  consecutiveFailures: number;
  // Timestamp after which the next attempt is allowed, so backoff
  // survives server restarts.
  nextAttemptAt: string | null;
}

export function defaultSourceState(slug: string): SourceState {
  return {
    slug,
    lastFetchedAt: null,
    cursor: {},
    consecutiveFailures: 0,
    nextAttemptAt: null,
  };
}
