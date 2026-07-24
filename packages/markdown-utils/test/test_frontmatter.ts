import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { splitFrontmatter } from "../src/markdown/frontmatter.js";

describe("splitFrontmatter", () => {
  it("splits a document with a frontmatter envelope into prefix + body", () => {
    const raw = "---\ntitle: Home\ntags:\n  - a\n---\n\n# Body\n\ntext";
    const { prefix, body } = splitFrontmatter(raw);
    assert.equal(prefix, "---\ntitle: Home\ntags:\n  - a\n---\n\n");
    assert.equal(body, "# Body\n\ntext");
  });

  it("round-trips: prefix + body reproduces the input exactly", () => {
    const raw = "---\ntitle: Home\n---\nbody line 1\nbody line 2\n";
    const { prefix, body } = splitFrontmatter(raw);
    assert.equal(prefix + body, raw);
  });

  it("returns an empty prefix when the document has no frontmatter", () => {
    const raw = "# Just a body\n\nno header here";
    const { prefix, body } = splitFrontmatter(raw);
    assert.equal(prefix, "");
    assert.equal(body, raw);
  });

  it("treats a malformed (unclosed) envelope as no frontmatter", () => {
    const raw = "---\ntitle: Home\nno closing fence\n\nbody";
    const { prefix, body } = splitFrontmatter(raw);
    assert.equal(prefix, "");
    assert.equal(body, raw);
    assert.equal(prefix + body, raw);
  });

  it("handles an empty frontmatter envelope", () => {
    const raw = "---\n---\nbody";
    const { prefix, body } = splitFrontmatter(raw);
    assert.equal(body, "body");
    assert.equal(prefix + body, raw);
  });

  it("returns empty prefix and body for an empty string", () => {
    const { prefix, body } = splitFrontmatter("");
    assert.equal(prefix, "");
    assert.equal(body, "");
  });
});
