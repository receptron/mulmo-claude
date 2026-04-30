import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  githubIssuesFetcher,
  parseGithubIssue,
  issueToSourceItem,
  formatIssueTitle,
  updateIssuesCursor,
  processIssuesResponse,
  resolveIssuesParams,
  issuesUrl,
  ISSUES_CURSOR_KEY,
} from "../../server/workspace/sources/fetchers/githubIssues.js";
import { GithubFetcherError } from "../../server/workspace/sources/fetchers/github.js";
import type { Source, SourceState } from "../../server/workspace/sources/types.js";
import type { FetcherDeps } from "../../server/workspace/sources/fetchers/index.js";
import { HostRateLimiter, type RateLimiterDeps } from "../../server/workspace/sources/rateLimiter.js";
import { DEFAULT_FETCH_TIMEOUT_MS, type HttpFetcherDeps } from "../../server/workspace/sources/httpFetcher.js";

// --- helpers -------------------------------------------------------------

function makeSource(over: Partial<Source> = {}): Source {
  return {
    slug: "repo-issues",
    title: "Repo issues",
    url: "https://github.com/receptron/mulmoclaude",
    fetcherKind: "github-issues",
    fetcherParams: { github_repo: "receptron/mulmoclaude" },
    schedule: "daily",
    categories: ["tech-news"],
    maxItemsPerFetch: 30,
    addedAt: "2026-04-01T00:00:00Z",
    notes: "",
    ...over,
  };
}

function makeState(over: Partial<SourceState> = {}): SourceState {
  return {
    slug: "repo-issues",
    lastFetchedAt: null,
    cursor: {},
    consecutiveFailures: 0,
    nextAttemptAt: null,
    consecutiveEmptyFetches: 0,
    emptyBackoffUntil: null,
    ...over,
  };
}

function controllableClock(): RateLimiterDeps {
  const state = { t: 0 };
  return {
    now: () => state.t,
    sleep: (delayMs) => {
      state.t += delayMs;
      return Promise.resolve();
    },
  };
}

function makeFetcherDeps(fetchImpl: typeof fetch): FetcherDeps {
  const clock = controllableClock();
  return {
    http: {
      fetchImpl,
      robots: async () => null,
      rateLimiter: new HostRateLimiter(clock),
      rateLimiterDeps: clock,
      crawlDelayMs: () => 0,
      timeoutMs: DEFAULT_FETCH_TIMEOUT_MS,
      onWillFetch: () => {},
    } as HttpFetcherDeps,
    now: () => Date.now(),
  };
}

function makeIssue(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 42,
    number: 7,
    title: "Bug: thing broken",
    html_url: "https://github.com/receptron/mulmoclaude/issues/7",
    body: "Repro steps:\n\n1. Click\n2. Observe",
    updated_at: "2026-04-10T10:00:00Z",
    created_at: "2026-04-05T10:00:00Z",
    state: "open",
    ...over,
  };
}

function makePr(over: Partial<Record<string, unknown>> = {}) {
  // GitHub marks PRs by attaching a `pull_request` field.
  return {
    ...makeIssue(over),
    number: 8,
    html_url: "https://github.com/receptron/mulmoclaude/pull/8",
    pull_request: { url: "https://api.github.com/.../pulls/8" },
    ...over,
  };
}

// --- resolveIssuesParams -------------------------------------------------

