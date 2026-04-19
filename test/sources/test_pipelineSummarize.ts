import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSummarizePromptBody,
  buildEmptyDayMarkdown,
  parseSummarizeOutput,
  makeDefaultSummarize,
} from "../../server/workspace/sources/pipeline/summarize.js";
import type { SourceItem } from "../../server/workspace/sources/types.js";

function makeItem(over: Partial<SourceItem> = {}): SourceItem {
  return {
    id: "abc",
    title: "A thing",
    url: "https://example.com/a",
    publishedAt: "2026-04-13T10:00:00Z",
    categories: ["tech-news", "ai"],
    sourceSlug: "hn",
    ...over,
  };
}

describe("buildSummarizePromptBody", () => {
  it("includes the date header and JSON items block", () => {
    const body = buildSummarizePromptBody([makeItem()], "2026-04-13");
    assert.match(body, /^DATE: 2026-04-13/);
    assert.match(body, /ITEMS \(JSON\):/);
    // JSON should be parseable and contain our item.
    const jsonStart = body.indexOf("[");
    const items = JSON.parse(body.slice(jsonStart));
    assert.equal(items.length, 1);
    assert.equal(items[0].title, "A thing");
  });

  it("excludes the `content` field (keeps prompt compact)", () => {
    const body = buildSummarizePromptBody(
      [makeItem({ content: "huge body ".repeat(1000) })],
      "2026-04-13",
    );
    const jsonStart = body.indexOf("[");
    const items = JSON.parse(body.slice(jsonStart));
    assert.equal(items[0].content, undefined);
  });

  it("truncates `summary` to 200 chars", () => {
    const body = buildSummarizePromptBody(
      [makeItem({ summary: "x".repeat(500) })],
      "2026-04-13",
    );
    const jsonStart = body.indexOf("[");
    const items = JSON.parse(body.slice(jsonStart));
    assert.equal(items[0].summary.length, 200);
  });

  it("omits summary key entirely when missing", () => {
    const body = buildSummarizePromptBody([makeItem()], "2026-04-13");
    const jsonStart = body.indexOf("[");
    const items = JSON.parse(body.slice(jsonStart));
    assert.equal("summary" in items[0], false);
  });

  it("includes `severity` when present", () => {
    const body = buildSummarizePromptBody(
      [makeItem({ severity: "critical" })],
      "2026-04-13",
    );
    const jsonStart = body.indexOf("[");
    const items = JSON.parse(body.slice(jsonStart));
    assert.equal(items[0].severity, "critical");
  });
});

describe("buildEmptyDayMarkdown", () => {
  it("produces a minimal 'nothing new' markdown for empty days", () => {
    const md = buildEmptyDayMarkdown("2026-04-13");
    assert.match(md, /^# Daily brief — 2026-04-13/);
    assert.match(md, /No new items today/);
  });
});

describe("parseSummarizeOutput", () => {
  it("returns the result markdown on a success envelope", () => {
    const stdout = JSON.stringify({
      type: "result",
      result: "# Daily brief\n\n## AI\n- foo\n",
    });
    const out = parseSummarizeOutput(stdout);
    assert.match(out, /# Daily brief/);
  });

  it("throws on the claude error envelope with joined errors", () => {
    const stdout = JSON.stringify({
      is_error: true,
      errors: ["budget blown", "more context"],
    });
    assert.throws(
      () => parseSummarizeOutput(stdout),
      /budget blown; more context/,
    );
  });

  it("falls back to result field on error envelope without errors[]", () => {
    const stdout = JSON.stringify({ is_error: true, result: "rate limited" });
    assert.throws(() => parseSummarizeOutput(stdout), /rate limited/);
  });

  it("throws on unparseable stdout", () => {
    assert.throws(
      () => parseSummarizeOutput("not json at all"),
      /failed to parse claude json/,
    );
  });

  it("throws when result field is missing or empty", () => {
    const emptyResult = JSON.stringify({ result: "" });
    assert.throws(
      () => parseSummarizeOutput(emptyResult),
      /empty \/ missing result/,
    );
    const missingResult = JSON.stringify({ type: "result" });
    assert.throws(
      () => parseSummarizeOutput(missingResult),
      /empty \/ missing result/,
    );
  });
});

describe("makeDefaultSummarize — empty day short-circuit", () => {
  it("returns the empty-day markdown without invoking claude for an empty list", async () => {
    // Use makeDefaultSummarize — with no items it should never
    // even attempt to spawn the CLI. The timeout is short just
    // as a defensive backstop (if it ever DID try, the test
    // would time out fast rather than hang).
    const summarize = makeDefaultSummarize("2026-04-13", 500);
    const out = await summarize([]);
    assert.match(out, /^# Daily brief — 2026-04-13/);
    assert.match(out, /No new items today/);
  });
});
