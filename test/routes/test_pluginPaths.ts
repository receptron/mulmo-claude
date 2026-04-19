import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isMarkdownPath } from "../../server/utils/files/markdown-store.js";
import { isSpreadsheetPath } from "../../server/utils/files/spreadsheet-store.js";

// isMarkdownPath tests — the markdown-store counterpart to the
// spreadsheet-store tests already in test/utils/test_spreadsheet-store.ts.
// Both functions are used as validation gates in server/api/routes/plugins.ts
// PUT handlers, so exercising them together here covers the route layer's
// path-checking logic.

describe("isMarkdownPath", () => {
  it("accepts a canonical markdown path", () => {
    assert.equal(isMarkdownPath("artifacts/documents/abc123.md"), true);
  });

  it("accepts a UUID-like filename", () => {
    assert.equal(
      isMarkdownPath("artifacts/documents/a1b2c3d4e5f67890.md"),
      true,
    );
  });

  it("rejects non-markdown prefixes", () => {
    assert.equal(isMarkdownPath("artifacts/images/foo.md"), false);
    assert.equal(isMarkdownPath("documents/foo.md"), false);
    assert.equal(isMarkdownPath("markdowns/foo.md"), false);
    assert.equal(isMarkdownPath("foo.md"), false);
  });

  it("rejects non-.md extensions", () => {
    assert.equal(isMarkdownPath("artifacts/documents/foo.json"), false);
    assert.equal(isMarkdownPath("artifacts/documents/foo.txt"), false);
    assert.equal(isMarkdownPath("artifacts/documents/foo.png"), false);
  });

  it("rejects empty string", () => {
    assert.equal(isMarkdownPath(""), false);
  });

  it("rejects path with only the prefix", () => {
    assert.equal(isMarkdownPath("artifacts/documents/"), false);
  });
});

// Cross-check: isSpreadsheetPath rejects traversal that isMarkdownPath
// does not catch (since isMarkdownPath is prefix+suffix only). This
// confirms the two functions have different strictness levels.
describe("isSpreadsheetPath vs isMarkdownPath — traversal awareness", () => {
  it("isSpreadsheetPath rejects path-normalized traversal", () => {
    assert.equal(
      isSpreadsheetPath("artifacts/spreadsheets/../spreadsheets/f.json"),
      false,
    );
  });

  it("isSpreadsheetPath rejects double-dot segments", () => {
    assert.equal(
      isSpreadsheetPath("artifacts/spreadsheets/../../etc/passwd.json"),
      false,
    );
  });

  it("isMarkdownPath accepts prefix+suffix but relies on server-side safeResolve for traversal", () => {
    // This path has the right prefix and suffix, but contains ".."
    // isMarkdownPath only checks prefix+suffix, so this would pass.
    // The actual security gate is the server-side safeResolve call.
    const suspicious = "artifacts/documents/../documents/f.md";
    // Whether this is true or false depends on prefix match — the
    // prefix still matches so isMarkdownPath returns true.
    assert.equal(isMarkdownPath(suspicious), true);
  });
});