describe("resolveIssuesParams", () => {
  it("defaults to state=open, includePrs=true", () => {
    const params = resolveIssuesParams({});
    assert.equal(params.state, "open");
    assert.equal(params.includePrs, true);
  });

  it("accepts state=closed and state=all", () => {
    assert.equal(resolveIssuesParams({ github_issue_state: "closed" }).state, "closed");
    assert.equal(resolveIssuesParams({ github_issue_state: "all" }).state, "all");
  });

  it("falls back to `open` for unknown state values (typo tolerance)", () => {
    assert.equal(resolveIssuesParams({ github_issue_state: "Open" }).state, "open");
    assert.equal(resolveIssuesParams({ github_issue_state: "bogus" }).state, "open");
  });

  it("treats include_prs=`false` (lowercase) as false, anything else as true", () => {
    assert.equal(resolveIssuesParams({ github_include_prs: "false" }).includePrs, false);
    assert.equal(resolveIssuesParams({ github_include_prs: "true" }).includePrs, true);
    // Typos / other values default to true (the safer more-inclusive option)
    assert.equal(resolveIssuesParams({ github_include_prs: "False" }).includePrs, true);
    assert.equal(resolveIssuesParams({ github_include_prs: "0" }).includePrs, true);
  });
});

// --- issuesUrl -----------------------------------------------------------

describe("issuesUrl", () => {
  it("builds the canonical issues URL with state + sort + direction + per_page", () => {
    const url = issuesUrl("foo", "bar", "open", null, 50);
    const parsed = new URL(url);
    assert.equal(parsed.host, "api.github.com");
    assert.equal(parsed.pathname, "/repos/foo/bar/issues");
    assert.equal(parsed.searchParams.get("state"), "open");
    assert.equal(parsed.searchParams.get("sort"), "updated");
    assert.equal(parsed.searchParams.get("direction"), "desc");
    assert.equal(parsed.searchParams.get("per_page"), "50");
    assert.equal(parsed.searchParams.get("since"), null);
  });

  it("includes `since` when provided", () => {
    const url = issuesUrl("foo", "bar", "all", "2026-04-10T10:00:00Z", 30);
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("since"), "2026-04-10T10:00:00Z");
  });

  it("clamps per_page to the GitHub-API-allowed range", () => {
    assert.match(issuesUrl("x", "y", "open", null, 0), /per_page=1/);
    assert.match(issuesUrl("x", "y", "open", null, 9999), /per_page=100/);
    assert.match(issuesUrl("x", "y", "open", null, 42), /per_page=42/);
  });

  it("url-encodes repo segments (defensive — parseRepoSlug screens first)", () => {
    // parseRepoSlug rejects exotic characters but the URL builder
    // should still escape them so a future relaxation doesn't
    // re-open the bypass.
    const url = issuesUrl("user", "repo space", "open", null, 30);
    // %20 for space
    assert.match(url, /\/repos\/user\/repo%20space\//);
  });
});

// --- parseGithubIssue ----------------------------------------------------

describe("parseGithubIssue", () => {
  it("extracts the fields we consume", () => {
    const parsed = parseGithubIssue(makeIssue());
    assert.ok(parsed);
    assert.equal(parsed.id, 42);
    assert.equal(parsed.number, 7);
    assert.equal(parsed.title, "Bug: thing broken");
    assert.equal(parsed.htmlUrl, "https://github.com/receptron/mulmoclaude/issues/7");
    assert.equal(parsed.updatedAt, "2026-04-10T10:00:00Z");
    assert.equal(parsed.state, "open");
    assert.equal(parsed.isPr, false);
  });

  it("marks PRs via the pull_request field", () => {
    const parsed = parseGithubIssue(makePr());
    assert.ok(parsed);
    assert.equal(parsed.isPr, true);
  });

  it("treats a pull_request field with an empty object as PR", () => {
    const parsed = parseGithubIssue({ ...makeIssue(), pull_request: {} });
    assert.ok(parsed);
    assert.equal(parsed.isPr, true);
  });

  it("coerces missing fields to null, doesn't crash", () => {
    const parsed = parseGithubIssue({});
    assert.ok(parsed);
    assert.equal(parsed.id, null);
    assert.equal(parsed.number, null);
    assert.equal(parsed.title, null);
    assert.equal(parsed.htmlUrl, null);
    assert.equal(parsed.isPr, false);
  });

  it("returns null for non-objects", () => {
    assert.equal(parseGithubIssue("str"), null);
    assert.equal(parseGithubIssue([1, 2]), null);
    assert.equal(parseGithubIssue(null), null);
  });
});

