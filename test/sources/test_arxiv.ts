import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  arxivFetcher,
  arxivUrl,
  normalizeArxivFeed,
  updateArxivCursor,
  ArxivFetcherError,
  ARXIV_CURSOR_KEY,
  ARXIV_API_BASE,
} from "../../server/workspace/sources/fetchers/arxiv.js";
import type { Source, SourceState } from "../../server/workspace/sources/types.js";
import type { FetcherDeps } from "../../server/workspace/sources/fetchers/index.js";
import { HostRateLimiter, type RateLimiterDeps } from "../../server/workspace/sources/rateLimiter.js";
import { DEFAULT_FETCH_TIMEOUT_MS, type HttpFetcherDeps } from "../../server/workspace/sources/httpFetcher.js";

// --- helpers -------------------------------------------------------------

function makeSource(over: Partial<Source> = {}): Source {
  return {
    slug: "arxiv-cs-cl",
    title: "arXiv cs.CL",
    url: "https://arxiv.org/list/cs.CL/recent",
    fetcherKind: "arxiv",
    fetcherParams: { arxiv_query: "cat:cs.CL" },
    schedule: "daily",
    categories: ["papers", "ai"],
    maxItemsPerFetch: 20,
    addedAt: "2026-04-01T00:00:00Z",
    notes: "",
    ...over,
  };
}

function makeState(over: Partial<SourceState> = {}): SourceState {
  return {
    slug: "arxiv-cs-cl",
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

// --- arxivUrl ------------------------------------------------------------

describe("arxivUrl — canonical URL shape", () => {
  it("sets search_query / sortBy / sortOrder / start / max_results", () => {
    const url = arxivUrl("cat:cs.CL", "submittedDate", "descending", 30);
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, ARXIV_API_BASE);
    assert.equal(parsed.searchParams.get("search_query"), "cat:cs.CL");
    assert.equal(parsed.searchParams.get("sortBy"), "submittedDate");
    assert.equal(parsed.searchParams.get("sortOrder"), "descending");
    assert.equal(parsed.searchParams.get("start"), "0");
    assert.equal(parsed.searchParams.get("max_results"), "30");
  });

  it("URL-encodes exotic query strings", () => {
    const url = arxivUrl('ti:"large language model" AND cat:cs.CL', "submittedDate", "descending", 20);
    // URLSearchParams uses `+` for spaces by default which arXiv
    // accepts; the important thing is no literal space survives.
    assert.doesNotMatch(url, / /);
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("search_query"), 'ti:"large language model" AND cat:cs.CL');
  });
});

describe("arxivUrl — defensive defaults and clamping", () => {
  it("falls back to submittedDate for unknown sort values", () => {
    const url = arxivUrl("cat:cs.CL", "bogusSort", "descending", 20);
    assert.match(url, /sortBy=submittedDate/);
  });

  it("falls back to descending for unknown order values", () => {
    const url = arxivUrl("cat:cs.CL", "submittedDate", "sideways", 20);
    assert.match(url, /sortOrder=descending/);
  });

  it("clamps max_results into [1, 200]", () => {
    assert.match(arxivUrl("q", "submittedDate", "descending", 0), /max_results=1/);
    assert.match(arxivUrl("q", "submittedDate", "descending", 99999), /max_results=200/);
    assert.match(arxivUrl("q", "submittedDate", "descending", 17), /max_results=17/);
  });
});

// --- normalizeArxivFeed -------------------------------------------------

// Minimal fake ParsedFeed to avoid round-tripping real XML in
// every assertion — the XML parsing path is already covered in
// test_rssParser.ts.
function makeFeedItem(
  over: Partial<{
    title: string;
    link: string | null;
    publishedAt: string | null;
    summary: string | null;
    content: string | null;
    feedId: string | null;
  }>,
) {
  return {
    feedId: null,
    title: "a paper",
    link: "https://arxiv.org/abs/2604.12345",
    publishedAt: "2026-04-12T00:00:00Z",
    summary: "short abstract",
    content: null,
    ...over,
  };
}

