import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildClassifyPrompt,
  parseClassifyOutput,
  validateClassifyResult,
  classifySource,
  type ClassifyFn,
  type ClassifyInput,
} from "../../server/workspace/sources/classifier.js";

// --- buildClassifyPrompt -----------------------------------------------

describe("buildClassifyPrompt — shape", () => {
  it("always includes title + url", () => {
    const prompt = buildClassifyPrompt({
      title: "Hacker News",
      url: "https://news.ycombinator.com/rss",
    });
    assert.match(prompt, /TITLE: Hacker News/);
    assert.match(prompt, /URL: https:\/\/news\.ycombinator\.com\/rss/);
  });

  it("includes user notes when provided", () => {
    const prompt = buildClassifyPrompt({
      title: "t",
      url: "https://x.com",
      notes: "Registered because I track launches here.",
    });
    assert.match(prompt, /USER NOTES:/);
    assert.match(prompt, /launches/);
  });

  it("does not include USER NOTES block when notes is empty / whitespace", () => {
    const prompt = buildClassifyPrompt({
      title: "t",
      url: "https://x.com",
      notes: "   \n   ",
    });
    assert.doesNotMatch(prompt, /USER NOTES/);
  });

  it("truncates long notes to 400 chars", () => {
    const prompt = buildClassifyPrompt({
      title: "t",
      url: "https://x.com",
      notes: "x".repeat(1000),
    });
    // Count only the chars inside the notes body.
    const notesMatch = /USER NOTES:\n([\s\S]*)$/.exec(prompt);
    assert.ok(notesMatch);
    assert.ok(notesMatch![1].length <= 400);
  });

  it("includes up to 5 sample titles", () => {
    const prompt = buildClassifyPrompt({
      title: "t",
      url: "https://x.com",
      sampleTitles: Array.from({ length: 10 }, (_, i) => `title ${i}`),
    });
    assert.match(prompt, /RECENT ITEM TITLES:/);
    // First 5 should appear.
    for (let i = 0; i < 5; i++) {
      assert.match(prompt, new RegExp(`- title ${i}`));
    }
    // 5th-index and beyond should NOT.
    for (let i = 5; i < 10; i++) {
      assert.doesNotMatch(prompt, new RegExp(`- title ${i}`));
    }
  });

  it("includes up to 3 sample summaries, collapsed to one line each", () => {
    const prompt = buildClassifyPrompt({
      title: "t",
      url: "https://x.com",
      sampleSummaries: ["Line one.\n\nLine two (should collapse).", "Another\t\twith tabs", "Third", "Fourth (should be cut)"],
    });
    assert.match(prompt, /RECENT ITEM SUMMARIES:/);
    // Multi-line summary should be collapsed to single line.
    assert.doesNotMatch(prompt, /Line one\.\n\nLine two/);
    assert.match(prompt, /Line one\. Line two/);
    // Tabs collapsed too.
    assert.doesNotMatch(prompt, /Another\t\twith/);
    // Fourth item dropped (cap at 3).
    assert.doesNotMatch(prompt, /Fourth/);
  });

  it("truncates each summary to 200 chars", () => {
    const prompt = buildClassifyPrompt({
      title: "t",
      url: "https://x.com",
      sampleSummaries: ["x".repeat(500)],
    });
    const summaryLineMatch = /RECENT ITEM SUMMARIES:\n- (x+)/.exec(prompt);
    assert.ok(summaryLineMatch);
    assert.ok(summaryLineMatch![1].length <= 200);
  });

  it("omits sample sections when arrays are empty", () => {
    const prompt = buildClassifyPrompt({
      title: "t",
      url: "https://x.com",
      sampleTitles: [],
      sampleSummaries: [],
    });
    assert.doesNotMatch(prompt, /RECENT ITEM TITLES/);
    assert.doesNotMatch(prompt, /RECENT ITEM SUMMARIES/);
  });
});

// --- validateClassifyResult --------------------------------------------

