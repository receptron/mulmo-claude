// Locks the behaviour the wiki read-engine relies on now that the
// `---\n…\n---\n` parser is single-sourced on
// `@mulmoclaude/markdown-utils` (#2410). The generic split cases are
// covered in markdown-utils' own test_frontmatter.ts; here we pin the
// wiki-specific `tags:` reader and the envelope edge cases the wiki
// engine depended on (no header, empty envelope, CRLF, malformed YAML).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter, parseFrontmatterTags } from "../../src/wiki/server/frontmatter.ts";

describe("parseFrontmatter (delegated to markdown-utils)", () => {
  it("returns hasHeader:false and the raw body when there is no envelope", () => {
    const raw = "# Just a body\n\nno header here";
    const parsed = parseFrontmatter(raw);
    assert.equal(parsed.hasHeader, false);
    assert.deepEqual(parsed.meta, {});
    assert.equal(parsed.body, raw);
  });

  it("parses a well-formed envelope and strips it from the body", () => {
    const parsed = parseFrontmatter("---\ntitle: Home\n---\n\n# Body");
    assert.equal(parsed.hasHeader, true);
    assert.equal(parsed.meta.title, "Home");
    assert.equal(parsed.body, "# Body");
  });

  it("treats an empty envelope as a header with no metadata", () => {
    const parsed = parseFrontmatter("---\n---\nbody");
    assert.equal(parsed.hasHeader, true);
    assert.deepEqual(parsed.meta, {});
    assert.equal(parsed.body, "body");
  });

  it("handles CRLF fences", () => {
    const parsed = parseFrontmatter("---\r\ntitle: Home\r\n---\r\nbody");
    assert.equal(parsed.hasHeader, true);
    assert.equal(parsed.meta.title, "Home");
  });

  it("keeps numeric-looking scalars as strings (FAILSAFE_SCHEMA)", () => {
    const parsed = parseFrontmatter("---\nversion: 1.20\n---\nbody");
    assert.equal(parsed.meta.version, "1.20");
  });

  it("falls back to no-header on malformed YAML inside the envelope", () => {
    const parsed = parseFrontmatter("---\ntitle: : :\n bad\n---\nbody");
    assert.equal(parsed.hasHeader, false);
    assert.deepEqual(parsed.meta, {});
  });
});

describe("parseFrontmatterTags", () => {
  it("returns [] when there is no frontmatter", () => {
    assert.deepEqual(parseFrontmatterTags("# body only"), []);
  });

  it("returns [] for an empty envelope", () => {
    assert.deepEqual(parseFrontmatterTags("---\n---\nbody"), []);
  });

  it("returns [] when the header has no tags key", () => {
    assert.deepEqual(parseFrontmatterTags("---\ntitle: Home\n---\nbody"), []);
  });

  it("reads block-list tags", () => {
    const content = "---\ntags:\n  - alpha\n  - beta\n---\nbody";
    assert.deepEqual(parseFrontmatterTags(content), ["alpha", "beta"]);
  });

  it("reads flow-style tags", () => {
    assert.deepEqual(parseFrontmatterTags("---\ntags: [alpha, beta]\n---\nbody"), ["alpha", "beta"]);
  });

  it("reads tags across CRLF fences", () => {
    const content = "---\r\ntags:\r\n  - alpha\r\n  - beta\r\n---\r\nbody";
    assert.deepEqual(parseFrontmatterTags(content), ["alpha", "beta"]);
  });

  it("strips quotes, leading '#', and lowercases each token", () => {
    const content = "---\ntags:\n  - '#Alpha'\n  - \"BETA\"\n  - Gamma\n---\nbody";
    assert.deepEqual(parseFrontmatterTags(content), ["alpha", "beta", "gamma"]);
  });

  it("drops empty tokens and non-string items", () => {
    const content = "---\ntags:\n  - alpha\n  - ''\n  - 42\n---\nbody";
    // FAILSAFE_SCHEMA keeps `42` a string, so it survives as \"42\"; the
    // empty-string token is dropped. Only genuinely non-string YAML nodes
    // (maps/sequences) would be filtered by the type guard.
    assert.deepEqual(parseFrontmatterTags(content), ["alpha", "42"]);
  });

  it("returns [] when tags is a scalar rather than a list", () => {
    assert.deepEqual(parseFrontmatterTags("---\ntags: alpha\n---\nbody"), []);
  });

  it("returns [] on malformed YAML in the envelope", () => {
    assert.deepEqual(parseFrontmatterTags("---\ntags: : :\n bad\n---\nbody"), []);
  });
});
