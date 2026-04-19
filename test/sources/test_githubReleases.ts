import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  githubReleasesFetcher,
  parseGithubRelease,
  releaseToSourceItem,
  updateReleasesCursor,
  processReleasesResponse,
  firstParagraph,
  RELEASES_CURSOR_KEY,
} from "../../server/workspace/sources/fetchers/githubReleases.js";
import { GithubFetcherError } from "../../server/workspace/sources/fetchers/github.js";
import type {
  Source,
  SourceState,
} from "../../server/workspace/sources/types.js";
import type { FetcherDeps } from "../../server/workspace/sources/fetchers/index.js";
import {
  HostRateLimiter,
  type RateLimiterDeps,
} from "../../server/workspace/sources/rateLimiter.js";
import {
  DEFAULT_FETCH_TIMEOUT_MS,
  type HttpFetcherDeps,
} from "../../server/workspace/sources/httpFetcher.js";

// --- helpers -------------------------------------------------------------

function makeSource(over: Partial<Source> = {}): Source {
  return {
    slug: "anthropic-releases",
    title: "Anthropic Claude Code releases",
    url: "https://github.com/anthropics/claude-code",
    fetcherKind: "github-releases",
    fetcherParams: { github_repo: "anthropics/claude-code" },
    schedule: "daily",
    categories: ["dependencies", "ai"],
    maxItemsPerFetch: 30,
    addedAt: "2026-04-01T00:00:00Z",
    notes: "",
    ...over,
  };
}

