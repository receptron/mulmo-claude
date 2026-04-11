import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractFirstH1 } from "../../server/journal/index.js";

describe("extractFirstH1", () => {
  it("returns the first H1 heading text", () => {
    const md = "intro\n# Video Generation\nmore body";
    assert.equal(extractFirstH1(md), "Video Generation");
  });

  it("prefers the first H1 even when later ones exist", () => {
    const md = "# First\ntext\n# Second";
    assert.equal(extractFirstH1(md), "First");
  });

  it("ignores H2 and deeper headings", () => {
    const md = "## Not an H1\n### Also not\n# Actual H1";
    assert.equal(extractFirstH1(md), "Actual H1");
  });

  it("returns null when no H1 is present", () => {
    assert.equal(extractFirstH1("## Only H2\ntext"), null);
    assert.equal(extractFirstH1("plain body no heading"), null);
  });

  it("trims trailing whitespace from the heading", () => {
    assert.equal(extractFirstH1("#   spaced heading   "), "spaced heading");
  });

  it("handles empty input", () => {
    assert.equal(extractFirstH1(""), null);
  });
});
