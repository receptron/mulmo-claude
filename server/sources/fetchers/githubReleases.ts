// GitHub Releases fetcher.
//
// Source config shape:
//
//   fetcher_kind: github-releases
//   github_repo: anthropics/claude-code
//
// Flow: GET /repos/:owner/:repo/releases → JSON array → parse each
// release → filter against cursor (published_at) → normalize to
// SourceItem.
//
// Cursor key: `github_releases_last_published_at` — ISO timestamp
// of the newest release we've emitted. Separate key from the RSS
// cursor so a source transitioning between fetcher kinds doesn't
// mishandle state.
//
// Unauthenticated only in phase 1. The 60 req/hour/IP rate-limit
// is plenty for a workspace with a handful of repos.

import { normalizeUrl, stableItemId } from "../urls.js";
import type { Source, SourceItem, SourceState } from "../types.js";
import type { FetcherDeps, FetchResult, SourceFetcher } from "./index.js";
import { registerFetcher } from "./index.js";
import {
  GITHUB_API_BASE,
  GithubFetcherError,
  githubFetchJson,
  isRecord,
  parseRepoSlug,
} from "./github.js";

export const RELEASES_CURSOR_KEY = "github_releases_last_published_at";

// GitHub Releases endpoint. 30 releases per page by default; we
// cap at `source.maxItemsPerFetch` downstream. Phase-1 doesn't
// paginate — one page covers every active project's last ~1-2
// years of releases, plenty for the cursor to advance on.
function releasesUrl(owner: string, repo: string): string {
  return `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases`;
}

// One parsed release. Mirrors the GitHub API shape we actually
// read (we drop the other ~20 fields for clarity and to keep the
// normalizer testable in isolation).
interface ParsedRelease {
  id: number | null;
  name: string | null;
  tagName: string | null;
  htmlUrl: string | null;
  body: string | null;
  publishedAt: string | null;
  draft: boolean;
  prerelease: boolean;
}

// Narrow one GitHub release record into ParsedRelease. Pure —
// exported so tests can exercise the JSON-shape handling without
// hitting the network.
export function parseGithubRelease(raw: unknown): ParsedRelease | null {
  if (!isRecord(raw)) return null;
  const id =
    typeof raw.id === "number" && Number.isFinite(raw.id) ? raw.id : null;
  const name = typeof raw.name === "string" ? raw.name : null;
  const tagName = typeof raw.tag_name === "string" ? raw.tag_name : null;
  const htmlUrl = typeof raw.html_url === "string" ? raw.html_url : null;
  const body = typeof raw.body === "string" ? raw.body : null;
  const publishedAt =
    typeof raw.published_at === "string" ? raw.published_at : null;
  const draft = raw.draft === true;
  const prerelease = raw.prerelease === true;
  return { id, name, tagName, htmlUrl, body, publishedAt, draft, prerelease };
}

// Build a SourceItem from a parsed release + the parent Source.
// Returns null when the release doesn't carry the fields we need
// to make a useful item (missing URL, or cursor says we've seen
// this release already).
export function releaseToSourceItem(
  release: ParsedRelease,
  source: Source,
  lastSeenTs: number | null,
): SourceItem | null {
  // Drafts are private — GitHub only shows them to authed readers.
  // But defensively skip if the API somehow returns one.
  if (release.draft) return null;
  if (!release.htmlUrl || !release.publishedAt) return null;

  // Cursor filter: drop releases at-or-older than the cursor.
  // Null cursor means first run → pass through.
  const publishedTs = Date.parse(release.publishedAt);
  if (Number.isFinite(publishedTs) && lastSeenTs !== null) {
    if (publishedTs <= lastSeenTs) return null;
  }

  const normalizedUrl = normalizeUrl(release.htmlUrl);
  if (!normalizedUrl) return null;
  const id = stableItemId(normalizedUrl);

  // Title resolution: prefer <name> (release display name), fall
  // back to <tag_name> (e.g. "v1.2.3"). Annotate pre-releases so
  // the daily summary can visually distinguish them.
  const baseTitle = release.name ?? release.tagName ?? "Release";
  const title = release.prerelease ? `[pre] ${baseTitle}` : baseTitle;
  const summary = release.body ? firstParagraph(release.body) : null;

  return {
    id,
    title,
    url: normalizedUrl,
    publishedAt: new Date(publishedTs).toISOString(),
    ...(summary !== null && { summary }),
    ...(release.body !== null && { content: release.body }),
    categories: source.categories,
    sourceSlug: source.slug,
  };
}

