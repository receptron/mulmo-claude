// Server-side mirror of test/utils/markdown/test_frontmatter.ts
// (#895 PR B). Pin the same parse/serialize/merge contract on the
// server because writeWikiPage will round-trip through the same
// helpers and any drift between Vue and server breaks #763's
// edit-history pipeline.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeFrontmatter, parseFrontmatter, serializeWithFrontmatter } from "../../../../server/utils/markdown/frontmatter.js";

describe("server parseFrontmatter — happy path", () => {
  it("splits a well-formed envelope into meta + body", () => {
    const raw = "---\ntitle: Hello\ncreated: 2026-04-27\n---\n\nbody text\n";
    const out = parseFrontmatter(raw);
    assert.equal(out.hasHeader, true);
    assert.deepEqual(out.meta, { title: "Hello", created: "2026-04-27" });
    assert.equal(out.body, "body text\n");
  });

  it("preserves insertion order in meta", () => {
    const raw = "---\nzeta: 1\nalpha: 2\nmiddle: 3\n---\nbody";
    const out = parseFrontmatter(raw);
    assert.deepEqual(Object.keys(out.meta), ["zeta", "alpha", "middle"]);
  });

  it("parses inline arrays and block-list arrays", () => {
    const inline = parseFrontmatter("---\ntags: [a, b, c]\n---\nbody");
    assert.deepEqual(inline.meta.tags, ["a", "b", "c"]);
    const block = parseFrontmatter("---\ntags:\n  - one\n  - two\n---\nbody");
    assert.deepEqual(block.meta.tags, ["one", "two"]);
  });

  it("handles unicode (CJK) keys and values", () => {
    const raw = "---\ntitle: さくらインターネット\ntags: [クラウド, インフラ]\n---\nbody";
    const out = parseFrontmatter(raw);
    assert.equal(out.meta.title, "さくらインターネット");
    assert.deepEqual(out.meta.tags, ["クラウド", "インフラ"]);
  });

  it("accepts \\r\\n line endings (Windows-authored files)", () => {
    const raw = "---\r\ntitle: WinFile\r\n---\r\n\r\nbody\r\n";
    const out = parseFrontmatter(raw);
    assert.equal(out.hasHeader, true);
    assert.equal(out.meta.title, "WinFile");
  });
});

describe("server parseFrontmatter — degenerate cases", () => {
  it("returns empty meta + raw body when no envelope present", () => {
    const raw = "no header here\n\njust body\n";
    const out = parseFrontmatter(raw);
    assert.equal(out.hasHeader, false);
    assert.deepEqual(out.meta, {});
    assert.equal(out.body, raw);
  });

  it("treats an unclosed envelope as no header (graceful fallback)", () => {
    const raw = "---\ntitle: Stuck\n\nbody but no closing fence\n";
    const out = parseFrontmatter(raw);
    assert.equal(out.hasHeader, false);
  });

  it("treats malformed YAML as no header — does not throw", () => {
    const raw = "---\ntitle: [unclosed\n---\nbody";
    const out = parseFrontmatter(raw);
    assert.equal(out.hasHeader, false);
  });

  it("treats scalar-only / array-only frontmatter as malformed", () => {
    const out = parseFrontmatter("---\njust a string\n---\nbody");
    assert.equal(out.hasHeader, false);
  });

  it("accepts an empty envelope as hasHeader: true with empty meta", () => {
    const out = parseFrontmatter("---\n---\n\nbody\n");
    assert.equal(out.hasHeader, true);
    assert.deepEqual(out.meta, {});
    assert.equal(out.body, "body\n");
  });

  it("returns empty body when the document is header-only", () => {
    const out = parseFrontmatter("---\ntitle: Hello\n---\n");
    assert.equal(out.hasHeader, true);
    assert.equal(out.body, "");
  });
});

describe("server parseFrontmatter — FAILSAFE schema", () => {
  it("preserves numeric-looking strings verbatim", () => {
    const out = parseFrontmatter("---\nversion: 1.20\nzeros: 00123\n---\nbody");
    assert.equal(out.meta.version, "1.20");
    assert.equal(out.meta.zeros, "00123");
  });

  it("keeps numeric / boolean scalars as strings", () => {
    const out = parseFrontmatter("---\ncount: 5\nenabled: true\n---\nbody");
    assert.equal(out.meta.count, "5");
    assert.equal(out.meta.enabled, "true");
  });
});

describe("server serializeWithFrontmatter", () => {
  it("emits envelope + blank line + body", () => {
    const out = serializeWithFrontmatter({ title: "Hello", tags: ["a", "b"] }, "body text\n");
    const round = parseFrontmatter(out);
    assert.equal(round.hasHeader, true);
    assert.equal(round.meta.title, "Hello");
    assert.deepEqual(round.meta.tags, ["a", "b"]);
    assert.equal(round.body, "body text\n");
  });

  it("returns body verbatim when meta is empty", () => {
    assert.equal(serializeWithFrontmatter({}, "just body\n"), "just body\n");
  });

  it("round-trip is value-preserving for ambiguous scalars", () => {
    const original = "---\nversion: 1.20\nflag: true\n---\nbody";
    const round1 = parseFrontmatter(original);
    const text2 = serializeWithFrontmatter(round1.meta, round1.body);
    const round2 = parseFrontmatter(text2);
    assert.equal(round2.meta.version, "1.20");
    assert.equal(round2.meta.flag, "true");
    // One more cycle — meta is a fixed point.
    const text3 = serializeWithFrontmatter(round2.meta, round2.body);
    const round3 = parseFrontmatter(text3);
    assert.deepEqual(round3.meta, round2.meta);
  });
});

describe("server mergeFrontmatter", () => {
  it("overwrites known keys with patch values", () => {
    const out = mergeFrontmatter({ title: "Old", tags: ["a"] }, { title: "New" });
    assert.equal(out.title, "New");
    assert.deepEqual(out.tags, ["a"]);
  });

  it("preserves keys not mentioned in the patch", () => {
    // Custom domain field (e.g. `prerequisites` from a skill file)
    // must survive a generic update that only touches `updated`.
    const out = mergeFrontmatter({ prerequisites: "Node 22+", title: "Doc" }, { updated: "2026-04-27" });
    assert.equal(out.prerequisites, "Node 22+");
    assert.equal(out.updated, "2026-04-27");
  });

  it("deletes a key when the patch value is null or undefined", () => {
    const fromNull = mergeFrontmatter({ title: "Doc", deprecated: true }, { deprecated: null });
    assert.equal("deprecated" in fromNull, false);
    const fromUndef = mergeFrontmatter({ title: "Doc", legacy: "yes" }, { legacy: undefined });
    assert.equal("legacy" in fromUndef, false);
  });

  it("returns a new object (no mutation)", () => {
    const existing = { title: "Doc" };
    const out = mergeFrontmatter(existing, { updated: "now" });
    assert.notStrictEqual(out, existing);
    assert.equal("updated" in existing, false);
  });
});
