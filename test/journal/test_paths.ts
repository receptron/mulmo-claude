import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { summariesRoot, dailyPathFor, topicPathFor, archivedTopicPathFor, toIsoDate, slugify } from "../../server/workspace/journal/paths.js";

const WS = "/fake/workspace";

describe("summariesRoot", () => {
  it("joins workspace root with the summaries dir", () => {
    assert.equal(summariesRoot(WS), path.join(WS, "conversations", "summaries"));
  });
});

describe("dailyPathFor", () => {
  it("builds summaries/daily/YYYY/MM/DD.md", () => {
    assert.equal(dailyPathFor(WS, "2026-04-11"), path.join(WS, "conversations", "summaries", "daily", "2026", "04", "11.md"));
  });

  it("preserves leading zeros", () => {
    assert.equal(dailyPathFor(WS, "2026-01-03"), path.join(WS, "conversations", "summaries", "daily", "2026", "01", "03.md"));
  });
});

describe("topicPathFor", () => {
  it("builds summaries/topics/<slug>.md", () => {
    assert.equal(topicPathFor(WS, "refactoring"), path.join(WS, "conversations", "summaries", "topics", "refactoring.md"));
  });
});

describe("archivedTopicPathFor", () => {
  it("builds summaries/archive/topics/<slug>.md", () => {
    assert.equal(archivedTopicPathFor(WS, "old-topic"), path.join(WS, "conversations", "summaries", "archive", "topics", "old-topic.md"));
  });
});

describe("toIsoDate", () => {
  it("formats a Date in local time as YYYY-MM-DD", () => {
    // Pick a date in the middle of a month to avoid timezone edge
    // cases flipping the result. April 15 at noon local is April 15
    // in every timezone on Earth.
    const d = new Date(2026, 3, 15, 12, 0, 0); // month is 0-indexed
    assert.equal(toIsoDate(d), "2026-04-15");
  });

  it("pads single-digit months and days", () => {
    const d = new Date(2026, 0, 3, 12, 0, 0);
    assert.equal(toIsoDate(d), "2026-01-03");
  });

  it("accepts a ms timestamp", () => {
    const d = new Date(2026, 5, 20, 12, 0, 0);
    assert.equal(toIsoDate(d.getTime()), "2026-06-20");
  });
});

describe("slugify", () => {
  it("lowercases ASCII input", () => {
    assert.equal(slugify("Refactoring"), "refactoring");
  });

  it("replaces spaces with hyphens", () => {
    assert.equal(slugify("video generation"), "video-generation");
  });

  it("collapses runs of separators", () => {
    assert.equal(slugify("foo   bar___baz"), "foo-bar-baz");
  });

  it("strips leading and trailing separators", () => {
    assert.equal(slugify("--hello--"), "hello");
  });

  it("keeps digits", () => {
    assert.equal(slugify("v2 release"), "v2-release");
  });

  it("strips punctuation", () => {
    assert.equal(slugify("Q&A: notes!"), "q-a-notes");
  });

  it("drops non-ASCII characters", () => {
    // "リファクタリング" drops entirely; fallback kicks in.
    assert.equal(slugify("リファクタリング"), "topic");
  });

  it("keeps ASCII portions when mixed with non-ASCII", () => {
    assert.equal(slugify("mulmo リファクタ"), "mulmo");
  });

  it("falls back to 'topic' for empty input", () => {
    assert.equal(slugify(""), "topic");
  });

  it("falls back to 'topic' for whitespace-only input", () => {
    assert.equal(slugify("   "), "topic");
  });

  it("is idempotent for already-slugged input", () => {
    assert.equal(slugify("already-slugged"), "already-slugged");
  });
});
