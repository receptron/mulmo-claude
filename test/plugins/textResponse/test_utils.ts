import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractTextResponseTitle } from "../../../src/plugins/textResponse/utils.js";

describe("extractTextResponseTitle", () => {
  it("returns the first H1 when present", () => {
    const text = "# Project plan\n\nSome body text here.";
    assert.equal(extractTextResponseTitle(text), "Project plan");
  });

  it("falls through to first non-empty line when no H1 exists", () => {
    const text = "Plain reply text\nsecond line";
    assert.equal(extractTextResponseTitle(text), "Plain reply text");
  });

  it("skips leading blank lines", () => {
    const text = "\n\n  \n  Real content\nnext";
    assert.equal(extractTextResponseTitle(text), "Real content");
  });

  it("truncates long H1 to 50 chars", () => {
    const long = "A".repeat(80);
    const text = `# ${long}`;
    const result = extractTextResponseTitle(text);
    assert.equal(result.length, 50);
    assert.equal(result, "A".repeat(50));
  });

  it("truncates long plain line to 50 chars", () => {
    const long = "B".repeat(80);
    const result = extractTextResponseTitle(long);
    assert.equal(result.length, 50);
    assert.equal(result, "B".repeat(50));
  });

  it("returns empty string for empty input", () => {
    assert.equal(extractTextResponseTitle(""), "");
  });

  it("returns empty string for whitespace-only input", () => {
    assert.equal(extractTextResponseTitle("   \n  \n\t"), "");
  });

  it("preserves unicode in the extracted title", () => {
    const text = "# プロジェクト概要\n\nbody";
    assert.equal(extractTextResponseTitle(text), "プロジェクト概要");
  });

  it("ignores H2 / H3 — only matches H1", () => {
    const text = "## Subhead\nFirst real line";
    assert.equal(extractTextResponseTitle(text), "## Subhead");
  });
});
