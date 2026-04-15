import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  rssFetcher,
  normalizeToSourceItems,
  updateCursor,
  RSS_CURSOR_KEY,
  RssFetcherError,
} from "../../server/sources/fetchers/rss.js";
import type { Source, SourceState } from "../../server/sources/types.js";
import type { FetcherDeps } from "../../server/sources/fetchers/index.js";
import {
  HostRateLimiter,
  type RateLimiterDeps,
} from "../../server/sources/rateLimiter.js";
import {
  DEFAULT_FETCH_TIMEOUT_MS,
  type HttpFetcherDeps,
  type RobotsProvider,
} from "../../server/sources/httpFetcher.js";
import type { ParsedFeed } from "../../server/sources/fetchers/rssParser.js";

// --- helpers -------------------------------------------------------------

function makeSource(over: Partial<Source> = {}): Source {
  return {
    slug: "test-feed",
    title: "Test Feed",
    url: "https://example.com/feed.xml",
    fetcherKind: "rss",
    fetcherParams: {},
    schedule: "daily",
    categories: ["tech-news", "general"],
    maxItemsPerFetch: 30,
    addedAt: "2026-04-01T00:00:00Z",
    notes: "",
    ...over,
  };
}

function makeState(over: Partial<SourceState> = {}): SourceState {
  return {
    slug: "test-feed",
    lastFetchedAt: null,
    cursor: {},
    consecutiveFailures: 0,
    nextAttemptAt: null,
    ...over,
  };
}

function makeFeed(
  items: Array<{
    title: string;
    link: string | null;
    publishedAt?: string | null;
    summary?: string | null;
    content?: string | null;
    feedId?: string | null;
  }>,
): ParsedFeed {
  return {
    kind: "rss",
    title: "Test",
    items: items.map((i) => ({
      feedId: i.feedId ?? null,
      title: i.title,
      link: i.link,
      publishedAt: i.publishedAt ?? null,
      summary: i.summary ?? null,
      content: i.content ?? null,
    })),
  };
}

// --- normalizeToSourceItems ---------------------------------------------

describe("normalizeToSourceItems — basic", () => {
  it("converts ParsedFeed items into SourceItems with categories", () => {
    const feed = makeFeed([
      {
        title: "One",
        link: "https://example.com/1",
        publishedAt: "2026-04-02T12:00:00Z",
        summary: "s1",
      },
    ]);
    const source = makeSource();
    const items = normalizeToSourceItems(feed, source, {}, 30);
    assert.equal(items.length, 1);
    assert.equal(items[0].title, "One");
    assert.equal(items[0].url, "https://example.com/1");
    assert.deepEqual(items[0].categories, ["tech-news", "general"]);
    assert.equal(items[0].sourceSlug, "test-feed");
    assert.equal(items[0].summary, "s1");
  });

  it("computes a stableItemId from the normalized URL, not the feedId", () => {
    // Two items with different feedIds but the same canonical URL
    // (e.g. utm stripped) should share an id.
    const feed = makeFeed([
      {
        title: "A",
        link: "https://example.com/1?utm_source=hn",
        feedId: "id-1",
        publishedAt: "2026-04-02T12:00:00Z",
      },
      {
        title: "B",
        link: "https://example.com/1?utm_source=twitter",
        feedId: "id-2",
        publishedAt: "2026-04-02T13:00:00Z",
      },
    ]);
    const source = makeSource();
    const items = normalizeToSourceItems(feed, source, {}, 30);
    assert.equal(items.length, 2);
    // Normalized URL strips utm_*, so both items hash to the same id.
    assert.equal(items[0].id, items[1].id);
    assert.equal(items[0].url, items[1].url);
  });

  it("drops items with no link", () => {
    const feed = makeFeed([
      { title: "no link", link: null },
      {
        title: "has link",
        link: "https://example.com/1",
        publishedAt: "2026-04-02T12:00:00Z",
      },
    ]);
    const items = normalizeToSourceItems(feed, makeSource(), {}, 30);
    assert.equal(items.length, 1);
    assert.equal(items[0].title, "has link");
  });

  it("drops items with an unparseable link", () => {
    const feed = makeFeed([
      { title: "bad", link: "not a url" },
      { title: "good", link: "https://example.com/1" },
    ]);
    const items = normalizeToSourceItems(feed, makeSource(), {}, 30);
    assert.equal(items.length, 1);
    assert.equal(items[0].title, "good");
  });

  it("caps output to maxItemsPerFetch", () => {
    const feed = makeFeed(
      Array.from({ length: 50 }, (_, i) => ({
        title: `item${i}`,
        link: `https://example.com/${i}`,
        publishedAt: new Date(Date.UTC(2026, 3, i + 1)).toISOString(),
      })),
    );
    const items = normalizeToSourceItems(feed, makeSource(), {}, 10);
    assert.equal(items.length, 10);
  });

  it("synthesizes a fetch-time publishedAt when the feed omits one", () => {
    const feed = makeFeed([
      { title: "no date", link: "https://example.com/1", publishedAt: null },
    ]);
    const items = normalizeToSourceItems(feed, makeSource(), {}, 30);
    assert.equal(items.length, 1);
    // Must be a valid ISO timestamp.
    assert.ok(Number.isFinite(Date.parse(items[0].publishedAt)));
  });
});

