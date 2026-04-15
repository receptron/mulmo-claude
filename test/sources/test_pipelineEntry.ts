// End-to-end pipeline tests against a mkdtempSync workspace.
// No network; no real claude CLI. Everything stubbed at the
// injection points.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runSourcesPipeline,
  toLocalIsoDate,
} from "../../server/sources/pipeline/index.js";
import type {
  FetcherDeps,
  SourceFetcher,
} from "../../server/sources/fetchers/index.js";
import type {
  FetcherKind,
  Source,
  SourceItem,
} from "../../server/sources/types.js";
import { writeSource } from "../../server/sources/registry.js";
import {
  HostRateLimiter,
  type RateLimiterDeps,
} from "../../server/sources/rateLimiter.js";
import {
  DEFAULT_FETCH_TIMEOUT_MS,
  type HttpFetcherDeps,
} from "../../server/sources/httpFetcher.js";
import { readSourceState } from "../../server/sources/sourceState.js";
import { archivePath, dailyNewsPath } from "../../server/sources/paths.js";

// --- helpers -------------------------------------------------------------

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "pipeline-entry-test-"));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function makeSource(over: Partial<Source> = {}): Source {
  return {
    slug: "hn",
    title: "HN",
    url: "https://news.ycombinator.com/rss",
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

function controllableClock(): RateLimiterDeps {
  const state = { t: 0 };
  return {
    now: () => state.t,
    sleep: (ms) => {
      state.t += ms;
      return Promise.resolve();
    },
  };
}

function makeFetcherDeps(): FetcherDeps {
  const clock = controllableClock();
  return {
    http: {
      fetchImpl: async () => {
        throw new Error("no network expected in these tests");
      },
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

// Fake fetcher that returns prebuilt items per slug.
function fakeFetcher(
  kind: FetcherKind,
  itemsBySlug: Record<string, SourceItem[]>,
): SourceFetcher {
  return {
    kind,
    async fetch(source) {
      const items = itemsBySlug[source.slug] ?? [];
      return { items, cursor: { fake: "cursor-after-" + source.slug } };
    },
  };
}

function makeItem(over: Partial<SourceItem> = {}): SourceItem {
  return {
    id: "item-1",
    title: "An item",
    url: "https://example.com/a",
    publishedAt: "2026-04-13T10:00:00Z",
    categories: ["tech-news"],
    sourceSlug: "hn",
    summary: "short summary",
    ...over,
  };
}

// Fixed clock so the daily file date is deterministic across
// test runs. Local-time-noon of 2026-04-13.
const FIXED_NOW_MS = new Date(
  2026,
  3, // April — 0-indexed
  13,
  12,
  0,
  0,
).getTime();

describe("runSourcesPipeline — happy path", () => {
  it("loads registry, fetches, dedups, summarizes, writes", async () => {
    await writeSource(
      workspace,
      makeSource({ slug: "hn", categories: ["tech-news"] }),
    );
    await writeSource(
      workspace,
      makeSource({
        slug: "reddit",
        url: "https://reddit.com/.rss",
        categories: ["general"],
      }),
    );
    const fetcher = fakeFetcher("rss", {
      hn: [makeItem({ id: "a", title: "HN A" })],
      reddit: [makeItem({ id: "b", title: "Reddit B", sourceSlug: "reddit" })],
    });
    const summaries: SourceItem[][] = [];
    const result = await runSourcesPipeline({
      workspaceRoot: workspace,
      scheduleType: "daily",
      fetcherDeps: makeFetcherDeps(),
      nowMs: () => FIXED_NOW_MS,
      getFetcher: (kind) => (kind === "rss" ? fetcher : null),
      summarizeFn: async (items) => {
        summaries.push([...items]);
        return "# Daily brief\n\n## Tech news\n- HN A\n- Reddit B\n";
      },
    });
    // Both sources planned.
    assert.equal(result.plannedCount, 2);
    // Deduped to 2 unique items.
    assert.equal(result.items.length, 2);
    // Summarize saw those 2 items.
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].length, 2);
    // Daily file exists and contains the JSON block.
    const dailyPath = result.dailyPath;
    assert.equal(
      dailyPath,
      dailyNewsPath(workspace, toLocalIsoDate(FIXED_NOW_MS)),
    );
    const daily = await readFile(dailyPath, "utf-8");
    assert.match(daily, /# Daily brief/);
    assert.match(daily, /```json/);
    const jsonMatch = /```json\n([\s\S]*?)\n```/.exec(daily);
    const parsed = JSON.parse(jsonMatch![1]);
    assert.equal(parsed.itemCount, 2);
    // Archive files created per source.
    assert.equal(result.archiveWrittenPaths.length, 2);
    assert.equal(result.archiveErrors.length, 0);
    const hnArchive = await readFile(
      archivePath(workspace, "hn", "2026-04"),
      "utf-8",
    );
    assert.match(hnArchive, /HN A/);
    const redditArchive = await readFile(
      archivePath(workspace, "reddit", "2026-04"),
      "utf-8",
    );
    assert.match(redditArchive, /Reddit B/);
    // Per-source state persisted with failure count = 0.
    const hnState = await readSourceState(workspace, "hn");
    assert.equal(hnState.consecutiveFailures, 0);
    assert.deepEqual(hnState.cursor, { fake: "cursor-after-hn" });
    assert.ok(hnState.lastFetchedAt);
  });

  it("dedupes items across sources (first-source wins)", async () => {
    await writeSource(workspace, makeSource({ slug: "hn" }));
    await writeSource(
      workspace,
      makeSource({
        slug: "reddit",
        url: "https://reddit.com/.rss",
      }),
    );
    // Both sources carry the same URL → same stableItemId. Only
    // the first-scheduled source's item should survive.
    const shared: SourceItem = makeItem({
      id: "shared-id",
      url: "https://example.com/shared",
      title: "Shared story",
      sourceSlug: "hn",
    });
    const fetcher = fakeFetcher("rss", {
      hn: [shared],
      reddit: [{ ...shared, sourceSlug: "reddit" }],
    });
    const result = await runSourcesPipeline({
      workspaceRoot: workspace,
      scheduleType: "daily",
      fetcherDeps: makeFetcherDeps(),
      nowMs: () => FIXED_NOW_MS,
      getFetcher: () => fetcher,
      summarizeFn: async () => "# brief\n",
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].sourceSlug, "hn"); // hn wins by slug order
    assert.equal(result.dedup.duplicateCount, 1);
  });
});

describe("runSourcesPipeline — empty day", () => {
  it("writes the empty-day daily file when no sources are eligible", async () => {
    // Register an hourly source — daily run skips it.
    await writeSource(
      workspace,
      makeSource({ slug: "hourly-only", schedule: "hourly" }),
    );
    const result = await runSourcesPipeline({
      workspaceRoot: workspace,
      scheduleType: "daily",
      fetcherDeps: makeFetcherDeps(),
      nowMs: () => FIXED_NOW_MS,
      getFetcher: () => fakeFetcher("rss", {}),
      summarizeFn: async () =>
        "# Daily brief — 2026-04-13\n\n_No new items today._\n",
    });
    assert.equal(result.plannedCount, 0);
    assert.equal(result.items.length, 0);
    const raw = await readFile(result.dailyPath, "utf-8");
    assert.match(raw, /No new items today/);
  });

  it("writes the empty-day daily file when everything fetched returns zero items", async () => {
    await writeSource(workspace, makeSource());
    const fetcher = fakeFetcher("rss", { hn: [] });
    const result = await runSourcesPipeline({
      workspaceRoot: workspace,
      scheduleType: "daily",
      fetcherDeps: makeFetcherDeps(),
      nowMs: () => FIXED_NOW_MS,
      getFetcher: () => fetcher,
      summarizeFn: async (items) =>
        items.length === 0 ? "# empty\n" : "# has items\n",
    });
    // Plan had 1 source but fetch returned 0 items → dedup 0.
    assert.equal(result.plannedCount, 1);
    assert.equal(result.items.length, 0);
    const raw = await readFile(result.dailyPath, "utf-8");
    assert.match(raw, /# empty/);
  });
});

describe("runSourcesPipeline — failure isolation (Q8)", () => {
  it("a failing source doesn't abort the run; state tracks the failure", async () => {
    await writeSource(workspace, makeSource({ slug: "ok" }));
    await writeSource(
      workspace,
      makeSource({
        slug: "broken",
        url: "https://broken.example/",
      }),
    );
    const fetcher: SourceFetcher = {
      kind: "rss",
      async fetch(source) {
        if (source.slug === "broken") {
          throw new Error("boom");
        }
        return {
          items: [makeItem({ id: "ok-1", sourceSlug: "ok" })],
          cursor: {},
        };
      },
    };
    const result = await runSourcesPipeline({
      workspaceRoot: workspace,
      scheduleType: "daily",
      fetcherDeps: makeFetcherDeps(),
      nowMs: () => FIXED_NOW_MS,
      getFetcher: () => fetcher,
      summarizeFn: async () => "# brief\n",
    });
    // Ok source emitted its item.
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].sourceSlug, "ok");
    // Broken source recorded error outcome + advanced failure counter.
    const brokenState = await readSourceState(workspace, "broken");
    assert.equal(brokenState.consecutiveFailures, 1);
    assert.ok(brokenState.nextAttemptAt); // backoff scheduled
    // Ok source state clean.
    const okState = await readSourceState(workspace, "ok");
    assert.equal(okState.consecutiveFailures, 0);
    assert.equal(okState.nextAttemptAt, null);
  });

  it("success after a failure resets the failure counter", async () => {
    await writeSource(workspace, makeSource());
    // Seed state: 3 consecutive failures on the way out.
    const { writeSourceState } =
      await import("../../server/sources/sourceState.js");
    await writeSourceState(workspace, {
      slug: "hn",
      lastFetchedAt: null,
      cursor: {},
      consecutiveFailures: 3,
      // A full day in the past of FIXED_NOW_MS regardless of
      // local timezone, so the plan phase doesn't filter this
      // source out for still being in backoff.
      nextAttemptAt: "2026-04-12T00:00:00Z",
    });
    const fetcher = fakeFetcher("rss", {
      hn: [makeItem({ id: "recovered" })],
    });
    const result = await runSourcesPipeline({
      workspaceRoot: workspace,
      scheduleType: "daily",
      fetcherDeps: makeFetcherDeps(),
      nowMs: () => FIXED_NOW_MS,
      getFetcher: () => fetcher,
      summarizeFn: async () => "# brief\n",
    });
    assert.equal(result.items.length, 1);
    const state = await readSourceState(workspace, "hn");
    assert.equal(state.consecutiveFailures, 0);
    assert.equal(state.nextAttemptAt, null);
  });
});

describe("runSourcesPipeline — schedule filtering", () => {
  it("only runs sources whose schedule matches scheduleType", async () => {
    await writeSource(
      workspace,
      makeSource({ slug: "daily-1", schedule: "daily" }),
    );
    await writeSource(
      workspace,
      makeSource({ slug: "hourly-1", schedule: "hourly" }),
    );
    await writeSource(
      workspace,
      makeSource({
        slug: "on-demand-1",
        schedule: "on-demand",
        url: "https://ondemand.example/",
      }),
    );
    const fetcher = fakeFetcher("rss", {
      "daily-1": [makeItem({ id: "d1", sourceSlug: "daily-1" })],
      "hourly-1": [makeItem({ id: "h1", sourceSlug: "hourly-1" })],
      "on-demand-1": [makeItem({ id: "od1", sourceSlug: "on-demand-1" })],
    });
    const result = await runSourcesPipeline({
      workspaceRoot: workspace,
      scheduleType: "daily",
      fetcherDeps: makeFetcherDeps(),
      nowMs: () => FIXED_NOW_MS,
      getFetcher: () => fetcher,
      summarizeFn: async () => "# brief\n",
    });
    // Only daily-1 should emit. hourly-1 skipped (not daily),
    // on-demand-1 skipped (never auto-picks).
    assert.equal(result.plannedCount, 1);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].sourceSlug, "daily-1");
  });
});

describe("toLocalIsoDate", () => {
  it("formats local YYYY-MM-DD with zero-padded components", () => {
    // January 1st local midnight — ensures zero-padding on both
    // month and day.
    const ms = new Date(2026, 0, 1, 0, 0, 0).getTime();
    assert.equal(toLocalIsoDate(ms), "2026-01-01");
  });

  it("keeps local time even when UTC would roll over", () => {
    // 23:00 local on 2026-04-13 is still 2026-04-13 regardless
    // of which way the UTC offset slides.
    const ms = new Date(2026, 3, 13, 23, 0, 0).getTime();
    assert.equal(toLocalIsoDate(ms), "2026-04-13");
  });
});