// --- formatIssueTitle (pure helper) --------------------------------------

describe("formatIssueTitle", () => {
  // Build a minimal ParsedIssue. We don't go through parseGithubIssue
  // because the helper's contract is over the ParsedIssue shape, not
  // the raw GitHub payload.
  function makeParsed(overrides: Partial<Parameters<typeof formatIssueTitle>[0]> = {}): Parameters<typeof formatIssueTitle>[0] {
    return {
      id: 1,
      number: 7,
      title: "fix the thing",
      htmlUrl: "https://example.test/i/7",
      body: null,
      updatedAt: "2026-04-30T00:00:00Z",
      createdAt: "2026-04-29T00:00:00Z",
      isPr: false,
      state: "open",
      ...overrides,
    };
  }

  it("returns the bare title for a plain open issue", () => {
    assert.equal(formatIssueTitle(makeParsed()), "fix the thing");
  });

  it("prefixes [PR] for pull requests", () => {
    assert.equal(formatIssueTitle(makeParsed({ isPr: true })), "[PR] fix the thing");
  });

  it("prefixes [closed] for closed items", () => {
    assert.equal(formatIssueTitle(makeParsed({ state: "closed" })), "[closed] fix the thing");
  });

  it("combines [PR] [closed] in that order for closed PRs", () => {
    assert.equal(formatIssueTitle(makeParsed({ isPr: true, state: "closed" })), "[PR] [closed] fix the thing");
  });

  it("falls back to `#<number>` when the title is missing", () => {
    assert.equal(formatIssueTitle(makeParsed({ title: null })), "#7");
  });

  it("combines annotation and number fallback", () => {
    assert.equal(formatIssueTitle(makeParsed({ title: null, isPr: true })), "[PR] #7");
  });

  it("falls back to `#?` when both title and number are missing", () => {
    assert.equal(formatIssueTitle(makeParsed({ title: null, number: null })), "#?");
  });

  it("treats unknown state as not-closed (no [closed] prefix)", () => {
    // GitHub only returns "open" / "closed" today, but the field is
    // typed `string | null` so we should not annotate anything else.
    assert.equal(formatIssueTitle(makeParsed({ state: "draft" })), "fix the thing");
    assert.equal(formatIssueTitle(makeParsed({ state: null })), "fix the thing");
  });
});

// --- issueToSourceItem ---------------------------------------------------

describe("issueToSourceItem — title annotations", () => {
  it("annotates PRs with [PR]", () => {
    const issue = parseGithubIssue(makePr());
    assert.ok(issue);
    const params = { state: "open" as const, includePrs: true };
    const item = issueToSourceItem(issue, makeSource(), params, null);
    assert.ok(item);
    assert.match(item.title, /^\[PR\]/);
  });

  it("annotates closed items with [closed]", () => {
    const issue = parseGithubIssue(makeIssue({ state: "closed" }));
    assert.ok(issue);
    const params = { state: "all" as const, includePrs: true };
    const item = issueToSourceItem(issue, makeSource(), params, null);
    assert.ok(item);
    assert.match(item.title, /^\[closed\]/);
  });

  it("combines annotations [PR] [closed] for closed PRs", () => {
    const issue = parseGithubIssue(makePr({ state: "closed" }));
    assert.ok(issue);
    const params = { state: "all" as const, includePrs: true };
    const item = issueToSourceItem(issue, makeSource(), params, null);
    assert.ok(item);
    assert.match(item.title, /^\[PR\] \[closed\]/);
  });

  it("falls back to `#<number>` when title is missing", () => {
    const issue = parseGithubIssue(makeIssue({ title: null }));
    assert.ok(issue);
    const params = { state: "open" as const, includePrs: true };
    const item = issueToSourceItem(issue, makeSource(), params, null);
    assert.ok(item);
    assert.equal(item.title, "#7");
  });
});

