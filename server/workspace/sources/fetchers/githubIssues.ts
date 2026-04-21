// GitHub Issues + PRs fetcher.
//
// Source config shape (PRs included by default — GitHub's REST
// `/issues` endpoint returns issues AND pulls, and the common
// use case for UC-5 in the plan is tracking both):
//
//   fetcher_kind: github-issues
//   github_repo: receptron/mulmoclaude
//   github_issue_state: open     # optional: open | closed | all
//   github_include_prs: true     # optional: true | false
//
// Flow: GET /repos/:owner/:repo/issues?state=...&since=...&sort=updated
//   → JSON array (issues + pulls) → parse each → optionally filter
//   out PRs → filter by cursor (updated_at > cursor) → normalize.
//
// Cursor strategy: we pass `since=<lastSeen>` as a server-side
// pre-filter AND also filter locally, because `since` is
// "updated at OR later" (inclusive) while we want strictly after.
// Cursor key: `github_issues_last_updated_at`.

import { normalizeUrl, stableItemId } from "../urls.js";
import type { Source, SourceItem, SourceState } from "../types.js";
import type { FetcherDeps, FetchResult, SourceFetcher } from "./index.js";
import { registerFetcher } from "./index.js";
import { GITHUB_API_BASE, GithubFetcherError, githubFetchJson, isRecord, parseRepoSlug } from "./github.js";
import { firstParagraph } from "./githubReleases.js";

export const ISSUES_CURSOR_KEY = "github_issues_last_updated_at";

// Whitelist of values the GitHub API accepts for `state`. A typo
// here (e.g. `state=Open` uppercase) returns 422 so we validate.
const ISSUE_STATES = new Set(["open", "closed", "all"]);

interface IssuesParams {
  state: "open" | "closed" | "all";
  includePrs: boolean;
}

// Parse + default the optional fetcherParams. Returns the
// resolved params. Invalid values fall back to defaults rather
// than erroring — a typo in the source file shouldn't silently
// break the daily pipeline.
export function resolveIssuesParams(params: Record<string, string>): IssuesParams {
  const rawState = params["github_issue_state"];
  const state = typeof rawState === "string" && ISSUE_STATES.has(rawState) ? (rawState as "open" | "closed" | "all") : "open";
  const rawInclude = params["github_include_prs"];
  // Any string value other than the literal "false" counts as
  // true. Users don't usually explicitly set it; if they do,
  // they probably want `false`.
  const includePrs = rawInclude !== "false";
  return { state, includePrs };
}

interface ParsedIssue {
  id: number | null;
  number: number | null;
  title: string | null;
  htmlUrl: string | null;
  body: string | null;
  updatedAt: string | null;
  createdAt: string | null;
  isPr: boolean;
  state: string | null;
}

// Narrow one GitHub issue record into ParsedIssue. Pure —
// exported for unit tests. `pull_request` field being present
// (even if empty) is GitHub's canonical "this issue is a PR"
// signal.
export function parseGithubIssue(raw: unknown): ParsedIssue | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === "number" && Number.isFinite(raw.id) ? raw.id : null;
  const issueNumber = typeof raw.number === "number" && Number.isFinite(raw.number) ? raw.number : null;
  const title = typeof raw.title === "string" ? raw.title : null;
  const htmlUrl = typeof raw.html_url === "string" ? raw.html_url : null;
  const body = typeof raw.body === "string" ? raw.body : null;
  const updatedAt = typeof raw.updated_at === "string" ? raw.updated_at : null;
  const createdAt = typeof raw.created_at === "string" ? raw.created_at : null;
  const state = typeof raw.state === "string" ? raw.state : null;
  // `pull_request` present in ANY form (object with url, empty
  // object) means this is a PR. Absence means it's an issue.
  const isPr = "pull_request" in raw && raw.pull_request !== undefined && raw.pull_request !== null;
  return {
    id,
    number: issueNumber,
    title,
    htmlUrl,
    body,
    updatedAt,
    createdAt,
    isPr,
    state,
  };
}

