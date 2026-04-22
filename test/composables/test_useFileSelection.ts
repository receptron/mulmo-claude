import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isValidFilePath, readPathMatch } from "../../src/composables/useFileSelection.ts";

// Full useFileSelection needs vue-router context; covered by e2e.
// Here we lock down the URL-path validator, which is the entry point
// for every externally-supplied `?path=` value.

describe("isValidFilePath", () => {
  it("accepts ordinary workspace-relative paths", () => {
    for (const path of ["a", "a.md", "notes/a.md", "deep/nested/path/file.json", "with-dashes_and.dots/file.txt", "spaces are fine.md", "unicode/日本語.md"]) {
      assert.equal(isValidFilePath(path), true, `path=${path}`);
    }
  });

  it("accepts filenames that contain '..' but aren't a traversal segment", () => {
    // Segment-wise check (#504-style): `my..notes.txt` is a legitimate
    // filename; `../secret` is not.
    assert.equal(isValidFilePath("my..notes.txt"), true);
    assert.equal(isValidFilePath("a/my..notes.txt"), true);
    assert.equal(isValidFilePath("file..tar.gz"), true);
  });

  it("rejects parent-directory segments", () => {
    for (const path of ["..", "../secret", "a/../b", "a/b/.."]) {
      assert.equal(isValidFilePath(path), false, `path=${path}`);
    }
  });

  it("rejects absolute paths (leading /)", () => {
    assert.equal(isValidFilePath("/etc/passwd"), false);
    assert.equal(isValidFilePath("/a.md"), false);
  });

  it("rejects empty string and non-string values", () => {
    for (const val of ["", null, undefined, 42, [], ["a"], {}, true, false]) {
      assert.equal(isValidFilePath(val), false, `value=${JSON.stringify(val)}`);
    }
  });
});

describe("readPathMatch", () => {
  it("joins array-form pathMatch with `/`", () => {
    assert.equal(readPathMatch(["a", "b", "c.md"]), "a/b/c.md");
    assert.equal(readPathMatch(["single"]), "single");
  });

  it("accepts a string-form pathMatch (single-segment route shape)", () => {
    // Some Vue Router code paths hand the catch-all back as a plain
    // string (e.g. SSR hydration edge cases). Support both shapes.
    assert.equal(readPathMatch("a/b/c.md"), "a/b/c.md");
    assert.equal(readPathMatch("x"), "x");
  });

  it("returns null for an empty pathMatch (the /files root)", () => {
    assert.equal(readPathMatch([]), null);
    assert.equal(readPathMatch(""), null);
  });

  it("returns null for undefined / non-string / non-array input", () => {
    for (const val of [undefined, null, 42, {}, true, false]) {
      assert.equal(readPathMatch(val), null, `value=${JSON.stringify(val)}`);
    }
  });

  it("preserves multi-byte segments (router already decoded them)", () => {
    assert.equal(readPathMatch(["unicode", "日本語.md"]), "unicode/日本語.md");
    assert.equal(readPathMatch(["with space.md"]), "with space.md");
  });
});