describe("issueToSourceItem — filtering", () => {
  const params = { state: "open" as const, includePrs: true };

  it("drops PRs when includePrs is false", () => {
    const prIssue = parseGithubIssue(makePr());
    assert.ok(prIssue);
    const item = issueToSourceItem(prIssue, makeSource(), { state: "open", includePrs: false }, null);
    assert.equal(item, null);
  });

  it("drops when html_url or updated_at is missing", () => {
    const noUrl = parseGithubIssue(makeIssue({ html_url: null }));
    assert.ok(noUrl);
    assert.equal(issueToSourceItem(noUrl, makeSource(), params, null), null);
    const noDate = parseGithubIssue(makeIssue({ updated_at: null }));
    assert.ok(noDate);
    assert.equal(issueToSourceItem(noDate, makeSource(), params, null), null);
  });

  it("drops items at-or-older than the cursor (strict > filter)", () => {
    const issue = parseGithubIssue(makeIssue({ updated_at: "2026-04-10T10:00:00Z" }));
    assert.ok(issue);
    const atCursor = issueToSourceItem(issue, makeSource(), params, Date.parse("2026-04-10T10:00:00Z"));
    assert.equal(atCursor, null);
  });

  it("keeps items strictly newer than the cursor", () => {
    const issue = parseGithubIssue(makeIssue({ updated_at: "2026-04-11T10:00:00Z" }));
    assert.ok(issue);
    const item = issueToSourceItem(issue, makeSource(), params, Date.parse("2026-04-10T10:00:00Z"));
    assert.ok(item);
  });
});

// --- updateIssuesCursor --------------------------------------------------

describe("updateIssuesCursor", () => {
  const params = { state: "open" as const, includePrs: true };

  it("advances to the newest updated_at across the batch", () => {
    const issues = [
      parseGithubIssue(makeIssue({ updated_at: "2026-04-10T10:00:00Z" })),
      parseGithubIssue(makeIssue({ updated_at: "2026-04-13T10:00:00Z" })),
      parseGithubIssue(makeIssue({ updated_at: "2026-04-11T10:00:00Z" })),
    ].filter((issue) => issue !== null);
    const cursor = updateIssuesCursor({}, issues, params);
    assert.equal(cursor[ISSUES_CURSOR_KEY], "2026-04-13T10:00:00.000Z");
  });

  it("ignores PRs for cursor advancement when PRs are excluded", () => {
    const issues = [
      parseGithubIssue(makeIssue({ updated_at: "2026-04-10T10:00:00Z" })),
      parseGithubIssue(makePr({ updated_at: "2026-04-13T10:00:00Z" })),
    ].filter((issue) => issue !== null);
    const cursor = updateIssuesCursor({}, issues, {
      state: "open",
      includePrs: false,
    });
    // PR's updated_at shouldn't advance the cursor when it won't
    // be emitted next run either.
    assert.equal(cursor[ISSUES_CURSOR_KEY], "2026-04-10T10:00:00.000Z");
  });

  it("never rolls the cursor backwards", () => {
    const issues = [parseGithubIssue(makeIssue({ updated_at: "2026-04-01T00:00:00Z" }))].filter((issue) => issue !== null);
    const existing = { [ISSUES_CURSOR_KEY]: "2026-04-10T10:00:00Z" };
    const cursor = updateIssuesCursor(existing, issues, params);
    assert.equal(cursor[ISSUES_CURSOR_KEY], "2026-04-10T10:00:00Z");
  });
});

// --- processIssuesResponse ----------------------------------------------

