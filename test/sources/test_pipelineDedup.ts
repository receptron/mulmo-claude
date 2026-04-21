import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dedupAcrossSources } from "../../server/workspace/sources/pipeline/dedup.js";
import type { SourceItem } from "../../server/workspace/sources/types.js";

function makeItem(id: string, sourceSlug: string): SourceItem {
  return {
    id,
    title: `Item ${id}`,
    url: `https://example.com/${id}`,
    publishedAt: "2026-04-13T00:00:00Z",
    categories: ["tech-news"],
    sourceSlug,
  };
}

describe("dedupAcrossSources", () => {
  it("returns empty result for empty input", () => {
    const out = dedupAcrossSources([]);
    assert.deepEqual(out.items, []);
    assert.equal(out.stats.uniqueCount, 0);
    assert.equal(out.stats.duplicateCount, 0);
    assert.equal(out.stats.duplicateSlugsById.size, 0);
  });

  it("passes through a dedup-free list unchanged", () => {
    const items = [makeItem("a", "hn"), makeItem("b", "hn"), makeItem("c", "reddit")];
    const out = dedupAcrossSources(items);
    assert.equal(out.items.length, 3);
    assert.equal(out.stats.uniqueCount, 3);
    assert.equal(out.stats.duplicateCount, 0);
  });

  it("keeps the first occurrence, drops later duplicates", () => {
    const items = [
      makeItem("a", "hn"),
      makeItem("b", "reddit"),
      makeItem("a", "twitter"), // duplicate
      makeItem("c", "hn"),
    ];
    const out = dedupAcrossSources(items);
    assert.deepEqual(
      out.items.map((i) => [i.id, i.sourceSlug]),
      [
        ["a", "hn"],
        ["b", "reddit"],
        ["c", "hn"],
      ],
    );
    assert.equal(out.stats.duplicateCount, 1);
  });

  it("records the winning sourceSlug for each duplicate id", () => {
    const items = [makeItem("a", "hn"), makeItem("a", "reddit"), makeItem("a", "twitter"), makeItem("b", "hn"), makeItem("b", "reddit")];
    const out = dedupAcrossSources(items);
    assert.equal(out.items.length, 2);
    assert.deepEqual(out.stats.duplicateSlugsById.get("a"), ["reddit", "twitter"]);
    assert.deepEqual(out.stats.duplicateSlugsById.get("b"), ["reddit"]);
    assert.equal(out.stats.duplicateCount, 3);
  });

  it("preserves insertion order (doesn't sort)", () => {
    // Caller's sort (e.g. newest-first) survives dedup.
    const items = [makeItem("c", "s1"), makeItem("a", "s1"), makeItem("b", "s1")];
    const out = dedupAcrossSources(items);
    assert.deepEqual(
      out.items.map((i) => i.id),
      ["c", "a", "b"],
    );
  });
});