// Extract the first "paragraph" of a release body for the short
// summary. GitHub release bodies are Markdown — we take everything
// up to the first double-newline so multi-line markdown lists or
// images in paragraph 2+ don't bloat the summary.
//
// Pure; exported for tests.
export function firstParagraph(body: string): string | null {
  const trimmed = body.trim();
  if (!trimmed) return null;
  const doubleNewline = trimmed.indexOf("\n\n");
  const head = doubleNewline === -1 ? trimmed : trimmed.slice(0, doubleNewline);
  return head.length > 0 ? head : null;
}

// After filtering, advance the cursor to the newest publishedAt
// across ALL parsed releases in the response — not just the
// emitted ones — so a quiet repo doesn't keep replaying its last
// release on every run.
//
// Exported pure for direct unit testing.
export function updateReleasesCursor(
  current: Record<string, string>,
  releases: readonly ParsedRelease[],
): Record<string, string> {
  let newest: number | null = null;
  for (const release of releases) {
    if (release.draft) continue;
    if (!release.publishedAt) continue;
    const ts = Date.parse(release.publishedAt);
    if (!Number.isFinite(ts)) continue;
    if (newest === null || ts > newest) newest = ts;
  }
  if (newest === null) return current;
  const currentTs = current[RELEASES_CURSOR_KEY]
    ? Date.parse(current[RELEASES_CURSOR_KEY])
    : -Infinity;
  if (newest <= currentTs) return current;
  return {
    ...current,
    [RELEASES_CURSOR_KEY]: new Date(newest).toISOString(),
  };
}

// Pure: run the parse + filter + cursor-advance pipeline on an
// already-fetched JSON body. Exposed separately from the fetch
// itself so we can test the full normalization path with
// fabricated API responses and no HTTP stubbing.
export function processReleasesResponse(
  rawBody: unknown,
  source: Source,
  cursor: Record<string, string>,
): FetchResult {
  if (!Array.isArray(rawBody)) {
    return { items: [], cursor };
  }
  const parsed: ParsedRelease[] = [];
  for (const raw of rawBody) {
    const release = parseGithubRelease(raw);
    if (release) parsed.push(release);
  }
  const lastSeenTs = cursor[RELEASES_CURSOR_KEY]
    ? Date.parse(cursor[RELEASES_CURSOR_KEY])
    : null;
  const effectiveLastSeen =
    lastSeenTs !== null && Number.isFinite(lastSeenTs) ? lastSeenTs : null;

  const items: SourceItem[] = [];
  for (const release of parsed) {
    if (items.length >= source.maxItemsPerFetch) break;
    const item = releaseToSourceItem(release, source, effectiveLastSeen);
    if (item) items.push(item);
  }
  return {
    items,
    cursor: updateReleasesCursor(cursor, parsed),
  };
}

export const githubReleasesFetcher: SourceFetcher = {
  kind: "github-releases",
  async fetch(
    source: Source,
    state: SourceState,
    deps: FetcherDeps,
  ): Promise<FetchResult> {
    const repoRaw = source.fetcherParams["github_repo"];
    const slug = parseRepoSlug(repoRaw ?? "");
    if (!slug) {
      throw new GithubFetcherError(
        source.url,
        0,
        `github_repo param is required and must be owner/repo, got ${JSON.stringify(repoRaw)}`,
      );
    }
    const url = releasesUrl(slug.owner, slug.repo);
    const body = await githubFetchJson(url, deps.http);
    return processReleasesResponse(body, source, state.cursor);
  },
};

registerFetcher(githubReleasesFetcher);