function makeState(over: Partial<SourceState> = {}): SourceState {
  return {
    slug: "anthropic-releases",
    lastFetchedAt: null,
    cursor: {},
    consecutiveFailures: 0,
    nextAttemptAt: null,
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

// Fake release JSON matching GitHub's release object shape (we
// only populate the fields the fetcher reads).
function makeRelease(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 12345,
    tag_name: "v1.2.3",
    name: "1.2.3 — Spring release",
    html_url: "https://github.com/anthropics/claude-code/releases/tag/v1.2.3",
    body: "First paragraph summary.\n\nSecond paragraph with more detail.",
    published_at: "2026-04-10T10:00:00Z",
    draft: false,
    prerelease: false,
    ...over,
  };
}

// --- parseGithubRelease -------------------------------------------------

describe("parseGithubRelease", () => {
  it("extracts the fields we actually consume", () => {
    const r = parseGithubRelease(makeRelease());
    assert.ok(r);
    assert.equal(r!.id, 12345);
    assert.equal(r!.tagName, "v1.2.3");
    assert.equal(r!.name, "1.2.3 — Spring release");
    assert.equal(
      r!.htmlUrl,
      "https://github.com/anthropics/claude-code/releases/tag/v1.2.3",
    );
    assert.equal(r!.publishedAt, "2026-04-10T10:00:00Z");
    assert.equal(r!.draft, false);
    assert.equal(r!.prerelease, false);
  });

  it("returns null for non-objects", () => {
    assert.equal(parseGithubRelease(null), null);
    assert.equal(parseGithubRelease("string"), null);
    assert.equal(parseGithubRelease([1, 2]), null);
  });

  it("coerces missing fields to null without failing the whole parse", () => {
    const r = parseGithubRelease({});
    assert.ok(r);
    assert.equal(r!.id, null);
    assert.equal(r!.name, null);
    assert.equal(r!.htmlUrl, null);
    assert.equal(r!.publishedAt, null);
    assert.equal(r!.draft, false);
    assert.equal(r!.prerelease, false);
  });

  it("treats missing `draft` / `prerelease` as false (default)", () => {
    const r = parseGithubRelease({ id: 1 });
    assert.equal(r!.draft, false);
    assert.equal(r!.prerelease, false);
  });
});

// --- firstParagraph ------------------------------------------------------

describe("firstParagraph", () => {
  it("returns everything up to the first blank line", () => {
    assert.equal(
      firstParagraph("First line.\nStill first.\n\nSecond paragraph."),
      "First line.\nStill first.",
    );
  });

  it("returns the whole body when there's no blank line", () => {
    assert.equal(firstParagraph("Single line"), "Single line");
    assert.equal(firstParagraph("Line one\nLine two"), "Line one\nLine two");
  });

  it("returns null for empty / whitespace-only bodies", () => {
    assert.equal(firstParagraph(""), null);
    assert.equal(firstParagraph("   \n   "), null);
  });

  it("trims leading whitespace before computing the first paragraph", () => {
    assert.equal(
      firstParagraph("\n\n  \n\nactual first paragraph"),
      "actual first paragraph",
    );
  });
});

// --- releaseToSourceItem -------------------------------------------------

describe("releaseToSourceItem — happy path", () => {
  it("produces a well-formed SourceItem", () => {
    const release = parseGithubRelease(makeRelease())!;
    const item = releaseToSourceItem(release, makeSource(), null);
    assert.ok(item);
    assert.equal(item!.title, "1.2.3 — Spring release");
    assert.equal(
      item!.url,
      "https://github.com/anthropics/claude-code/releases/tag/v1.2.3",
    );
    assert.equal(item!.summary, "First paragraph summary.");
    assert.equal(
      item!.content,
      "First paragraph summary.\n\nSecond paragraph with more detail.",
    );
    assert.deepEqual(item!.categories, ["dependencies", "ai"]);
    assert.equal(item!.sourceSlug, "anthropic-releases");
  });

  it("falls back to tag_name when name is missing", () => {
    const release = parseGithubRelease(makeRelease({ name: null }))!;
    const item = releaseToSourceItem(release, makeSource(), null);
    assert.equal(item!.title, "v1.2.3");
  });

  it("uses a default title when both name and tag_name are missing", () => {
    const release = parseGithubRelease(
      makeRelease({ name: null, tag_name: null }),
    )!;
    const item = releaseToSourceItem(release, makeSource(), null);
    assert.equal(item!.title, "Release");
  });

  it("annotates pre-releases with `[pre]` in the title", () => {
    const release = parseGithubRelease(makeRelease({ prerelease: true }))!;
    const item = releaseToSourceItem(release, makeSource(), null);
    assert.match(item!.title, /^\[pre\]/);
  });
});

describe("releaseToSourceItem — drops", () => {
  it("drops drafts (defensive; API usually hides them anyway)", () => {
    const release = parseGithubRelease(makeRelease({ draft: true }))!;
    const item = releaseToSourceItem(release, makeSource(), null);
    assert.equal(item, null);
  });

  it("drops when html_url is missing", () => {
    const release = parseGithubRelease(makeRelease({ html_url: null }))!;
    const item = releaseToSourceItem(release, makeSource(), null);
    assert.equal(item, null);
  });

  it("drops when published_at is missing", () => {
    const release = parseGithubRelease(makeRelease({ published_at: null }))!;
    const item = releaseToSourceItem(release, makeSource(), null);
    assert.equal(item, null);
  });

  it("drops when html_url doesn't parse", () => {
    const release = parseGithubRelease(makeRelease({ html_url: "not a url" }))!;
    const item = releaseToSourceItem(release, makeSource(), null);
    assert.equal(item, null);
  });

  it("drops releases at or older than the cursor", () => {
    const release = parseGithubRelease(
      makeRelease({ published_at: "2026-04-10T10:00:00Z" }),
    )!;
    // Cursor at the exact same instant → drop.
    const atCursor = releaseToSourceItem(
      release,
      makeSource(),
      Date.parse("2026-04-10T10:00:00Z"),
    );
    assert.equal(atCursor, null);
    // Cursor newer than publish → drop.
    const afterCursor = releaseToSourceItem(
      release,
      makeSource(),
      Date.parse("2026-04-11T10:00:00Z"),
    );
    assert.equal(afterCursor, null);
  });

  it("keeps releases strictly newer than the cursor", () => {
    const release = parseGithubRelease(
      makeRelease({ published_at: "2026-04-11T10:00:00Z" }),
    )!;
    const item = releaseToSourceItem(
      release,
      makeSource(),
      Date.parse("2026-04-10T10:00:00Z"),
    );
    assert.ok(item);
  });
});

// --- updateReleasesCursor -----------------------------------------------

describe("updateReleasesCursor", () => {
  function parsed(published_at: string | null, draft = false) {
    return parseGithubRelease(makeRelease({ published_at, draft }))!;
  }

  it("advances to the newest publishedAt across all non-draft releases", () => {
    const releases = [
      parsed("2026-04-10T10:00:00Z"),
      parsed("2026-04-13T10:00:00Z"),
      parsed("2026-04-11T10:00:00Z"),
    ];
    const cursor = updateReleasesCursor({}, releases);
    assert.equal(cursor[RELEASES_CURSOR_KEY], "2026-04-13T10:00:00.000Z");
  });

  it("ignores drafts when advancing the cursor", () => {
    const releases = [
      parsed("2026-04-10T10:00:00Z"),
      parsed("2026-04-13T10:00:00Z", true), // draft (newest but ignored)
    ];
    const cursor = updateReleasesCursor({}, releases);
    assert.equal(cursor[RELEASES_CURSOR_KEY], "2026-04-10T10:00:00.000Z");
  });

  it("never rolls the cursor backwards", () => {
    const releases = [parsed("2026-04-01T00:00:00Z")];
    const existing = { [RELEASES_CURSOR_KEY]: "2026-04-10T10:00:00Z" };
    const cursor = updateReleasesCursor(existing, releases);
    assert.equal(cursor[RELEASES_CURSOR_KEY], "2026-04-10T10:00:00Z");
  });

  it("leaves the cursor alone when no valid dates exist", () => {
    const releases = [parsed(null)];
    const existing = { [RELEASES_CURSOR_KEY]: "2026-04-10T10:00:00Z" };
    const cursor = updateReleasesCursor(existing, releases);
    assert.equal(cursor[RELEASES_CURSOR_KEY], "2026-04-10T10:00:00Z");
  });

  it("preserves unrelated cursor keys", () => {
    const releases = [parsed("2026-04-13T10:00:00Z")];
    const existing = {
      [RELEASES_CURSOR_KEY]: "2026-04-10T10:00:00Z",
      other: "unchanged",
    };
    const cursor = updateReleasesCursor(existing, releases);
    assert.equal(cursor.other, "unchanged");
    assert.equal(cursor[RELEASES_CURSOR_KEY], "2026-04-13T10:00:00.000Z");
  });
});

// --- processReleasesResponse --------------------------------------------

describe("processReleasesResponse", () => {
  it("skips items old-or-equal to the cursor but still advances cursor across the full batch", () => {
    const body = [
      makeRelease({
        id: 1,
        published_at: "2026-04-10T10:00:00Z",
        html_url: "https://github.com/x/y/releases/tag/v1",
      }),
      makeRelease({
        id: 2,
        published_at: "2026-04-13T10:00:00Z",
        html_url: "https://github.com/x/y/releases/tag/v2",
      }),
    ];
    const cursor = { [RELEASES_CURSOR_KEY]: "2026-04-11T00:00:00Z" };
    const result = processReleasesResponse(body, makeSource(), cursor);
    // Only v2 is newer than cursor → emitted.
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].title, "1.2.3 — Spring release");
    // Cursor advances to v2's publishedAt, even though v1 was
    // dropped as old.
    assert.equal(
      result.cursor[RELEASES_CURSOR_KEY],
      "2026-04-13T10:00:00.000Z",
    );
  });

  it("returns empty items + unchanged cursor on a non-array body", () => {
    const cursor = { [RELEASES_CURSOR_KEY]: "2026-04-10T10:00:00Z" };
    const result = processReleasesResponse(
      { message: "Not Found" },
      makeSource(),
      cursor,
    );
    assert.deepEqual(result.items, []);
    assert.equal(result.cursor[RELEASES_CURSOR_KEY], "2026-04-10T10:00:00Z");
  });

  it("silently skips invalid entries in the array", () => {
    const body = [
      makeRelease({ id: 1, html_url: null }), // dropped (no url)
      "not an object", // dropped (not a record)
      makeRelease({ id: 2 }), // kept
    ];
    const result = processReleasesResponse(body, makeSource(), {});
    assert.equal(result.items.length, 1);
  });

  it("caps output at source.maxItemsPerFetch", () => {
    const body = Array.from({ length: 50 }, (_, i) =>
      makeRelease({
        id: i,
        html_url: `https://github.com/x/y/releases/tag/v${i}`,
        published_at: new Date(
          Date.UTC(2026, 3, 1 + (i % 28), 10, 0, 0),
        ).toISOString(),
      }),
    );
    const result = processReleasesResponse(
      body,
      makeSource({ maxItemsPerFetch: 10 }),
      {},
    );
    assert.equal(result.items.length, 10);
  });
});