// Build a SourceItem from a parsed issue + the parent Source.
// Returns null when the item should be skipped (missing URL,
// cursor-old, PR when PRs excluded).
export function issueToSourceItem(issue: ParsedIssue, source: Source, params: IssuesParams, lastSeenTs: number | null): SourceItem | null {
  if (issue.isPr && !params.includePrs) return null;
  if (!issue.htmlUrl || !issue.updatedAt) return null;

  const updatedTs = Date.parse(issue.updatedAt);
  if (Number.isFinite(updatedTs) && lastSeenTs !== null) {
    // `since` is inclusive — re-filter strictly greater locally
    // so an item updated at the exact cursor time doesn't emit
    // again next run.
    if (updatedTs <= lastSeenTs) return null;
  }

  const normalizedUrl = normalizeUrl(issue.htmlUrl);
  if (!normalizedUrl) return null;
  const id = stableItemId(normalizedUrl);

  // Title annotations: `[PR]` for pulls, `[closed]` for closed
  // state so the daily summary makes state visible at a glance.
  const parts: string[] = [];
  if (issue.isPr) parts.push("[PR]");
  if (issue.state === "closed") parts.push("[closed]");
  const baseTitle = issue.title ?? `#${issue.number ?? "?"}`;
  const title = parts.length > 0 ? `${parts.join(" ")} ${baseTitle}` : baseTitle;

  const summary = issue.body ? firstParagraph(issue.body) : null;

  return {
    id,
    title,
    url: normalizedUrl,
    publishedAt: new Date(updatedTs).toISOString(),
    ...(summary !== null && { summary }),
    ...(issue.body !== null && { content: issue.body }),
    categories: source.categories,
    sourceSlug: source.slug,
  };
}

export function updateIssuesCursor(current: Record<string, string>, issues: readonly ParsedIssue[], params: IssuesParams): Record<string, string> {
  let newest: number | null = null;
  for (const issue of issues) {
    if (issue.isPr && !params.includePrs) continue;
    if (!issue.updatedAt) continue;
    const ts = Date.parse(issue.updatedAt);
    if (!Number.isFinite(ts)) continue;
    if (newest === null || ts > newest) newest = ts;
  }
  if (newest === null) return current;
  const currentTs = current[ISSUES_CURSOR_KEY] ? Date.parse(current[ISSUES_CURSOR_KEY]) : -Infinity;
  if (newest <= currentTs) return current;
  return {
    ...current,
    [ISSUES_CURSOR_KEY]: new Date(newest).toISOString(),
  };
}

// Pure: run parse + filter + cursor-advance on an already-fetched
// body, so tests can exercise the normalizer path without HTTP.
export function processIssuesResponse(rawBody: unknown, source: Source, params: IssuesParams, cursor: Record<string, string>): FetchResult {
  if (!Array.isArray(rawBody)) return { items: [], cursor };
  const parsed: ParsedIssue[] = [];
  for (const raw of rawBody) {
    const issue = parseGithubIssue(raw);
    if (issue) parsed.push(issue);
  }
  const lastSeenTs = cursor[ISSUES_CURSOR_KEY] ? Date.parse(cursor[ISSUES_CURSOR_KEY]) : null;
  const effectiveLastSeen = lastSeenTs !== null && Number.isFinite(lastSeenTs) ? lastSeenTs : null;

  const items: SourceItem[] = [];
  for (const issue of parsed) {
    if (items.length >= source.maxItemsPerFetch) break;
    const item = issueToSourceItem(issue, source, params, effectiveLastSeen);
    if (item) items.push(item);
  }
  return { items, cursor: updateIssuesCursor(cursor, parsed, params) };
}

// Build the GitHub issues URL. `since` and `per_page` are set
// for freshness + a reasonable upper bound (the API caps at 100).
// `sort=updated&direction=desc` pairs with the cursor so newest
// items arrive first.
export function issuesUrl(owner: string, repo: string, state: string, since: string | null, perPage: number): string {
  const params = new URLSearchParams();
  params.set("state", state);
  params.set("sort", "updated");
  params.set("direction", "desc");
  // GitHub API accepts max 100 per page. Clamp defensively.
  const clamped = Math.max(1, Math.min(100, Math.floor(perPage)));
  params.set("per_page", String(clamped));
  if (since) params.set("since", since);
  return `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?${params.toString()}`;
}

export const githubIssuesFetcher: SourceFetcher = {
  kind: "github-issues",
  async fetch(source: Source, state: SourceState, deps: FetcherDeps): Promise<FetchResult> {
    const repoRaw = source.fetcherParams["github_repo"];
    const slug = parseRepoSlug(repoRaw ?? "");
    if (!slug) {
      throw new GithubFetcherError(source.url, 0, `github_repo param is required and must be owner/repo, got ${JSON.stringify(repoRaw)}`);
    }
    const params = resolveIssuesParams(source.fetcherParams);
    const since = state.cursor[ISSUES_CURSOR_KEY] ?? null;
    const url = issuesUrl(slug.owner, slug.repo, params.state, since, source.maxItemsPerFetch);
    const body = await githubFetchJson(url, deps.http);
    return processIssuesResponse(body, source, params, state.cursor);
  },
};

registerFetcher(githubIssuesFetcher);
