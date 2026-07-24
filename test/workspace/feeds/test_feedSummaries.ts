// The feeds-index projection shared by GET /api/feeds and the remote-host
// `listFeeds` command. `readFeedState` is stubbed, so these pin the defaults
// and the row shape without a workspace on disk.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildFeedSummaries, type FeedSummarySource, type ReadFeedLastFetched } from "../../../server/workspace/feeds/summaries.js";

const WORKSPACE_ROOT = "/tmp/does-not-exist";

const feedNamed = (slug: string, ingest?: { kind?: string; schedule?: string }): FeedSummarySource => ({
  slug,
  source: "feed",
  schema: { title: `${slug} title`, icon: "rss_feed", ...(ingest ? { ingest } : {}) },
});

/** Stub reader: `lastFetchedAt` per slug, defaulting to null (never fetched). */
const readerReturning =
  (byslug: Record<string, string | null> = {}): ReadFeedLastFetched =>
  async (_root, feed) => ({ lastFetchedAt: byslug[feed.slug] ?? null });

describe("buildFeedSummaries", () => {
  it("falls back to rss / on-demand when the feed declares no ingest block", async () => {
    const summaries = await buildFeedSummaries([feedNamed("news")], readerReturning({ news: "2026-07-22T09:00:00Z" }), WORKSPACE_ROOT);

    assert.deepEqual(summaries, [
      {
        slug: "news",
        title: "news title",
        icon: "rss_feed",
        kind: "rss",
        schedule: "on-demand",
        lastFetchedAt: "2026-07-22T09:00:00Z",
      },
    ]);
  });

  it("keeps a declared kind and still defaults the missing schedule", async () => {
    const summaries = await buildFeedSummaries([feedNamed("blog", { kind: "atom" })], readerReturning(), WORKSPACE_ROOT);

    assert.equal(summaries[0].kind, "atom");
    assert.equal(summaries[0].schedule, "on-demand");
  });

  it("keeps a declared schedule and still defaults the missing kind", async () => {
    const summaries = await buildFeedSummaries([feedNamed("hourly-feed", { schedule: "hourly" })], readerReturning(), WORKSPACE_ROOT);

    assert.equal(summaries[0].kind, "rss");
    assert.equal(summaries[0].schedule, "hourly");
  });

  it("carries both through when the ingest block is complete", async () => {
    const summaries = await buildFeedSummaries([feedNamed("papers", { kind: "http-json", schedule: "daily" })], readerReturning(), WORKSPACE_ROOT);

    assert.equal(summaries[0].kind, "http-json");
    assert.equal(summaries[0].schedule, "daily");
  });

  it("reports lastFetchedAt as null for a feed that was never fetched", async () => {
    const summaries = await buildFeedSummaries([feedNamed("fresh")], readerReturning(), WORKSPACE_ROOT);

    assert.equal(summaries[0].lastFetchedAt, null);
  });

  it("returns an empty list for zero feeds without calling the reader", async () => {
    let reads = 0;
    const reader: ReadFeedLastFetched = async () => {
      reads += 1;
      return { lastFetchedAt: null };
    };

    assert.deepEqual(await buildFeedSummaries([], reader, WORKSPACE_ROOT), []);
    assert.equal(reads, 0);
  });

  it("preserves registry order across multiple feeds", async () => {
    const feeds = [feedNamed("gamma"), feedNamed("alpha", { kind: "atom", schedule: "weekly" }), feedNamed("beta")];

    const summaries = await buildFeedSummaries(feeds, readerReturning({ alpha: "2026-01-01T00:00:00Z" }), WORKSPACE_ROOT);

    assert.deepEqual(
      summaries.map((summary) => summary.slug),
      ["gamma", "alpha", "beta"],
    );
    assert.deepEqual(
      summaries.map((summary) => summary.lastFetchedAt),
      [null, "2026-01-01T00:00:00Z", null],
    );
  });

  it("passes the injected workspace root and the feed itself to the reader", async () => {
    const seen: { root: string; slug: string; source: string }[] = [];
    const reader: ReadFeedLastFetched = async (root, feed) => {
      seen.push({ root, slug: feed.slug, source: feed.source });
      return { lastFetchedAt: null };
    };

    await buildFeedSummaries([feedNamed("news")], reader, "/workspaces/demo");

    assert.deepEqual(seen, [{ root: "/workspaces/demo", slug: "news", source: "feed" }]);
  });
});
