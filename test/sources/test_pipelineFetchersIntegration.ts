// Multi-fetcher pipeline integration test.
//
// test_pipelineEntry.ts already covers the pipeline's orchestration
// logic, but it injects a hand-rolled `fakeFetcher` via DI so the real
// fetcher modules (rss / githubReleases / githubIssues / arxiv) never
// actually run. That's what let the "nothing imports registerAll"
// bug through — every source round-tripped through a fake.
//
// This file takes the opposite approach: register one source of each
// kind in a temp workspace, hand the pipeline the production
// `registryGetFetcher`, and drive a URL-keyed `fetchImpl` that returns
// realistic upstream response bodies. If the fetcher module,
// registration, URL construction, parser, normalizer, and cursor
// update all work together, each source produces ≥1 item and the
// items appear in the daily file.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// NB: we intentionally do NOT import registerAll here. The pipeline
// module itself is responsible for importing it, so these tests
// verify that too — if someone removes the bootstrap import from
// `server/workspace/sources/pipeline/index.ts`, this file fails before any of
// the realistic HTTP routing even runs.
import { runSourcesPipeline } from "../../server/workspace/sources/pipeline/index.js";
import { writeSource } from "../../server/workspace/sources/registry.js";
import { DEFAULT_FETCH_TIMEOUT_MS, type HttpFetcherDeps } from "../../server/workspace/sources/httpFetcher.js";
import { HostRateLimiter, type RateLimiterDeps } from "../../server/workspace/sources/rateLimiter.js";
import type { FetcherKind, Source, SourceItem } from "../../server/workspace/sources/types.js";

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "mulmo-sources-integration-"));
});
afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

// Test-only summarizer: just lists every item title as a bullet.
// Extracted so the sonarjs/no-nested-template-literals rule stays
// happy (inline template-literal + .map().join() → nested).
async function stubSummarize(items: readonly SourceItem[]): Promise<string> {
  const lines = items.map((i) => `- ${i.title}`).join("\n");
  return `# brief\n\n${lines}\n`;
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

function makeSource(over: Partial<Source> & Pick<Source, "slug">): Source {
  return {
    title: "",
    url: "",
    fetcherKind: "rss",
    fetcherParams: {},
    schedule: "daily",
    categories: ["tech-news"],
    maxItemsPerFetch: 30,
    addedAt: "2026-04-01T00:00:00Z",
    notes: "",
    ...over,
  };
}

// Minimal HTTP deps with a URL-keyed response table. Any URL not in
// the table fails the test immediately (better than silently fetching
// the real network).
function makeHttpDeps(routes: { url: RegExp | string; body: string; contentType?: string }[]): HttpFetcherDeps {
  const clock = controllableClock();
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    const match = routes.find((route) => (typeof route.url === "string" ? url === route.url : route.url.test(url)));
    if (!match) {
      throw new Error(`test: unexpected fetch ${url}`);
    }
    return new Response(match.body, {
      status: 200,
      headers: {
        "Content-Type": match.contentType ?? "application/xml",
      },
    });
  };
  return {
    fetchImpl,
    robots: async () => null,
    rateLimiter: new HostRateLimiter(clock),
    rateLimiterDeps: clock,
    crawlDelayMs: () => 0,
    timeoutMs: DEFAULT_FETCH_TIMEOUT_MS,
    onWillFetch: () => {},
  };
}

// --- realistic upstream bodies ------------------------------------------

const RSS_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Demo RSS</title>
    <link>https://example.com/</link>
    <item>
      <title>Show HN: Something cool</title>
      <link>https://example.com/cool</link>
      <pubDate>Mon, 14 Apr 2026 10:00:00 GMT</pubDate>
      <description>Short description.</description>
    </item>
    <item>
      <title>Ask HN: Question</title>
      <link>https://news.ycombinator.com/item?id=123</link>
      <pubDate>Mon, 14 Apr 2026 09:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const GITHUB_RELEASES_BODY = JSON.stringify([
  {
    id: 1,
    tag_name: "v2.0.0",
    name: "2.0.0",
    html_url: "https://github.com/anthropics/claude-code/releases/tag/v2.0.0",
    body: "Release notes for 2.0.",
    published_at: "2026-04-14T10:00:00Z",
    draft: false,
    prerelease: false,
  },
  {
    id: 2,
    tag_name: "v1.9.0",
    name: "1.9.0",
    html_url: "https://github.com/anthropics/claude-code/releases/tag/v1.9.0",
    body: "Release notes for 1.9.",
    published_at: "2026-04-10T10:00:00Z",
    draft: false,
    prerelease: false,
  },
]);

const GITHUB_ISSUES_BODY = JSON.stringify([
  {
    id: 100,
    number: 42,
    title: "Bug: something broken",
    html_url: "https://github.com/anthropics/claude-code/issues/42",
    body: "Steps to reproduce…",
    updated_at: "2026-04-14T10:00:00Z",
    created_at: "2026-04-14T09:00:00Z",
    state: "open",
  },
  {
    id: 101,
    number: 43,
    title: "Feature request: something nice",
    html_url: "https://github.com/anthropics/claude-code/issues/43",
    body: "Would be great if…",
    updated_at: "2026-04-13T10:00:00Z",
    created_at: "2026-04-13T09:00:00Z",
    state: "open",
  },
]);

