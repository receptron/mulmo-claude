import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stripHtmlToPreview } from "../../../src/plugins/presentHtml/helpers.js";

describe("stripHtmlToPreview", () => {
  it("removes tags and keeps the inner text", () => {
    assert.equal(stripHtmlToPreview("<b>hello</b>", 60), "hello");
  });

  it("inserts a space where a tag sat between two text runs", () => {
    assert.equal(stripHtmlToPreview("hello<br>world", 60), "hello world");
  });

  it("collapses runs of whitespace into a single space", () => {
    assert.equal(stripHtmlToPreview("a    b\n\n\tc", 60), "a b c");
  });

  it("trims leading and trailing whitespace", () => {
    assert.equal(stripHtmlToPreview("   hello   ", 60), "hello");
  });

  it("trims away a leading or trailing tag cleanly", () => {
    assert.equal(stripHtmlToPreview("<p>hello</p>", 60), "hello", "leading+trailing tags should not leave stray spaces");
  });

  it("collapses empty tag pairs to an empty string", () => {
    assert.equal(stripHtmlToPreview("<b></b>", 60), "");
  });

  it("truncates to the requested length", () => {
    const longText = "word ".repeat(100); // 500 chars
    assert.equal(stripHtmlToPreview(longText, 10).length, 10);
  });

  it("returns empty string for empty input", () => {
    assert.equal(stripHtmlToPreview("", 60), "");
  });

  it("returns empty string for all-whitespace input", () => {
    assert.equal(stripHtmlToPreview("   \n\t  ", 60), "");
  });

  it("returns empty string for a document with only tags", () => {
    assert.equal(stripHtmlToPreview("<div><span></span></div>", 60), "");
  });

  it("keeps a bare `<` with no later `>` as a literal character", () => {
    // This matches the old `/<[^>]*>/g` regex, which only stripped
    // `<...>` spans when the closing `>` was present. A bare `<`
    // in user-authored prose (e.g. `1 < 2`) must survive the
    // preview pass or the visible text gets truncated.
    assert.equal(stripHtmlToPreview("1 < 2 is true", 60), "1 < 2 is true");
    assert.equal(stripHtmlToPreview("a < b", 60), "a < b");
    assert.equal(stripHtmlToPreview("<", 60), "<");
  });

  it("keeps an unterminated tag fragment as literal text", () => {
    // `"hello<unterminated"` has no closing `>`; the old regex
    // would not match it, so the literal chars survive.
    assert.equal(stripHtmlToPreview("hello<unterminated", 60), "hello<unterminated");
  });

  it("strips only the real tag when mixed with a later bare `<`", () => {
    // `<tag>` has a `>`, it gets stripped. The later `< c` has no
    // `>`, it stays literal.
    assert.equal(stripHtmlToPreview("a <tag> b < c", 60), "a b < c");
  });

  it("handles tags with attributes containing whitespace", () => {
    assert.equal(stripHtmlToPreview('<a href="x" target="_blank">click</a> here', 60), "click here");
  });

  it("does not expand entities (raw characters pass through)", () => {
    // Former regex didn't decode entities either — `&amp;` comes
    // out literal. Documented so future readers know the boundary.
    assert.equal(stripHtmlToPreview("a &amp; b", 60), "a &amp; b");
  });
});