describe("normalizeToSourceItems — cursor filtering", () => {
  it("drops items at or older than the cursor timestamp", () => {
    const feed = makeFeed([
      {
        title: "old",
        link: "https://example.com/old",
        publishedAt: "2026-04-01T00:00:00Z",
      },
      {
        title: "equal",
        link: "https://example.com/equal",
        publishedAt: "2026-04-02T00:00:00Z",
      },
      {
        title: "new",
        link: "https://example.com/new",
        publishedAt: "2026-04-03T00:00:00Z",
      },
    ]);
    const cursor = { [RSS_CURSOR_KEY]: "2026-04-02T00:00:00Z" };
    const items = normalizeToSourceItems(feed, makeSource(), cursor, 30);
    assert.deepEqual(
      items.map((i) => i.title),
      ["new"],
    );
  });

  it("keeps items with no publishedAt even when cursor is set", () => {
    // Don't lose items forever just because the feed omitted a date.
    const feed = makeFeed([
      { title: "no date", link: "https://example.com/1", publishedAt: null },
    ]);
    const cursor = { [RSS_CURSOR_KEY]: "2026-04-01T00:00:00Z" };
    const items = normalizeToSourceItems(feed, makeSource(), cursor, 30);
    assert.equal(items.length, 1);
  });

  it("treats a malformed cursor timestamp as no cursor (everything passes)", () => {
    const feed = makeFeed([
      {
        title: "one",
        link: "https://example.com/1",
        publishedAt: "2026-04-01T00:00:00Z",
      },
    ]);
    const cursor = { [RSS_CURSOR_KEY]: "not-a-date" };
    const items = normalizeToSourceItems(feed, makeSource(), cursor, 30);
    assert.equal(items.length, 1);
  });

  it("passes everything when cursor is empty", () => {
    const feed = makeFeed([
      {
        title: "one",
        link: "https://example.com/1",
        publishedAt: "2026-04-01T00:00:00Z",
      },
      {
        title: "two",
        link: "https://example.com/2",
        publishedAt: "2026-04-02T00:00:00Z",
      },
    ]);
    const items = normalizeToSourceItems(feed, makeSource(), {}, 30);
    assert.equal(items.length, 2);
  });
});

// --- updateCursor --------------------------------------------------------

describe("updateCursor", () => {
  it("advances to the newest publishedAt across all items", () => {
    const feed = makeFeed([
      { title: "a", link: "x", publishedAt: "2026-04-01T00:00:00Z" },
      { title: "b", link: "x", publishedAt: "2026-04-03T00:00:00Z" },
      { title: "c", link: "x", publishedAt: "2026-04-02T00:00:00Z" },
    ]);
    const cursor = updateCursor({}, feed);
    assert.equal(cursor[RSS_CURSOR_KEY], "2026-04-03T00:00:00.000Z");
  });

  it("considers filtered-out items too, preventing infinite re-emission", () => {
    // Even if `normalizeToSourceItems` emitted nothing (all
    // items were already seen), the cursor should advance to
    // the newest observed timestamp so we don't re-check.
    const feed = makeFeed([
      { title: "a", link: "x", publishedAt: "2026-04-01T00:00:00Z" },
    ]);
    const cursor = updateCursor(
      { [RSS_CURSOR_KEY]: "2026-03-15T00:00:00Z" },
      feed,
    );
    assert.equal(cursor[RSS_CURSOR_KEY], "2026-04-01T00:00:00.000Z");
  });

  it("leaves an already-newer cursor alone", () => {
    const feed = makeFeed([
      { title: "old", link: "x", publishedAt: "2026-04-01T00:00:00Z" },
    ]);
    const existing = { [RSS_CURSOR_KEY]: "2026-04-10T00:00:00Z" };
    const cursor = updateCursor(existing, feed);
    // Must not roll backwards even if the feed republished older items.
    assert.equal(cursor[RSS_CURSOR_KEY], "2026-04-10T00:00:00Z");
  });

  it("returns the unchanged cursor when no items carry a date", () => {
    const feed = makeFeed([
      { title: "a", link: "x", publishedAt: null },
      { title: "b", link: "x", publishedAt: null },
    ]);
    const existing = { [RSS_CURSOR_KEY]: "2026-04-01T00:00:00Z" };
    const cursor = updateCursor(existing, feed);
    assert.equal(cursor[RSS_CURSOR_KEY], "2026-04-01T00:00:00Z");
  });

  it("preserves unrelated cursor keys", () => {
    const feed = makeFeed([
      { title: "a", link: "x", publishedAt: "2026-04-03T00:00:00Z" },
    ]);
    const existing = { [RSS_CURSOR_KEY]: "2026-04-01T00:00:00Z", etag: "abc" };
    const cursor = updateCursor(existing, feed);
    assert.equal(cursor.etag, "abc");
    assert.equal(cursor[RSS_CURSOR_KEY], "2026-04-03T00:00:00.000Z");
  });
});