describe("processIssuesResponse", () => {
  const params = { state: "open" as const, includePrs: true };

  it("filters by cursor and caps by maxItemsPerFetch", () => {
    const body = [makeIssue({ id: 1, updated_at: "2026-04-10T10:00:00Z" }), makeIssue({ id: 2, updated_at: "2026-04-13T10:00:00Z" })];
    const cursor = { [ISSUES_CURSOR_KEY]: "2026-04-11T00:00:00Z" };
    const result = processIssuesResponse(body, makeSource(), params, cursor);
    assert.equal(result.items.length, 1);
    // Cursor advances to the newest seen (id=2).
    assert.equal(result.cursor[ISSUES_CURSOR_KEY], "2026-04-13T10:00:00.000Z");
  });

  it("returns empty items + unchanged cursor on a non-array body", () => {
    const cursor = { [ISSUES_CURSOR_KEY]: "2026-04-10T10:00:00Z" };
    const result = processIssuesResponse({ message: "Not Found" }, makeSource(), params, cursor);
    assert.deepEqual(result.items, []);
    assert.equal(result.cursor[ISSUES_CURSOR_KEY], "2026-04-10T10:00:00Z");
  });

  it("excludes PRs when includePrs=false", () => {
    const body = [makeIssue({ id: 1, updated_at: "2026-04-10T10:00:00Z" }), makePr({ id: 2, updated_at: "2026-04-13T10:00:00Z" })];
    const result = processIssuesResponse(body, makeSource(), { state: "open", includePrs: false }, {});
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].title, "Bug: thing broken");
  });
});

// --- end-to-end with stubbed HTTP ---------------------------------------

describe("githubIssuesFetcher.fetch", () => {
  it("builds the correct URL and returns items + cursor", async () => {
    let capturedUrl = "";
    const fetchImpl: typeof fetch = async (input) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify([makeIssue()]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const result = await githubIssuesFetcher.fetch(makeSource(), makeState(), makeFetcherDeps(fetchImpl));
    assert.match(capturedUrl, /^https:\/\/api\.github\.com\/repos\/receptron\/mulmoclaude\/issues\?/);
    const parsedUrl = new URL(capturedUrl);
    assert.equal(parsedUrl.searchParams.get("state"), "open");
    assert.equal(parsedUrl.searchParams.get("sort"), "updated");
    assert.equal(result.items.length, 1);
    assert.equal(result.cursor[ISSUES_CURSOR_KEY], "2026-04-10T10:00:00.000Z");
  });

  it("passes `since` from the cursor on subsequent fetches", async () => {
    let capturedUrl = "";
    const fetchImpl: typeof fetch = async (input) => {
      capturedUrl = String(input);
      return new Response("[]", { status: 200 });
    };
    const state = makeState({
      cursor: { [ISSUES_CURSOR_KEY]: "2026-04-10T10:00:00Z" },
    });
    await githubIssuesFetcher.fetch(makeSource(), state, makeFetcherDeps(fetchImpl));
    const parsedUrl = new URL(capturedUrl);
    assert.equal(parsedUrl.searchParams.get("since"), "2026-04-10T10:00:00Z");
  });

  it("honours state / include_prs params in URL + filtering", async () => {
    let capturedUrl = "";
    const fetchImpl: typeof fetch = async (input) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify([makeIssue(), makePr()]), {
        status: 200,
      });
    };
    const result = await githubIssuesFetcher.fetch(
      makeSource({
        fetcherParams: {
          github_repo: "receptron/mulmoclaude",
          github_issue_state: "closed",
          github_include_prs: "false",
        },
      }),
      makeState(),
      makeFetcherDeps(fetchImpl),
    );
    const parsedUrl = new URL(capturedUrl);
    assert.equal(parsedUrl.searchParams.get("state"), "closed");
    // PR filtered out locally.
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].title, "Bug: thing broken");
  });

  it("rejects when github_repo is missing", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("should not fetch");
    };
    const source = makeSource({ fetcherParams: {} });
    await assert.rejects(() => githubIssuesFetcher.fetch(source, makeState(), makeFetcherDeps(fetchImpl)), GithubFetcherError);
  });

  it("registers itself as the `github-issues` fetcher on import", async () => {
    const { getFetcher } = await import("../../server/workspace/sources/fetchers/index.js");
    const fetcher = getFetcher("github-issues");
    assert.ok(fetcher);
    assert.equal(fetcher.kind, "github-issues");
  });
});