// --- end-to-end with stubbed HTTP ---------------------------------------

const RELEASES_BODY_OK = [makeRelease()];

describe("githubReleasesFetcher.fetch", () => {
  it("fetches, parses, and returns SourceItems", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      // Sanity-check the URL our fetcher built.
      assert.match(
        String(input),
        /^https:\/\/api\.github\.com\/repos\/anthropics\/claude-code\/releases$/,
      );
      return new Response(JSON.stringify(RELEASES_BODY_OK), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const result = await githubReleasesFetcher.fetch(
      makeSource(),
      makeState(),
      makeFetcherDeps(fetchImpl),
    );
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].sourceSlug, "anthropic-releases");
    assert.deepEqual(result.items[0].categories, ["dependencies", "ai"]);
    assert.equal(
      result.cursor[RELEASES_CURSOR_KEY],
      "2026-04-10T10:00:00.000Z",
    );
  });

  it("rejects when github_repo param is missing", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("should not fetch");
    };
    const source = makeSource({ fetcherParams: {} });
    await assert.rejects(
      () =>
        githubReleasesFetcher.fetch(
          source,
          makeState(),
          makeFetcherDeps(fetchImpl),
        ),
      (err: unknown) =>
        err instanceof GithubFetcherError &&
        /github_repo param is required/.test(err.message),
    );
  });

  it("rejects when github_repo param is malformed", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("should not fetch");
    };
    const source = makeSource({ fetcherParams: { github_repo: "../etc" } });
    await assert.rejects(
      () =>
        githubReleasesFetcher.fetch(
          source,
          makeState(),
          makeFetcherDeps(fetchImpl),
        ),
      GithubFetcherError,
    );
  });

  it("surfaces a 404 from the API as GithubFetcherError(status=404)", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    await assert.rejects(
      () =>
        githubReleasesFetcher.fetch(
          makeSource(),
          makeState(),
          makeFetcherDeps(fetchImpl),
        ),
      (err: unknown) => err instanceof GithubFetcherError && err.status === 404,
    );
  });

  it("registers itself as the `github-releases` fetcher on import", async () => {
    const { getFetcher } =
      await import("../../server/workspace/sources/fetchers/index.js");
    const fetcher = getFetcher("github-releases");
    assert.ok(fetcher);
    assert.equal(fetcher!.kind, "github-releases");
  });
});
