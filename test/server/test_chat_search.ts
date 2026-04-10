import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scoreEntries } from "../../server/chat-index/search.js";
import type { ChatIndexEntry } from "../../server/chat-index/types.js";

function entry(over: Partial<ChatIndexEntry>): ChatIndexEntry {
  return {
    id: "id",
    roleId: "general",
    startedAt: "2026-04-10T00:00:00Z",
    sourceSha256: "x",
    sourceLines: 1,
    indexedAt: "2026-04-10T00:00:00Z",
    title: "",
    summary: "",
    keywords: [],
    ...over,
  };
}

describe("scoreEntries", () => {
  it("returns empty for an empty query", () => {
    const r = scoreEntries(
      [entry({ id: "a", title: "anything", summary: "anything" })],
      "",
    );
    assert.deepEqual(r, []);
  });

  it("scores keyword exact match higher than title substring", () => {
    const entries = [
      entry({ id: "kw", title: "unrelated", keywords: ["bootcamp"] }),
      entry({ id: "ti", title: "bootcamp planning", keywords: [] }),
    ];
    const r = scoreEntries(entries, "bootcamp");
    assert.equal(r.length, 2);
    // kw scored 5 (keyword), ti scored 3 (title) → kw first
    assert.equal(r[0].id, "kw");
    assert.equal(r[1].id, "ti");
    assert.ok(r[0].score > r[1].score);
  });

  it("scores title substring higher than summary substring", () => {
    const entries = [
      entry({ id: "ti", title: "wiki schema discussion" }),
      entry({ id: "su", summary: "wiki schema came up briefly" }),
    ];
    const r = scoreEntries(entries, "wiki schema");
    assert.equal(r[0].id, "ti");
    assert.equal(r[1].id, "su");
  });

  it("filters out non-matching entries", () => {
    const entries = [
      entry({ id: "a", title: "matches the query word" }),
      entry({
        id: "b",
        title: "completely different",
        summary: "nothing here",
        keywords: ["other"],
      }),
    ];
    const r = scoreEntries(entries, "query");
    assert.equal(r.length, 1);
    assert.equal(r[0].id, "a");
  });

  it("ties broken by recency (newer first)", () => {
    const entries = [
      entry({
        id: "old",
        title: "matching",
        startedAt: "2026-01-01T00:00:00Z",
      }),
      entry({
        id: "new",
        title: "matching",
        startedAt: "2026-04-01T00:00:00Z",
      }),
    ];
    const r = scoreEntries(entries, "matching");
    assert.equal(r[0].id, "new");
    assert.equal(r[1].id, "old");
  });

  it("normalizes case and full-width", () => {
    const entries = [
      entry({ id: "u", title: "Bootcamp PLANNING" }),
    ];
    const r = scoreEntries(entries, "bootcamp");
    assert.equal(r.length, 1);
  });

  it("includes a snippet from the summary when there is a match", () => {
    const entries = [
      entry({
        id: "snip",
        title: "x",
        summary:
          "long lead-in text leading up to the keyword match here and continuing afterward",
      }),
    ];
    const r = scoreEntries(entries, "keyword match");
    assert.equal(r.length, 1);
    assert.match(r[0].snippet, /keyword match/);
  });

  it("does not match when query is missing entirely", () => {
    const entries = [
      entry({
        id: "a",
        title: "no relation",
        summary: "still nothing",
        keywords: ["nope"],
      }),
    ];
    const r = scoreEntries(entries, "absent");
    assert.equal(r.length, 0);
  });
});