// --- rssFetcher.fetch (end-to-end with stubbed HTTP) --------------------

function controllableClock(start = 0): {
  deps: RateLimiterDeps;
  tick: (ms: number) => void;
} {
  const state = { t: start };
  return {
    deps: {
      now: () => state.t,
      sleep: (ms) => {
        state.t += ms;
        return Promise.resolve();
      },
    },
    tick: (ms) => {
      state.t += ms;
    },
  };
}

function makeFetcherDeps(
  fetchImpl: typeof fetch,
  robots: RobotsProvider = async () => null,
): FetcherDeps {
  const clock = controllableClock();
  return {
    http: {
      fetchImpl,
      robots,
      rateLimiter: new HostRateLimiter(clock.deps),
      rateLimiterDeps: clock.deps,
      crawlDelayMs: () => 0,
      timeoutMs: DEFAULT_FETCH_TIMEOUT_MS,
      onWillFetch: () => {},
    } as HttpFetcherDeps,
    now: () => Date.now(),
  };
}

const RSS_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Example</title>
    <item>
      <title>Hello</title>
      <link>https://example.com/1</link>
      <pubDate>Wed, 01 Apr 2026 12:00:00 GMT</pubDate>
      <description>greeting</description>
    </item>
  </channel>
</rss>`;

describe("rssFetcher.fetch", () => {
  it("fetches, parses, and returns a SourceItem + updated cursor", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(RSS_BODY, { status: 200 });
    const source = makeSource();
    const state = makeState();
    const result = await rssFetcher.fetch(
      source,
      state,
      makeFetcherDeps(fetchImpl),
    );
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].title, "Hello");
    assert.equal(result.items[0].url, "https://example.com/1");
    assert.equal(result.cursor[RSS_CURSOR_KEY], "2026-04-01T12:00:00.000Z");
  });

  it("respects the cursor across successive fetches", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(RSS_BODY, { status: 200 });
    const deps = makeFetcherDeps(fetchImpl);
    const source = makeSource();
    // First call: no cursor, emit the one item.
    const first = await rssFetcher.fetch(source, makeState(), deps);
    assert.equal(first.items.length, 1);
    // Second call: cursor advanced, same body returns no new items.
    const second = await rssFetcher.fetch(
      source,
      makeState({ cursor: first.cursor }),
      deps,
    );
    assert.equal(second.items.length, 0);
  });

  it("throws RssFetcherError on non-2xx response", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("not found", { status: 404 });
    await assert.rejects(
      () =>
        rssFetcher.fetch(makeSource(), makeState(), makeFetcherDeps(fetchImpl)),
      (err: unknown) => err instanceof RssFetcherError && err.status === 404,
    );
  });

  it("throws RssFetcherError when the body is not parseable as a feed", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("<html>not a feed</html>", { status: 200 });
    await assert.rejects(
      () =>
        rssFetcher.fetch(makeSource(), makeState(), makeFetcherDeps(fetchImpl)),
      /did not parse as RSS/,
    );
  });

  it("propagates RobotsDisallowedError via fetchPolite", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(RSS_BODY, { status: 200 });
    const robots: RobotsProvider = async () =>
      "User-agent: *\nDisallow: /feed.xml\n";
    await assert.rejects(
      () =>
        rssFetcher.fetch(
          makeSource(),
          makeState(),
          makeFetcherDeps(fetchImpl, robots),
        ),
      /robots.txt disallows/,
    );
  });

  it("registers itself as the `rss` fetcher on import", async () => {
    const { getFetcher } =
      await import("../../server/sources/fetchers/index.js");
    const fetcher = getFetcher("rss");
    assert.ok(fetcher);
    assert.equal(fetcher!.kind, "rss");
  });
});