const ARXIV_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>arXiv Query</title>
  <entry>
    <title>Scaling laws revisited</title>
    <id>https://arxiv.org/abs/2604.11111</id>
    <link rel="alternate" href="https://arxiv.org/abs/2604.11111" />
    <published>2026-04-12T00:00:00Z</published>
    <summary>Abstract text.</summary>
  </entry>
  <entry>
    <title>On the geometry of transformers</title>
    <id>https://arxiv.org/abs/2604.22222</id>
    <link rel="alternate" href="https://arxiv.org/abs/2604.22222" />
    <published>2026-04-11T00:00:00Z</published>
    <summary>More abstract text.</summary>
  </entry>
</feed>`;

// --- per-kind happy-path tests ------------------------------------------

interface FixtureCase {
  slug: string;
  kind: FetcherKind;
  url: string;
  fetcherParams: Record<string, string>;
  httpRoute: { url: RegExp | string; body: string; contentType?: string };
  expectedMinItems: number;
  expectedTitleFragment: string;
}

const CASES: FixtureCase[] = [
  {
    slug: "demo-rss",
    kind: "rss",
    url: "https://example.com/rss",
    fetcherParams: { rss_url: "https://example.com/rss" },
    httpRoute: {
      url: "https://example.com/rss",
      body: RSS_BODY,
      contentType: "application/rss+xml",
    },
    expectedMinItems: 2,
    expectedTitleFragment: "Show HN",
  },
  {
    slug: "gh-releases",
    kind: "github-releases",
    url: "https://github.com/anthropics/claude-code",
    fetcherParams: { github_repo: "anthropics/claude-code" },
    httpRoute: {
      url: /^https:\/\/api\.github\.com\/repos\/anthropics\/claude-code\/releases$/,
      body: GITHUB_RELEASES_BODY,
      contentType: "application/json",
    },
    expectedMinItems: 2,
    expectedTitleFragment: "2.0.0",
  },
  {
    slug: "gh-issues",
    kind: "github-issues",
    url: "https://github.com/anthropics/claude-code/issues",
    fetcherParams: { github_repo: "anthropics/claude-code" },
    httpRoute: {
      url: /^https:\/\/api\.github\.com\/repos\/anthropics\/claude-code\/issues/,
      body: GITHUB_ISSUES_BODY,
      contentType: "application/json",
    },
    expectedMinItems: 2,
    expectedTitleFragment: "Bug:",
  },
  {
    slug: "arxiv-cs-cl",
    kind: "arxiv",
    url: "https://export.arxiv.org/api/query?search_query=cat:cs.CL",
    fetcherParams: { arxiv_query: "cat:cs.CL" },
    httpRoute: {
      url: /^https:\/\/export\.arxiv\.org\/api\/query/,
      body: ARXIV_BODY,
      contentType: "application/atom+xml",
    },
    expectedMinItems: 2,
    expectedTitleFragment: "Scaling laws",
  },
];

describe("pipeline integration with real fetchers", () => {
  for (const testCase of CASES) {
    it(`${testCase.kind} source produces items end-to-end`, async () => {
      await writeSource(
        workspace,
        makeSource({
          slug: testCase.slug,
          title: testCase.slug,
          url: testCase.url,
          fetcherKind: testCase.kind,
          fetcherParams: testCase.fetcherParams,
        }),
      );
      const result = await runSourcesPipeline({
        workspaceRoot: workspace,
        scheduleType: "daily",
        fetcherDeps: {
          http: makeHttpDeps([testCase.httpRoute]),
          now: () => Date.now(),
        },
        // Skip the real claude CLI call — the pipeline doesn't need
        // a summary that the classifier would have produced upstream.
        summarizeFn: stubSummarize,
        nowMs: () => Date.now(),
      });
      assert.equal(result.plannedCount, 1);
      assert.ok(
        result.items.length >= testCase.expectedMinItems,
        `expected at least ${testCase.expectedMinItems} items for ${testCase.kind}, got ${result.items.length}`,
      );
      assert.ok(
        result.items.some((i) => i.title?.includes(testCase.expectedTitleFragment)),
        `expected an item titled ~"${testCase.expectedTitleFragment}" for ${testCase.kind}; got titles: ${result.items.map((i) => i.title).join(", ")}`,
      );
      // Daily file actually contains the items we fetched.
      const daily = await readFile(result.dailyPath, "utf-8");
      assert.ok(daily.includes(testCase.expectedTitleFragment), `daily file should mention "${testCase.expectedTitleFragment}"`);
    });
  }

  it("runs all four kinds together in one pass (cross-source)", async () => {
    // Write one source per kind so the pipeline plans them all.
    for (const testCase of CASES) {
      await writeSource(
        workspace,
        makeSource({
          slug: testCase.slug,
          title: testCase.slug,
          url: testCase.url,
          fetcherKind: testCase.kind,
          fetcherParams: testCase.fetcherParams,
        }),
      );
    }
    const http = makeHttpDeps(CASES.map((testCase) => testCase.httpRoute));
    const result = await runSourcesPipeline({
      workspaceRoot: workspace,
      scheduleType: "daily",
      fetcherDeps: { http, now: () => Date.now() },
      summarizeFn: stubSummarize,
      nowMs: () => Date.now(),
    });
    assert.equal(result.plannedCount, CASES.length);
    // Every kind contributes at least one item.
    for (const testCase of CASES) {
      assert.ok(
        result.items.some((i) => i.sourceSlug === testCase.slug),
        `expected at least one item from ${testCase.kind} (slug="${testCase.slug}")`,
      );
    }
    // Per-source archive file written for each kind.
    assert.equal(result.archiveWrittenPaths.length, CASES.length);
    assert.deepEqual(result.archiveErrors, []);
  });
});