describe("normalizeArxivFeed — happy path", () => {
  it("emits SourceItems with source categories + stable id from URL", () => {
    const feed = {
      kind: "atom" as const,
      title: "arXiv cs.CL",
      items: [
        makeFeedItem({
          title: "Paper A",
          link: "https://arxiv.org/abs/2604.00001",
        }),
      ],
    };
    const items = normalizeArxivFeed(feed, makeSource(), {});
    assert.equal(items.length, 1);
    assert.equal(items[0].title, "Paper A");
    assert.deepEqual(items[0].categories, ["papers", "ai"]);
    assert.equal(items[0].sourceSlug, "arxiv-cs-cl");
  });

  it("caps output at source.maxItemsPerFetch", () => {
    const feed = {
      kind: "atom" as const,
      title: "t",
      items: Array.from({ length: 50 }, (_, i) =>
        makeFeedItem({
          title: `Paper ${i}`,
          link: `https://arxiv.org/abs/2604.${String(i).padStart(5, "0")}`,
          publishedAt: new Date(Date.UTC(2026, 3, 1 + (i % 28))).toISOString(),
        }),
      ),
    };
    const items = normalizeArxivFeed(feed, makeSource({ maxItemsPerFetch: 10 }), {});
    assert.equal(items.length, 10);
  });

  it("synthesizes publishedAt when the feed omits it", () => {
    const feed = {
      kind: "atom" as const,
      title: "t",
      items: [makeFeedItem({ publishedAt: null })],
    };
    const items = normalizeArxivFeed(feed, makeSource(), {});
    assert.equal(items.length, 1);
    assert.ok(Number.isFinite(Date.parse(items[0].publishedAt)));
  });
});

describe("normalizeArxivFeed — dropping / filtering", () => {
  it("drops items with no link", () => {
    const feed = {
      kind: "atom" as const,
      title: "t",
      items: [makeFeedItem({ link: null })],
    };
    const items = normalizeArxivFeed(feed, makeSource(), {});
    assert.equal(items.length, 0);
  });

  it("drops items with unparseable link", () => {
    const feed = {
      kind: "atom" as const,
      title: "t",
      items: [makeFeedItem({ link: "not a url" })],
    };
    const items = normalizeArxivFeed(feed, makeSource(), {});
    assert.equal(items.length, 0);
  });

  it("drops items at-or-older than the cursor", () => {
    const feed = {
      kind: "atom" as const,
      title: "t",
      items: [
        makeFeedItem({
          title: "old",
          link: "https://arxiv.org/abs/old",
          publishedAt: "2026-04-10T00:00:00Z",
        }),
        makeFeedItem({
          title: "new",
          link: "https://arxiv.org/abs/new",
          publishedAt: "2026-04-12T00:00:00Z",
        }),
      ],
    };
    const cursor = { [ARXIV_CURSOR_KEY]: "2026-04-11T00:00:00Z" };
    const items = normalizeArxivFeed(feed, makeSource(), cursor);
    assert.deepEqual(
      items.map((i) => i.title),
      ["new"],
    );
  });

  it("keeps items with no publishedAt even when cursor set (don't lose undated)", () => {
    const feed = {
      kind: "atom" as const,
      title: "t",
      items: [makeFeedItem({ publishedAt: null })],
    };
    const cursor = { [ARXIV_CURSOR_KEY]: "2026-04-10T00:00:00Z" };
    const items = normalizeArxivFeed(feed, makeSource(), cursor);
    assert.equal(items.length, 1);
  });
});

// --- updateArxivCursor --------------------------------------------------

