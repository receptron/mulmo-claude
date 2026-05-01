// Unit tests for `containsDotfileSegment` — the dotfile-deny helper
// applied by the `/artifacts/html` HTML branch in `server/index.ts`.
// Codex review on PR #1082 flagged a Windows-side bypass: when a URL
// like `/artifacts/html/dir%5C.hidden.html` is decoded, the resulting
// `dir\.hidden.html` splits to a single segment under the old
// `split("/")` check, so the guard misses it — but `path.normalize`
// in `resolveWithinRoot` later treats `\` as a separator on Windows
// and the dotfile would still resolve. The helper now splits on both
// `/` and `\`, so this test fixes the bypass at the source.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { containsDotfileSegment } from "../../../server/utils/files/safe.ts";

describe("containsDotfileSegment", () => {
  it("returns false for a clean path with no dot-prefixed segment", () => {
    assert.equal(containsDotfileSegment("dir/page.html"), false);
    assert.equal(containsDotfileSegment("a/b/c/file.png"), false);
  });

  it("flags a leading dotfile segment", () => {
    assert.equal(containsDotfileSegment(".hidden.html"), true);
  });

  it("flags a dotfile in any deeper segment", () => {
    assert.equal(containsDotfileSegment("dir/.hidden/page.html"), true);
    assert.equal(containsDotfileSegment("a/b/.git/config"), true);
  });

  it("flags a dotfile after a backslash separator (Windows / encoded `%5C`)", () => {
    // The Codex finding: decodeURIComponent of `dir%5C.hidden.html`
    // produces `dir\.hidden.html`. The pre-fix guard split only on
    // `/` and missed it, while `path.normalize` on Windows would
    // later turn it into `dir/.hidden.html`.
    assert.equal(containsDotfileSegment("dir\\.hidden.html"), true);
  });

  it("flags mixed-separator dotfile paths", () => {
    assert.equal(containsDotfileSegment("a/b\\.x/c"), true);
    assert.equal(containsDotfileSegment("a\\b/.x/c"), true);
  });

  it("does NOT flag a literal dot in the middle of a filename", () => {
    // Only segments that START with `.` are dotfiles. `foo.html`,
    // `name.with.dots.txt` etc. are normal files.
    assert.equal(containsDotfileSegment("dir/foo.html"), false);
    assert.equal(containsDotfileSegment("name.with.dots.txt"), false);
    assert.equal(containsDotfileSegment("a/b/file.tar.gz"), false);
  });

  it("flags `.` and `..` traversal segments", () => {
    // The helper exists primarily for dotfile-deny, but `..` and `.`
    // happen to be caught too — they're separately handled by
    // `resolveWithinRoot`'s realpath check, but defense-in-depth.
    assert.equal(containsDotfileSegment("a/../etc"), true);
    assert.equal(containsDotfileSegment("./foo"), true);
  });

  it("returns false for an empty string", () => {
    // Guard the trivial case so callers don't have to.
    assert.equal(containsDotfileSegment(""), false);
  });
});