describe("validateClassifyResult — happy path", () => {
  it("returns a result for a well-formed object", () => {
    const out = validateClassifyResult({
      categories: ["ai", "papers"],
      rationale: "arXiv cs.CL feed — AI research papers.",
    });
    assert.deepEqual(out.categories, ["ai", "papers"]);
    assert.match(out.rationale, /arXiv/);
  });

  it("drops invalid category slugs but keeps valid ones", () => {
    const out = validateClassifyResult({
      categories: ["ai", "artificial-intelligence", "security", "made-up"],
      rationale: "",
    });
    // Only the valid slugs survive.
    assert.deepEqual(out.categories, ["ai", "security"]);
  });

  it("deduplicates categories in output", () => {
    const out = validateClassifyResult({
      categories: ["ai", "ai", "security"],
      rationale: "",
    });
    assert.deepEqual(out.categories, ["ai", "security"]);
  });

  it("truncates long rationale to 400 chars", () => {
    const out = validateClassifyResult({
      categories: ["ai"],
      rationale: "x".repeat(1000),
    });
    assert.ok(out.rationale.length <= 400);
  });

  it("coerces missing rationale to empty string", () => {
    const out = validateClassifyResult({
      categories: ["ai"],
    });
    assert.equal(out.rationale, "");
  });
});

describe("validateClassifyResult — error cases", () => {
  it("throws when the output is not an object", () => {
    assert.throws(() => validateClassifyResult(null), /not an object/);
    assert.throws(() => validateClassifyResult("str"), /not an object/);
    assert.throws(() => validateClassifyResult([1, 2]), /not an object/);
  });

  it("throws when categories is missing", () => {
    assert.throws(() => validateClassifyResult({ rationale: "r" }), /no valid categories/);
  });

  it("throws when every category is invalid (no hallucinated slugs survive)", () => {
    assert.throws(
      () =>
        validateClassifyResult({
          categories: ["ARTIFICIAL-INTELLIGENCE", "made-up"],
          rationale: "",
        }),
      /no valid categories/,
    );
  });

  it("throws when categories is not an array", () => {
    assert.throws(() => validateClassifyResult({ categories: "ai", rationale: "" }), /no valid categories/);
  });
});

// --- parseClassifyOutput -----------------------------------------------

describe("parseClassifyOutput", () => {
  it("returns the result on a success envelope", () => {
    const stdout = JSON.stringify({
      structured_output: {
        categories: ["ai", "papers"],
        rationale: "arXiv CL.",
      },
    });
    const out = parseClassifyOutput(stdout);
    assert.deepEqual(out.categories, ["ai", "papers"]);
  });

  it("throws on the claude error envelope", () => {
    const stdout = JSON.stringify({
      is_error: true,
      result: "rate limited",
    });
    assert.throws(() => parseClassifyOutput(stdout), /rate limited/);
  });

  it("throws on unparseable stdout", () => {
    assert.throws(() => parseClassifyOutput("{ not json"), /failed to parse claude json/);
  });

  it("throws when structured_output has no valid categories", () => {
    const stdout = JSON.stringify({
      structured_output: {
        categories: ["made-up"],
        rationale: "",
      },
    });
    assert.throws(() => parseClassifyOutput(stdout), /no valid categories/);
  });
});

// --- classifySource -----------------------------------------------------

describe("classifySource — injection wrapper", () => {
  it("passes the input through to the injected ClassifyFn", async () => {
    // Capture inputs via an array — TS can't track a scalar `let`
    // reassigned inside an async callback (narrows to `never` after
    // the declaration), but an array reference is stable.
    const captured: ClassifyInput[] = [];
    const classify: ClassifyFn = async (input) => {
      captured.push(input);
      return {
        categories: ["ai"],
        rationale: "fake",
      };
    };
    const out = await classifySource(
      {
        title: "Test",
        url: "https://example.com",
        sampleTitles: ["a", "b"],
      },
      classify,
    );
    assert.equal(captured.length, 1);
    assert.equal(captured[0].title, "Test");
    assert.deepEqual(captured[0].sampleTitles, ["a", "b"]);
    assert.deepEqual(out.categories, ["ai"]);
  });

  it("propagates errors from the ClassifyFn", async () => {
    const classify: ClassifyFn = async () => {
      throw new Error("claude unreachable");
    };
    await assert.rejects(() => classifySource({ title: "t", url: "https://x.com" }, classify), /claude unreachable/);
  });
});