describe("updateArxivCursor", () => {
  it("advances to newest publishedAt across the batch", () => {
    const feed = {
      kind: "atom" as const,
      title: "t",
      items: [
        makeFeedItem({ publishedAt: "2026-04-10T00:00:00Z" }),
        makeFeedItem({ publishedAt: "2026-04-13T00:00:00Z" }),
        makeFeedItem({ publishedAt: "2026-04-12T00:00:00Z" }),
      ],
    };
    const cursor = updateArxivCursor({}, feed);
    assert.equal(cursor[ARXIV_CURSOR_KEY], "2026-04-13T00:00:00.000Z");
  });

  it("never rolls cursor backwards", () => {
    const feed = {
      kind: "atom" as const,
      title: "t",
      items: [makeFeedItem({ publishedAt: "2026-04-01T00:00:00Z" })],
    };
    const existing = { [ARXIV_CURSOR_KEY]: "2026-04-10T00:00:00Z" };
    const cursor = updateArxivCursor(existing, feed);
    assert.equal(cursor[ARXIV_CURSOR_KEY], "2026-04-10T00:00:00Z");
  });

  it("leaves cursor alone on no-valid-dates batch", () => {
    const feed = {
      kind: "atom" as const,
      title: "t",
      items: [makeFeedItem({ publishedAt: null }), makeFeedItem({ publishedAt: "bogus" })],
    };
    const existing = { [ARXIV_CURSOR_KEY]: "2026-04-10T00:00:00Z" };
    const cursor = updateArxivCursor(existing, feed);
    assert.equal(cursor[ARXIV_CURSOR_KEY], "2026-04-10T00:00:00Z");
  });
});

// --- arxivFetcher.fetch (end-to-end) -------------------------------------

const ATOM_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>arXiv Query</title>
  <entry>
    <title>Scaling laws revisited</title>
    <id>https://arxiv.org/abs/2604.11111</id>
    <link rel="alternate" href="https://arxiv.org/abs/2604.11111" />
    <published>2026-04-12T00:00:00Z</published>
    <summary>Abstract text</summary>
  </entry>
</feed>`;

describe("arxivFetcher.fetch", () => {
  it("builds the correct URL and normalizes items", async () => {
    let capturedUrl = "";
    const fetchImpl: typeof fetch = async (input) => {
      capturedUrl = String(input);
      return new Response(ATOM_BODY, {
        status: 200,
        headers: { "Content-Type": "application/atom+xml" },
      });
    };
    const result = await arxivFetcher.fetch(makeSource(), makeState(), makeFetcherDeps(fetchImpl));
    assert.ok(capturedUrl.startsWith(ARXIV_API_BASE));
    const parsedUrl = new URL(capturedUrl);
    assert.equal(parsedUrl.searchParams.get("search_query"), "cat:cs.CL");
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].title, "Scaling laws revisited");
    assert.equal(result.cursor[ARXIV_CURSOR_KEY], "2026-04-12T00:00:00.000Z");
  });

  it("rejects when arxiv_query is missing", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("should not fetch");
    };
    const source = makeSource({ fetcherParams: {} });
    await assert.rejects(
      () => arxivFetcher.fetch(source, makeState(), makeFetcherDeps(fetchImpl)),
      (err: unknown) => err instanceof ArxivFetcherError && /arxiv_query param is required/.test(err.message),
    );
  });

  it("rejects when arxiv_query is whitespace-only", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("should not fetch");
    };
    const source = makeSource({ fetcherParams: { arxiv_query: "   " } });
    await assert.rejects(() => arxivFetcher.fetch(source, makeState(), makeFetcherDeps(fetchImpl)), ArxivFetcherError);
  });

  it("surfaces non-2xx as ArxivFetcherError", async () => {
    const fetchImpl: typeof fetch = async () => new Response("<error/>", { status: 500 });
    await assert.rejects(
      () => arxivFetcher.fetch(makeSource(), makeState(), makeFetcherDeps(fetchImpl)),
      (err: unknown) => err instanceof ArxivFetcherError && err.status === 500,
    );
  });

  it("rejects when body doesn't parse as a feed", async () => {
    const fetchImpl: typeof fetch = async () => new Response("<html>not a feed</html>", { status: 200 });
    await assert.rejects(() => arxivFetcher.fetch(makeSource(), makeState(), makeFetcherDeps(fetchImpl)), /did not parse as Atom/);
  });

  it("registers itself as the `arxiv` fetcher on import", async () => {
    const { getFetcher } = await import("../../server/workspace/sources/fetchers/index.js");
    const fetcher = getFetcher("arxiv");
    assert.ok(fetcher);
    assert.equal(fetcher.kind, "arxiv");
  });
});
