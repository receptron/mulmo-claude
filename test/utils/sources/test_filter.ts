import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SOURCE_FILTER_KEYS, countByFilter, isSourceFilterKey, matchesSourceFilter } from "../../../src/utils/sources/filter.js";
import type { Source } from "../../../src/plugins/manageSource/index";

function makeSource(overrides: Partial<Source>): Source {
  return {
    slug: overrides.slug ?? "slug-x",
    title: overrides.title ?? "Title",
    url: overrides.url ?? "https://example.com",
    fetcherKind: overrides.fetcherKind ?? "rss",
    fetcherParams: overrides.fetcherParams ?? {},
    schedule: overrides.schedule ?? "daily",
    categories: overrides.categories ?? [],
    maxItemsPerFetch: overrides.maxItemsPerFetch ?? 20,
    addedAt: overrides.addedAt ?? "2026-04-25T00:00:00Z",
    notes: overrides.notes,
  };
}

describe("matchesSourceFilter — kind chips", () => {
  const rss = makeSource({ fetcherKind: "rss" });
  const ghReleases = makeSource({ fetcherKind: "github-releases" });
  const ghIssues = makeSource({ fetcherKind: "github-issues" });
  const arxiv = makeSource({ fetcherKind: "arxiv" });

  it("`all` matches every source regardless of kind", () => {
    for (const source of [rss, ghReleases, ghIssues, arxiv]) {
      assert.equal(matchesSourceFilter(source, "all"), true);
    }
  });

  it("`rss` matches only the rss kind", () => {
    assert.equal(matchesSourceFilter(rss, "rss"), true);
    assert.equal(matchesSourceFilter(ghReleases, "rss"), false);
    assert.equal(matchesSourceFilter(arxiv, "rss"), false);
  });

  it("`github` matches both releases AND issues kinds", () => {
    assert.equal(matchesSourceFilter(ghReleases, "github"), true);
    assert.equal(matchesSourceFilter(ghIssues, "github"), true);
    assert.equal(matchesSourceFilter(rss, "github"), false);
    assert.equal(matchesSourceFilter(arxiv, "github"), false);
  });

  it("`arxiv` matches only the arxiv kind", () => {
    assert.equal(matchesSourceFilter(arxiv, "arxiv"), true);
    assert.equal(matchesSourceFilter(rss, "arxiv"), false);
    assert.equal(matchesSourceFilter(ghReleases, "arxiv"), false);
  });
});

describe("matchesSourceFilter — schedule chips", () => {
  const daily = makeSource({ schedule: "daily" });
  const weekly = makeSource({ schedule: "weekly" });
  const manual = makeSource({ schedule: "manual" });

  it("schedule chips bucket by `schedule` regardless of kind", () => {
    const githubDaily = makeSource({ fetcherKind: "github-releases", schedule: "daily" });
    assert.equal(matchesSourceFilter(daily, "schedule:daily"), true);
    assert.equal(matchesSourceFilter(githubDaily, "schedule:daily"), true);
    assert.equal(matchesSourceFilter(weekly, "schedule:daily"), false);
    assert.equal(matchesSourceFilter(manual, "schedule:daily"), false);
  });

  it("`schedule:weekly` matches only weekly", () => {
    assert.equal(matchesSourceFilter(weekly, "schedule:weekly"), true);
    assert.equal(matchesSourceFilter(daily, "schedule:weekly"), false);
  });

  it("`schedule:manual` matches only manual", () => {
    assert.equal(matchesSourceFilter(manual, "schedule:manual"), true);
    assert.equal(matchesSourceFilter(daily, "schedule:manual"), false);
  });
});

describe("isSourceFilterKey", () => {
  it("accepts every key in SOURCE_FILTER_KEYS", () => {
    for (const key of SOURCE_FILTER_KEYS) {
      assert.equal(isSourceFilterKey(key), true);
    }
  });

  it("rejects unknown / malformed values", () => {
    assert.equal(isSourceFilterKey("kind:rss"), false);
    assert.equal(isSourceFilterKey("schedule:hourly"), false); // hourly isn't a client schedule
    assert.equal(isSourceFilterKey("schedule:"), false);
    assert.equal(isSourceFilterKey(""), false);
    assert.equal(isSourceFilterKey(null), false);
    assert.equal(isSourceFilterKey(undefined), false);
    assert.equal(isSourceFilterKey(42), false);
  });
});

describe("countByFilter", () => {
  it("returns a record with every chip key, all zero on empty input", () => {
    const counts = countByFilter([]);
    for (const key of SOURCE_FILTER_KEYS) {
      assert.equal(counts[key], 0, `expected ${key} to be 0 on empty input`);
    }
  });

  it("counts a single source against every chip it matches", () => {
    const sources = [makeSource({ fetcherKind: "rss", schedule: "daily" })];
    const counts = countByFilter(sources);
    assert.equal(counts.all, 1);
    assert.equal(counts.rss, 1);
    assert.equal(counts.github, 0);
    assert.equal(counts.arxiv, 0);
    assert.equal(counts["schedule:daily"], 1);
    assert.equal(counts["schedule:weekly"], 0);
    assert.equal(counts["schedule:manual"], 0);
  });

  it("aggregates across kinds and schedules in a mixed list", () => {
    const sources = [
      makeSource({ slug: "a", fetcherKind: "rss", schedule: "daily" }),
      makeSource({ slug: "b", fetcherKind: "rss", schedule: "weekly" }),
      makeSource({ slug: "c", fetcherKind: "github-releases", schedule: "daily" }),
      makeSource({ slug: "d", fetcherKind: "github-issues", schedule: "manual" }),
      makeSource({ slug: "e", fetcherKind: "arxiv", schedule: "weekly" }),
    ];
    const counts = countByFilter(sources);
    assert.equal(counts.all, 5);
    assert.equal(counts.rss, 2);
    assert.equal(counts.github, 2, "github chip aggregates releases + issues");
    assert.equal(counts.arxiv, 1);
    assert.equal(counts["schedule:daily"], 2);
    assert.equal(counts["schedule:weekly"], 2);
    assert.equal(counts["schedule:manual"], 1);
  });
});
