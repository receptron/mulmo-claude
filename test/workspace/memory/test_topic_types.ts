// Unit tests for the topic-based memory schema helpers (#1070).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { extractH2Sections, isSafeTopicSlug, slugifyTopicName } from "../../../server/workspace/memory/topic-types.js";

describe("memory/topic-types — extractH2Sections", () => {
  it("returns headings in source order", () => {
    const body = ["# Music", "", "## Rock / Metal", "- Pantera", "", "## Punk / Melodic", "- NOFX", ""].join("\n");
    assert.deepEqual(extractH2Sections(body), ["Rock / Metal", "Punk / Melodic"]);
  });

  it("ignores deeper headings (### and below)", () => {
    const body = ["# Music", "", "## Rock", "- a", "", "### Hard Rock", "- b", "", "## Pop", "- c"].join("\n");
    assert.deepEqual(extractH2Sections(body), ["Rock", "Pop"]);
  });

  it("returns an empty array when there are no H2", () => {
    const body = ["# Travel", "", "- Egypt", "- NYC"].join("\n");
    assert.deepEqual(extractH2Sections(body), []);
  });

  it("trims whitespace and handles CRLF line endings", () => {
    const body = "# X\r\n\r\n##   Spaced  \r\n- one\r\n##\tTabbed\r\n";
    assert.deepEqual(extractH2Sections(body), ["Spaced", "Tabbed"]);
  });

  it("ignores `## ` followed by an empty heading", () => {
    const body = "# Empty\n\n## \n- bullet under nothing\n";
    assert.deepEqual(extractH2Sections(body), []);
  });
});

describe("memory/topic-types — slugifyTopicName", () => {
  it("lowercases and hyphenates ASCII names", () => {
    assert.equal(slugifyTopicName("AI Research Papers"), "ai-research-papers");
    assert.equal(slugifyTopicName("egypt trip 2026"), "egypt-trip-2026");
  });

  it("returns null for all-non-ASCII names so the caller can pick a fallback", () => {
    assert.equal(slugifyTopicName("印象派"), null);
  });

  it("trims trailing separators", () => {
    assert.equal(slugifyTopicName("Music!!!  "), "music");
  });

  it("caps length at 60 chars", () => {
    const long = "a".repeat(120);
    const result = slugifyTopicName(long);
    assert.ok(result !== null);
    assert.ok(result.length <= 60, `result is bounded; got ${result.length}`);
  });
});

describe("memory/topic-types — isSafeTopicSlug", () => {
  it("accepts typical slugs", () => {
    assert.equal(isSafeTopicSlug("music"), true);
    assert.equal(isSafeTopicSlug("ai-research"), true);
    assert.equal(isSafeTopicSlug("egypt-trip-2026"), true);
  });

  it("rejects path-traversal and separator chars", () => {
    assert.equal(isSafeTopicSlug(".."), false);
    assert.equal(isSafeTopicSlug("../foo"), false);
    assert.equal(isSafeTopicSlug("a/b"), false);
    assert.equal(isSafeTopicSlug("a\\b"), false);
    assert.equal(isSafeTopicSlug("foo\0bar"), false);
  });

  it("rejects empty / dotfile / oversized / case-fold of MEMORY", () => {
    assert.equal(isSafeTopicSlug(""), false);
    assert.equal(isSafeTopicSlug(".hidden"), false);
    assert.equal(isSafeTopicSlug("a".repeat(80)), false);
    assert.equal(isSafeTopicSlug("MEMORY"), false);
    assert.equal(isSafeTopicSlug("Memory"), false);
    assert.equal(isSafeTopicSlug("memory"), false);
  });
});
