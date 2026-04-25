import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractDailyJsonIndex, lastNDates, dedupeById, extractItemBodyFromArchive, candidateMonths } from "../../server/workspace/news/reader.js";

describe("extractDailyJsonIndex", () => {
  it("parses items from a trailing fenced JSON block", () => {
    const markdown = `# Daily brief

Some prose.

\`\`\`json
{
  "itemCount": 1,
  "byCategory": { "tech-news": 1 },
  "items": [
    { "id": "abc", "title": "Hi", "url": "https://x", "publishedAt": "2026-04-15T01:00:00.000Z", "categories": ["tech-news"], "sourceSlug": "hn" }
  ]
}
\`\`\`
`;
    const items = extractDailyJsonIndex(markdown);
    assert.equal(items?.length, 1);
    assert.equal(items?.[0].id, "abc");
  });

  it("returns null when there is no fenced JSON block", () => {
    assert.equal(extractDailyJsonIndex("# just prose"), null);
    assert.equal(extractDailyJsonIndex(""), null);
  });

  it("uses the LAST fenced block when multiple appear", () => {
    const markdown = `\`\`\`json
{ "items": [{"id":"first","title":"x","url":"https://x","publishedAt":"2026-04-15","categories":[],"sourceSlug":"s"}] }
\`\`\`

middle prose

\`\`\`json
{ "items": [{"id":"last","title":"y","url":"https://y","publishedAt":"2026-04-15","categories":[],"sourceSlug":"s"}] }
\`\`\`
`;
    const items = extractDailyJsonIndex(markdown);
    assert.equal(items?.length, 1);
    assert.equal(items?.[0].id, "last");
  });

  it("returns null on malformed JSON", () => {
    const markdown = "```json\n{ not valid }\n```\n";
    assert.equal(extractDailyJsonIndex(markdown), null);
  });

  it("filters out malformed item entries", () => {
    const markdown = `\`\`\`json
{
  "items": [
    { "id": "ok", "title": "T", "url": "https://x", "publishedAt": "2026-04-15", "categories": [], "sourceSlug": "s" },
    { "id": "missing-source", "title": "T", "url": "https://x", "publishedAt": "2026-04-15", "categories": [] },
    "not even an object",
    null
  ]
}
\`\`\`
`;
    const items = extractDailyJsonIndex(markdown);
    assert.equal(items?.length, 1);
    assert.equal(items?.[0].id, "ok");
  });
});

describe("lastNDates", () => {
  it("returns N dates ending today, newest first", () => {
    const today = new Date(Date.UTC(2026, 3, 15)); // 2026-04-15
    const dates = lastNDates(3, today);
    assert.deepEqual(dates, ["2026-04-15", "2026-04-14", "2026-04-13"]);
  });

  it("crosses month boundaries", () => {
    const today = new Date(Date.UTC(2026, 4, 1)); // 2026-05-01
    const dates = lastNDates(3, today);
    assert.deepEqual(dates, ["2026-05-01", "2026-04-30", "2026-04-29"]);
  });

  it("returns an empty array for days <= 0", () => {
    const today = new Date(Date.UTC(2026, 3, 15));
    assert.deepEqual(lastNDates(0, today), []);
  });
});

describe("dedupeById", () => {
  const sample = (suffix: string, itemId: string) => ({
    id: itemId,
    title: `t${suffix}`,
    url: `https://x/${suffix}`,
    publishedAt: "2026-04-15",
    categories: [],
    sourceSlug: "s",
  });

  it("keeps the first occurrence of each id", () => {
    const result = dedupeById([sample("1", "a"), sample("2", "b"), sample("3", "a")]);
    assert.equal(result.length, 2);
    assert.equal(result[0].title, "t1");
    assert.equal(result[1].title, "t2");
  });

  it("returns an empty array unchanged", () => {
    assert.deepEqual(dedupeById([]), []);
  });
});

describe("extractItemBodyFromArchive", () => {
  const sampleArchive = `## Hello world

- **Published:** 2026-04-15T01:00:00.000Z
- **Source:** hn
- **URL:** https://example.com/a
- **Categories:** tech-news

Body of A.

Second paragraph of A.

---

## Other item

- **Published:** 2026-04-15T02:00:00.000Z
- **Source:** hn
- **URL:** https://example.com/b
- **Categories:** tech-news

Body of B.

---
`;

  it("returns the body for the matching URL", () => {
    const body = extractItemBodyFromArchive(sampleArchive, "https://example.com/a");
    assert.equal(body, "Body of A.\n\nSecond paragraph of A.");
  });

  it("returns the body for a different item in the same file", () => {
    const body = extractItemBodyFromArchive(sampleArchive, "https://example.com/b");
    assert.equal(body, "Body of B.");
  });

  it("returns null when the URL is not present", () => {
    assert.equal(extractItemBodyFromArchive(sampleArchive, "https://nope"), null);
  });

  it("returns null when the matching block has no body", () => {
    const markdown = `## No-body item

- **Published:** 2026-04-15T01:00:00.000Z
- **Source:** hn
- **URL:** https://only-meta.example
- **Categories:** tech-news

---
`;
    assert.equal(extractItemBodyFromArchive(markdown, "https://only-meta.example"), null);
  });
});

describe("candidateMonths", () => {
  it("returns target month plus the two neighbours", () => {
    const months = candidateMonths("2026-04-15T01:00:00.000Z");
    assert.deepEqual(months, ["2026-04", "2026-03", "2026-05"]);
  });

  it("crosses year boundaries cleanly", () => {
    assert.deepEqual(candidateMonths("2026-01-01T00:00:00.000Z"), ["2026-01", "2025-12", "2026-02"]);
    assert.deepEqual(candidateMonths("2026-12-31T23:59:59.999Z"), ["2026-12", "2026-11", "2027-01"]);
  });

  it("returns [] on malformed dates", () => {
    assert.deepEqual(candidateMonths("not-a-date"), []);
  });
});
