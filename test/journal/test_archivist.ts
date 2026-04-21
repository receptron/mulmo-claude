import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildDailyUserPrompt,
  buildOptimizationUserPrompt,
  extractJsonObject,
  isDailyArchivistOutput,
  isOptimizationOutput,
  type DailyArchivistInput,
  type OptimizationInput,
} from "../../server/workspace/journal/archivist.js";

describe("buildDailyUserPrompt", () => {
  const baseInput = (over: Partial<DailyArchivistInput> = {}): DailyArchivistInput => ({
    date: "2026-04-11",
    existingDailySummary: null,
    existingTopicSummaries: [],
    sessionExcerpts: [],
    ...over,
  });

  it("includes the date header", () => {
    const out = buildDailyUserPrompt(baseInput());
    assert.match(out, /DATE: 2026-04-11/);
  });

  it("omits the existing-summary block when null", () => {
    const out = buildDailyUserPrompt(baseInput());
    assert.doesNotMatch(out, /EXISTING DAILY SUMMARY/);
  });

  it("includes the existing-summary block when provided", () => {
    const out = buildDailyUserPrompt(baseInput({ existingDailySummary: "# old summary" }));
    assert.match(out, /EXISTING DAILY SUMMARY/);
    assert.match(out, /# old summary/);
  });

  it("shows '(none yet)' for an empty topic list", () => {
    const out = buildDailyUserPrompt(baseInput());
    assert.match(out, /EXISTING TOPICS:\n\(none yet\)/);
  });

  it("lists topic slugs when provided", () => {
    const out = buildDailyUserPrompt(
      baseInput({
        existingTopicSummaries: [
          { slug: "refactoring", content: "..." },
          { slug: "video-generation", content: "..." },
        ],
      }),
    );
    assert.match(out, /- refactoring/);
    assert.match(out, /- video-generation/);
  });

  it("renders session excerpts with role and events", () => {
    const out = buildDailyUserPrompt(
      baseInput({
        sessionExcerpts: [
          {
            sessionId: "sess-abc",
            roleId: "default",
            events: [
              { source: "user", type: "text", content: "hello" },
              { source: "assistant", type: "text", content: "world" },
            ],
            artifactPaths: [],
          },
        ],
      }),
    );
    assert.match(out, /### session sess-abc \(role: default\)/);
    assert.match(out, /\[user\/text\] hello/);
    assert.match(out, /\[assistant\/text\] world/);
  });

  it("shows '(none)' for an empty artifact set", () => {
    const out = buildDailyUserPrompt(baseInput());
    assert.match(out, /ARTIFACTS REFERENCED:\n\(none\)/);
  });

  it("aggregates artifact paths across sessions and sorts them", () => {
    const out = buildDailyUserPrompt(
      baseInput({
        sessionExcerpts: [
          {
            sessionId: "s1",
            roleId: "r",
            events: [],
            artifactPaths: ["stories/b.json", "wiki/pages/a.md"],
          },
          {
            sessionId: "s2",
            roleId: "r",
            events: [],
            artifactPaths: ["stories/b.json", "HTMLs/x.html"],
          },
        ],
      }),
    );
    // All three paths appear, sorted, each only once.
    const artifactsSection = out.slice(out.indexOf("ARTIFACTS REFERENCED:"));
    const htmlIdx = artifactsSection.indexOf("- HTMLs/x.html");
    const storiesIdx = artifactsSection.indexOf("- stories/b.json");
    const wikiIdx = artifactsSection.indexOf("- wiki/pages/a.md");
    assert.ok(htmlIdx !== -1, "HTMLs path should appear");
    assert.ok(storiesIdx !== -1, "stories path should appear");
    assert.ok(wikiIdx !== -1, "wiki path should appear");
    assert.ok(htmlIdx < storiesIdx && storiesIdx < wikiIdx, "sorted ascending");
    // Dedup check: stories/b.json should only appear once.
    const matches = artifactsSection.match(/- stories\/b\.json/g);
    assert.equal(matches?.length, 1);
  });
});

describe("buildOptimizationUserPrompt", () => {
  it("renders each topic with slug heading and fenced head content", () => {
    const input: OptimizationInput = {
      topics: [
        { slug: "topic-a", headContent: "first topic body" },
        { slug: "topic-b", headContent: "second topic body" },
      ],
    };
    const out = buildOptimizationUserPrompt(input);
    assert.match(out, /### topic-a/);
    assert.match(out, /first topic body/);
    assert.match(out, /### topic-b/);
    assert.match(out, /second topic body/);
  });
});

describe("extractJsonObject", () => {
  it("parses a fenced ```json block", () => {
    const raw = 'Here you go:\n```json\n{"hello":"world"}\n```\nDone.';
    assert.deepEqual(extractJsonObject(raw), { hello: "world" });
  });

  it("parses a bare balanced { ... } block", () => {
    const raw = 'Response: {"a":1,"b":2} — done';
    assert.deepEqual(extractJsonObject(raw), { a: 1, b: 2 });
  });

  it("handles nested braces", () => {
    const raw = '```json\n{"outer":{"inner":[1,2,3]}}\n```';
    assert.deepEqual(extractJsonObject(raw), { outer: { inner: [1, 2, 3] } });
  });

  it("handles braces inside string values without getting confused", () => {
    const raw = '{"template":"{{placeholder}}","value":42}';
    assert.deepEqual(extractJsonObject(raw), {
      template: "{{placeholder}}",
      value: 42,
    });
  });

  it("handles escaped quotes inside strings", () => {
    const raw = '{"q":"she said \\"hi\\"","n":1}';
    assert.deepEqual(extractJsonObject(raw), { q: 'she said "hi"', n: 1 });
  });

  it("falls back to bare scan when fenced content is invalid", () => {
    const raw = '```json\nnot valid json\n```\n{"recovered":true}';
    assert.deepEqual(extractJsonObject(raw), { recovered: true });
  });

  it("returns null when no object is present", () => {
    assert.equal(extractJsonObject("just prose, no json"), null);
  });

  it("returns null on unbalanced braces", () => {
    assert.equal(extractJsonObject("{ unterminated"), null);
  });
});

describe("isDailyArchivistOutput", () => {
  it("accepts a valid minimal output", () => {
    assert.equal(isDailyArchivistOutput({ dailySummaryMarkdown: "x", topicUpdates: [] }), true);
  });

  it("accepts topic updates with each valid action", () => {
    const out = {
      dailySummaryMarkdown: "x",
      topicUpdates: [
        { slug: "a", action: "create", content: "..." },
        { slug: "b", action: "append", content: "..." },
        { slug: "c", action: "rewrite", content: "..." },
      ],
    };
    assert.equal(isDailyArchivistOutput(out), true);
  });

  it("rejects missing dailySummaryMarkdown", () => {
    assert.equal(isDailyArchivistOutput({ topicUpdates: [] }), false);
  });

  it("rejects non-array topicUpdates", () => {
    assert.equal(isDailyArchivistOutput({ dailySummaryMarkdown: "x", topicUpdates: {} }), false);
  });

  it("rejects topic updates with an unknown action", () => {
    assert.equal(
      isDailyArchivistOutput({
        dailySummaryMarkdown: "x",
        topicUpdates: [{ slug: "a", action: "delete", content: "" }],
      }),
      false,
    );
  });

  it("rejects non-object input", () => {
    assert.equal(isDailyArchivistOutput(null), false);
    assert.equal(isDailyArchivistOutput("str"), false);
    assert.equal(isDailyArchivistOutput(42), false);
  });
});

describe("isOptimizationOutput", () => {
  it("accepts an empty valid output", () => {
    assert.equal(isOptimizationOutput({ merges: [], archives: [] }), true);
  });

  it("accepts a populated valid output", () => {
    assert.equal(
      isOptimizationOutput({
        merges: [{ from: ["a", "b"], into: "c", newContent: "..." }],
        archives: ["stale"],
      }),
      true,
    );
  });

  it("rejects merges with non-string from array elements", () => {
    assert.equal(
      isOptimizationOutput({
        merges: [{ from: [1, 2], into: "c", newContent: "..." }],
        archives: [],
      }),
      false,
    );
  });

  it("rejects archives with non-string entries", () => {
    assert.equal(isOptimizationOutput({ merges: [], archives: [1, 2] }), false);
  });

  it("rejects non-object input", () => {
    assert.equal(isOptimizationOutput(null), false);
  });
});
