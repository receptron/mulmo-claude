import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderWikiLinks } from "../../../src/plugins/wiki/helpers.js";

describe("renderWikiLinks", () => {
  it("replaces a simple wiki link", () => {
    assert.equal(
      renderWikiLinks("See [[Home]] for details."),
      'See <span class="wiki-link" data-page="Home">Home</span> for details.',
    );
  });

  it("replaces multiple wiki links in one string", () => {
    assert.equal(
      renderWikiLinks("[[a]] and [[b]]"),
      '<span class="wiki-link" data-page="a">a</span> and <span class="wiki-link" data-page="b">b</span>',
    );
  });

  it("leaves content without wiki links unchanged", () => {
    assert.equal(renderWikiLinks("just prose"), "just prose");
  });

  it("returns empty string for empty input", () => {
    assert.equal(renderWikiLinks(""), "");
  });

  it("leaves an empty bracket pair untouched", () => {
    // The old regex required at least one non-`]` char between
    // `[[` and `]]`. An empty `[[]]` is malformed and stays as-is.
    assert.equal(renderWikiLinks("[[]]"), "[[]]");
  });

  it("leaves a bare `[[` with no closing `]]` as literal text", () => {
    assert.equal(
      renderWikiLinks("open [[ but no close"),
      "open [[ but no close",
    );
  });

  it("leaves `[[foo]bar]]` as literal — page name cannot contain `]`", () => {
    // The old `[^\]]+` made `]` illegal in the capture group;
    // the overall regex didn't match so the string was unchanged.
    assert.equal(renderWikiLinks("x [[foo]bar]] y"), "x [[foo]bar]] y");
  });

  it("handles triple brackets the same way the old regex did", () => {
    // `[[[foo]]]` → the old regex matched `[[[foo]]` greedily so
    // the page name became `[foo` (including the third `[`) and
    // the last `]` remained as trailing text. Preserve that quirk.
    assert.equal(
      renderWikiLinks("[[[foo]]]"),
      '<span class="wiki-link" data-page="[foo">[foo</span>]',
    );
  });

  it("handles wiki links with spaces in the page name", () => {
    assert.equal(
      renderWikiLinks("[[My Page]]"),
      '<span class="wiki-link" data-page="My Page">My Page</span>',
    );
  });

  it("handles adjacent wiki links with no separator", () => {
    assert.equal(
      renderWikiLinks("[[a]][[b]]"),
      '<span class="wiki-link" data-page="a">a</span><span class="wiki-link" data-page="b">b</span>',
    );
  });

  it("preserves surrounding markdown syntax", () => {
    assert.equal(
      renderWikiLinks("- item: [[x]]"),
      '- item: <span class="wiki-link" data-page="x">x</span>',
    );
  });
});
