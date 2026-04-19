import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildUserPrompt,
  parseExtractedFacts,
  appendFacts,
  filterNewFacts,
} from "../../server/workspace/journal/memoryExtractor.js";

describe("parseExtractedFacts", () => {
  it("parses bullet-point lines", () => {
    const raw = "- Likes curry\n- Drives a Tesla\n- Lives in Kochi";
    assert.deepEqual(parseExtractedFacts(raw), [
      "- Likes curry",
      "- Drives a Tesla",
      "- Lives in Kochi",
    ]);
  });

  it("returns empty array for NONE", () => {
    assert.deepEqual(parseExtractedFacts("NONE"), []);
  });

  it("returns empty array for empty string", () => {
    assert.deepEqual(parseExtractedFacts(""), []);
  });

  it("filters out non-bullet lines", () => {
    const raw =
      "Here are the facts:\n- Likes sushi\nSome explanation\n- Has a dog";
    assert.deepEqual(parseExtractedFacts(raw), [
      "- Likes sushi",
      "- Has a dog",
    ]);
  });

  it("filters out very short bullets (just dash + space)", () => {
    const raw = "- \n- OK\n- Likes coffee";
    // "- OK" (4 chars) passes the >3 threshold; "- " (2 chars) does not.
    assert.deepEqual(parseExtractedFacts(raw), ["- OK", "- Likes coffee"]);
  });

  it("trims whitespace", () => {
    const raw = "  - Plays piano  \n  - Runs on Sundays  ";
    assert.deepEqual(parseExtractedFacts(raw), [
      "- Plays piano",
      "- Runs on Sundays",
    ]);
  });
});

describe("buildUserPrompt", () => {
  it("includes existing memory and excerpts", () => {
    const prompt = buildUserPrompt("- Likes curry", "User: I play piano");
    assert.ok(prompt.includes("Already known"));
    assert.ok(prompt.includes("- Likes curry"));
    assert.ok(prompt.includes("I play piano"));
  });

  it("omits 'Already known' header section when memory is empty", () => {
    const prompt = buildUserPrompt("", "User: hello");
    // The "Already known" header (with the colon + content) should
    // not appear, but the instruction line may mention the phrase.
    assert.ok(!prompt.includes("## Already known"));
    assert.ok(prompt.includes("User: hello"));
  });
});

describe("appendFacts", () => {
  it("appends to existing content", () => {
    const result = appendFacts("# Memory\n\n- Old fact", ["- New fact"]);
    assert.ok(result.includes("- Old fact"));
    assert.ok(result.includes("- New fact"));
    assert.ok(result.endsWith("\n"));
  });

  it("creates header when memory is empty", () => {
    const result = appendFacts("", ["- First fact"]);
    assert.ok(result.startsWith("# Memory"));
    assert.ok(result.includes("- First fact"));
  });

  it("joins multiple facts with newlines", () => {
    const result = appendFacts("# Memory\n", [
      "- Fact A",
      "- Fact B",
      "- Fact C",
    ]);
    assert.ok(result.includes("- Fact A\n- Fact B\n- Fact C"));
  });
});

describe("filterNewFacts", () => {
  it("removes facts already in existing memory", () => {
    const existing = "# Memory\n\n- Likes curry\n- Lives in Kochi\n";
    const newFacts = ["- Likes curry", "- Plays piano", "- Lives in Kochi"];
    assert.deepEqual(filterNewFacts(existing, newFacts), ["- Plays piano"]);
  });

  it("is case-insensitive", () => {
    const existing = "- likes CURRY\n";
    assert.deepEqual(filterNewFacts(existing, ["- Likes curry"]), []);
  });

  it("deduplicates within the new facts themselves", () => {
    assert.deepEqual(filterNewFacts("", ["- Fact A", "- Fact A", "- Fact B"]), [
      "- Fact A",
      "- Fact B",
    ]);
  });

  it("returns all facts when memory is empty", () => {
    const facts = ["- Fact X", "- Fact Y"];
    assert.deepEqual(filterNewFacts("", facts), facts);
  });
});
