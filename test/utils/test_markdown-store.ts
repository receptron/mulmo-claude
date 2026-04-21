// Unit tests for the pure helper `isMarkdownPath` in markdown-store.ts.
// The async I/O functions (saveMarkdown, loadMarkdown, overwriteMarkdown)
// are skipped — they require real filesystem writes under the workspace.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isMarkdownPath } from "../../server/utils/files/markdown-store.js";

describe("isMarkdownPath", () => {
  it("accepts a canonical workspace-relative markdown path", () => {
    assert.equal(isMarkdownPath("artifacts/documents/abc123.md"), true);
  });

  it("accepts a UUID-like filename", () => {
    assert.equal(isMarkdownPath("artifacts/documents/a1b2c3d4e5f6g7h8.md"), true);
  });

  it("accepts a path with nested subdirectory", () => {
    assert.equal(isMarkdownPath("artifacts/documents/sub/note.md"), true);
  });

  it("rejects non-documents prefixes", () => {
    assert.equal(isMarkdownPath("artifacts/images/foo.md"), false);
    assert.equal(isMarkdownPath("documents/foo.md"), false);
    assert.equal(isMarkdownPath("foo.md"), false);
  });

  it("rejects the old pre-#284 markdowns/ prefix", () => {
    assert.equal(isMarkdownPath("markdowns/foo.md"), false);
  });

  it("rejects non-.md suffixes", () => {
    assert.equal(isMarkdownPath("artifacts/documents/foo.txt"), false);
    assert.equal(isMarkdownPath("artifacts/documents/foo.json"), false);
    assert.equal(isMarkdownPath("artifacts/documents/foo"), false);
  });

  it("rejects empty string", () => {
    assert.equal(isMarkdownPath(""), false);
  });

  it("rejects the prefix alone (no filename)", () => {
    assert.equal(isMarkdownPath("artifacts/documents/"), false);
  });

  it("rejects a path that only starts with the prefix but has no .md", () => {
    assert.equal(isMarkdownPath("artifacts/documents/readme"), false);
  });

  it("rejects when prefix is a substring of a longer segment", () => {
    assert.equal(isMarkdownPath("xartifacts/documents/foo.md"), false);
  });
});
