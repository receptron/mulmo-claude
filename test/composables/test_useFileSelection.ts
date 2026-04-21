import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isValidFilePath } from "../../src/composables/useFileSelection.ts";

// Full useFileSelection needs vue-router context; covered by e2e.
// Here we lock down the URL-path validator, which is the entry point
// for every externally-supplied `?path=` value.

describe("isValidFilePath", () => {
  it("accepts ordinary workspace-relative paths", () => {
    for (const p of [
      "a",
      "a.md",
      "notes/a.md",
      "deep/nested/path/file.json",
      "with-dashes_and.dots/file.txt",
      "spaces are fine.md",
      "unicode/日本語.md",
    ]) {
      assert.equal(isValidFilePath(p), true, `path=${p}`);
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
    for (const p of ["..", "../secret", "a/../b", "a/b/.."]) {
      assert.equal(isValidFilePath(p), false, `path=${p}`);
    }
  });

  it("rejects absolute paths (leading /)", () => {
    assert.equal(isValidFilePath("/etc/passwd"), false);
    assert.equal(isValidFilePath("/a.md"), false);
  });

  it("rejects empty string and non-string values", () => {
    for (const v of ["", null, undefined, 42, [], ["a"], {}, true, false]) {
      assert.equal(isValidFilePath(v), false, `value=${JSON.stringify(v)}`);
    }
  });
});
