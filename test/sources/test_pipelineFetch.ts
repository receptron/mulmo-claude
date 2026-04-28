import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  runFetchPhase,
  computeNextState,
  backoffDelayMs,
  emptyBackoffDelayMs,
  BACKOFF_MAX_MS,
  EMPTY_FETCH_THRESHOLD,
  EMPTY_BACKOFF_MAX_MS,
} from "../../server/workspace/sources/pipeline/fetch.js";
import type { FetcherDeps, FetchResult, SourceFetcher } from "../../server/workspace/sources/fetchers/index.js";
import type { FetcherKind, Source, SourceState } from "../../server/workspace/sources/types.js";
import { HostRateLimiter, type RateLimiterDeps } from "../../server/workspace/sources/rateLimiter.js";
import { DEFAULT_FETCH_TIMEOUT_MS, type HttpFetcherDeps } from "../../server/workspace/sources/httpFetcher.js";

// --- helpers -------------------------------------------------------------

function makeSource(over: Partial<Source> = {}): Source {
  return {
    slug: "s",
    title: "t",
    url: "https://x.com",
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

function makeState(over: Partial<SourceState> = {}): SourceState {
  return {
    slug: "s",
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

function makeDeps(): FetcherDeps {
  const clock = controllableClock();
  return {
    http: {
      fetchImpl: async () => {
        throw new Error("no http expected in these tests");
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

// Fake fetcher factory — returns a SourceFetcher whose `fetch`
// implementation is whatever you pass in. Keeps tests free of
// actual HTTP plumbing.
function fakeFetcher(kind: FetcherKind, impl: (source: Source, state: SourceState) => Promise<FetchResult>): SourceFetcher {
  return {
    kind,
    async fetch(source, state) {
      return impl(source, state);
    },
  };
}

// Build a `getFetcher` lookup for a set of fakes.
function makeGetFetcher(fetchers: SourceFetcher[]): (kind: FetcherKind) => SourceFetcher | null {
  const byKind = new Map<FetcherKind, SourceFetcher>();
  for (const fetcher of fetchers) byKind.set(fetcher.kind, fetcher);
  return (kind) => byKind.get(kind) ?? null;
}

// --- runFetchPhase -------------------------------------------------------

describe("runFetchPhase — success path", () => {
  it("calls the registered fetcher for each source", async () => {
    const callLog: string[] = [];
    const fetcher = fakeFetcher("rss", async (source) => {
      callLog.push(source.slug);
      return { items: [], cursor: { seen: source.slug } };
    });
    const result = await runFetchPhase({
      sources: [makeSource({ slug: "a" }), makeSource({ slug: "b" })],
      statesBySlug: new Map(),
      deps: makeDeps(),
      getFetcher: makeGetFetcher([fetcher]),
    });
    assert.deepEqual(callLog.sort(), ["a", "b"]);
    assert.equal(result.outcomes.length, 2);
    for (const outcome of result.outcomes) {
      assert.equal(outcome.kind, "success");
    }
  });

  it("passes the per-source state to the fetcher", async () => {
    let receivedCursor: Record<string, string> | null = null;
    const fetcher = fakeFetcher("rss", async (_source, state) => {
      receivedCursor = state.cursor;
      return { items: [], cursor: { updated: "yes" } };
    });
    await runFetchPhase({
      sources: [makeSource({ slug: "a" })],
      statesBySlug: new Map([["a", makeState({ slug: "a", cursor: { old: "cursor" } })]]),
      deps: makeDeps(),
      getFetcher: makeGetFetcher([fetcher]),
    });
    assert.deepEqual(receivedCursor, { old: "cursor" });
  });

  it("supplies a default state when none is present", async () => {
    // See test_classifier.ts — array capture avoids the TS narrowing
    // bug where a `let` reassigned inside an async callback becomes
    // `never` at the outer scope.
    const captured: SourceState[] = [];
    const fetcher = fakeFetcher("rss", async (_source, state) => {
      captured.push(state);
      return { items: [], cursor: {} };
    });
    await runFetchPhase({
      sources: [makeSource({ slug: "fresh" })],
      statesBySlug: new Map(),
      deps: makeDeps(),
      getFetcher: makeGetFetcher([fetcher]),
    });
    assert.equal(captured.length, 1);
    assert.equal(captured[0].slug, "fresh");
    assert.deepEqual(captured[0].cursor, {});
    assert.equal(captured[0].consecutiveFailures, 0);
  });
});

describe("runFetchPhase — failure isolation (Q8)", () => {
  it("one error doesn't abort the rest of the sources", async () => {
    const fetcher = fakeFetcher("rss", async (source) => {
      if (source.slug === "broken") throw new Error("bang");
      return { items: [], cursor: {} };
    });
    const result = await runFetchPhase({
      sources: [makeSource({ slug: "ok-a" }), makeSource({ slug: "broken" }), makeSource({ slug: "ok-b" })],
      statesBySlug: new Map(),
      deps: makeDeps(),
      getFetcher: makeGetFetcher([fetcher]),
    });
    const kinds = new Map(result.outcomes.map((outcome) => [outcome.sourceSlug, outcome.kind]));
    assert.equal(kinds.get("ok-a"), "success");
    assert.equal(kinds.get("broken"), "error");
    assert.equal(kinds.get("ok-b"), "success");
  });

  it("reports `no-fetcher` when the fetcherKind has no registered handler", async () => {
    const result = await runFetchPhase({
      sources: [
        makeSource({
          slug: "web",
          fetcherKind: "web-fetch",
        }),
      ],
      statesBySlug: new Map(),
      deps: makeDeps(),
      getFetcher: makeGetFetcher([]), // empty registry
    });
    assert.equal(result.outcomes.length, 1);
    assert.equal(result.outcomes[0].kind, "no-fetcher");
    if (result.outcomes[0].kind === "no-fetcher") {
      assert.match(result.outcomes[0].error, /no fetcher registered for kind "web-fetch"/);
    }
  });

  it("converts non-Error throws to string error messages", async () => {
    const fetcher = fakeFetcher("rss", async () => {
      // eslint-disable-next-line no-throw-literal -- intentional non-Error throw, asserting runFetchPhase converts unknown rejections to string messages
      throw "string error";
    });
    const result = await runFetchPhase({
      sources: [makeSource()],
      statesBySlug: new Map(),
      deps: makeDeps(),
      getFetcher: makeGetFetcher([fetcher]),
    });
    assert.equal(result.outcomes[0].kind, "error");
    if (result.outcomes[0].kind === "error") {
      assert.equal(result.outcomes[0].error, "string error");
    }
  });
});

// --- backoffDelayMs / computeNextState ---------------------------------

describe("backoffDelayMs — exponential curve bounded at 24h", () => {
  it("returns 0 for 0 failures (never retried yet)", () => {
    assert.equal(backoffDelayMs(0), 0);
    assert.equal(backoffDelayMs(-1), 0);
  });

  it("starts at 1 minute and doubles each failure", () => {
    assert.equal(backoffDelayMs(1), 60_000);
    assert.equal(backoffDelayMs(2), 120_000);
    assert.equal(backoffDelayMs(3), 240_000);
    assert.equal(backoffDelayMs(4), 480_000);
  });

  it("caps at 24 hours no matter how many failures", () => {
    assert.equal(backoffDelayMs(100), BACKOFF_MAX_MS);
    assert.equal(backoffDelayMs(30), BACKOFF_MAX_MS);
  });
});

describe("computeNextState — on success", () => {
  const now = Date.parse("2026-04-13T10:00:00Z");

  it("resets failure tracking and records lastFetchedAt", () => {
    const prev = makeState({
      slug: "s",
      consecutiveFailures: 3,
      nextAttemptAt: "2026-04-13T12:00:00Z",
      cursor: { old: "v" },
    });
    const outcome = {
      kind: "success" as const,
      sourceSlug: "s",
      items: [],
      cursor: { new: "v" },
    };
    const next = computeNextState(prev, outcome, now);
    assert.equal(next.consecutiveFailures, 0);
    assert.equal(next.nextAttemptAt, null);
    assert.equal(next.lastFetchedAt, "2026-04-13T10:00:00.000Z");
    assert.deepEqual(next.cursor, { new: "v" });
  });
});

describe("computeNextState — on failure", () => {
  const now = Date.parse("2026-04-13T10:00:00Z");

  it("increments consecutiveFailures and schedules nextAttempt via backoff", () => {
    const prev = makeState({ slug: "s", consecutiveFailures: 0 });
    const outcome = {
      kind: "error" as const,
      sourceSlug: "s",
      error: "boom",
    };
    const next = computeNextState(prev, outcome, now);
    assert.equal(next.consecutiveFailures, 1);
    assert.ok(next.nextAttemptAt);
    // 1 minute after now.
    assert.equal(next.nextAttemptAt, new Date(now + 60_000).toISOString());
  });

  it("keeps prior lastFetchedAt and cursor on failure", () => {
    const prev = makeState({
      slug: "s",
      lastFetchedAt: "2026-04-12T10:00:00Z",
      cursor: { old: "v" },
      consecutiveFailures: 2,
    });
    const outcome = {
      kind: "no-fetcher" as const,
      sourceSlug: "s",
      error: "no fetcher",
    };
    const next = computeNextState(prev, outcome, now);
    assert.equal(next.consecutiveFailures, 3);
    assert.equal(next.lastFetchedAt, "2026-04-12T10:00:00Z"); // unchanged
    assert.deepEqual(next.cursor, { old: "v" }); // unchanged
  });

  it("caps the backoff timer at BACKOFF_MAX_MS", () => {
    const prev = makeState({ slug: "s", consecutiveFailures: 99 });
    const outcome = {
      kind: "error" as const,
      sourceSlug: "s",
      error: "boom",
    };
    const next = computeNextState(prev, outcome, now);
    const gap = Date.parse(next.nextAttemptAt!) - now;
    assert.equal(gap, BACKOFF_MAX_MS);
  });

  it("preserves consecutiveEmptyFetches on failure", () => {
    const prev = makeState({ slug: "s", consecutiveEmptyFetches: 2 });
    const outcome = { kind: "error" as const, sourceSlug: "s", error: "boom" };
    const next = computeNextState(prev, outcome, now);
    assert.equal(next.consecutiveEmptyFetches, 2);
  });
});

describe("emptyBackoffDelayMs — adaptive empty-fetch backoff", () => {
  it("returns 0 below the threshold", () => {
    assert.equal(emptyBackoffDelayMs(0), 0);
    assert.equal(emptyBackoffDelayMs(EMPTY_FETCH_THRESHOLD - 1), 0);
  });

  it("returns 1h at the threshold", () => {
    assert.equal(emptyBackoffDelayMs(EMPTY_FETCH_THRESHOLD), 3_600_000);
  });

  it("doubles each step beyond the threshold", () => {
    assert.equal(emptyBackoffDelayMs(EMPTY_FETCH_THRESHOLD + 1), 7_200_000);
    assert.equal(emptyBackoffDelayMs(EMPTY_FETCH_THRESHOLD + 2), 14_400_000);
  });

  it("caps at EMPTY_BACKOFF_MAX_MS", () => {
    assert.equal(emptyBackoffDelayMs(EMPTY_FETCH_THRESHOLD + 100), EMPTY_BACKOFF_MAX_MS);
  });
});

describe("computeNextState — empty-success adaptive backoff", () => {
  const now = Date.parse("2026-04-13T10:00:00Z");

  it("increments consecutiveEmptyFetches when items array is empty", () => {
    const prev = makeState({ slug: "s", consecutiveEmptyFetches: 0 });
    const outcome = { kind: "success" as const, sourceSlug: "s", items: [], cursor: {} };
    const next = computeNextState(prev, outcome, now);
    assert.equal(next.consecutiveEmptyFetches, 1);
    assert.equal(next.emptyBackoffUntil, null); // below threshold
  });

  it("sets emptyBackoffUntil once threshold is reached", () => {
    const prev = makeState({ slug: "s", consecutiveEmptyFetches: EMPTY_FETCH_THRESHOLD - 1 });
    const outcome = { kind: "success" as const, sourceSlug: "s", items: [], cursor: {} };
    const next = computeNextState(prev, outcome, now);
    assert.equal(next.consecutiveEmptyFetches, EMPTY_FETCH_THRESHOLD);
    assert.ok(next.emptyBackoffUntil, "emptyBackoffUntil should be set at threshold");
    const gap = Date.parse(next.emptyBackoffUntil!) - now;
    assert.equal(gap, 3_600_000); // 1h
  });

  it("resets empty counters when items are found", () => {
    const fakeItem = {
      id: "x",
      title: "t",
      url: "https://x.com",
      publishedAt: new Date(now).toISOString(),
      categories: [] as import("../../server/workspace/sources/taxonomy.js").CategorySlug[],
      sourceSlug: "s",
    };
    const prev = makeState({ slug: "s", consecutiveEmptyFetches: 5, emptyBackoffUntil: "2026-04-14T10:00:00Z" });
    const outcome = { kind: "success" as const, sourceSlug: "s", items: [fakeItem], cursor: {} };
    const next = computeNextState(prev, outcome, now);
    assert.equal(next.consecutiveEmptyFetches, 0);
    assert.equal(next.emptyBackoffUntil, null);
  });
});
