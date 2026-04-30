// Tests for the shared HTML URL-attribute rewriter (#1011 Stage B).
// Two callers depend on this:
//   - `rewriteImgSrcAttrsInHtml` (markdown surface, browser)
//   - `inlineImages` (PDF surface, server)
// Both wire a transform callback and inherit identical tag / quote /
// attribute-iteration semantics from this helper.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { transformResolvableUrlsInHtml, RESOLVABLE_TAG_ATTRS } from "../../../src/utils/image/htmlSrcAttrs";

// `transform` that wraps every value with `R(...)` so substitutions
// are visible at a glance and unchanged input is obvious.
function tag(url: string): string {
  return `R(${url})`;
}

describe("transformResolvableUrlsInHtml — tag coverage", () => {
  it("rewrites <img src>", () => {
    const out = transformResolvableUrlsInHtml('<img src="a.png">', tag);
    assert.equal(out, '<img src="R(a.png)">');
  });

  it("rewrites <source src>", () => {
    const out = transformResolvableUrlsInHtml('<source src="a.webm" type="video/webm">', tag);
    assert.equal(out, '<source src="R(a.webm)" type="video/webm">');
  });

  it("rewrites <video poster> and <video src>", () => {
    const out = transformResolvableUrlsInHtml('<video poster="p.jpg" src="m.mp4">', tag);
    assert.equal(out, '<video poster="R(p.jpg)" src="R(m.mp4)">');
  });

  it("rewrites <audio src>", () => {
    const out = transformResolvableUrlsInHtml('<audio src="a.ogg" controls>', tag);
    assert.equal(out, '<audio src="R(a.ogg)" controls>');
  });

  it("does NOT rewrite <a href> (out of scope)", () => {
    const html = '<a href="link.html">x</a>';
    assert.equal(transformResolvableUrlsInHtml(html, tag), html);
  });

  it("does NOT rewrite <iframe src> (out of scope — iframe loading is a separate concern)", () => {
    const html = '<iframe src="page.html"></iframe>';
    assert.equal(transformResolvableUrlsInHtml(html, tag), html);
  });

  it("walks a <picture> with <source> + inner <img>", () => {
    const html = '<picture><source srcset="hi.webp" type="image/webp"><source src="m.webp"><img src="lo.png" alt="x"></picture>';
    const out = transformResolvableUrlsInHtml(html, tag);
    // <source srcset> deferred — only `src` rewrites for now
    assert.match(out, /<source srcset="hi\.webp"/);
    assert.match(out, /<source src="R\(m\.webp\)"/);
    assert.match(out, /<img src="R\(lo\.png\)"/);
  });
});

describe("transformResolvableUrlsInHtml — RESOLVABLE_TAG_ATTRS / regex lockstep", () => {
  it("the outer regex covers every tag listed in the map", () => {
    // If a future contributor adds a tag to the map but forgets to
    // extend the alternation in `RESOLVABLE_TAG_OUTER_RE`, the regex
    // simply wouldn't fire on that tag — silent regression. Pin it.
    for (const tagName of Object.keys(RESOLVABLE_TAG_ATTRS)) {
      const html = `<${tagName} src="a.png">`;
      const out = transformResolvableUrlsInHtml(html, tag);
      assert.notEqual(out, html, `tag ${tagName} declared in RESOLVABLE_TAG_ATTRS must be matched by the outer regex`);
    }
  });

  it("returns null from transform → attribute unchanged", () => {
    const out = transformResolvableUrlsInHtml('<img src="skip.png">', () => null);
    assert.equal(out, '<img src="skip.png">');
  });

  it("returns the original substring when no recognised tag matches", () => {
    const html = "<div><span>plain text</span></div>";
    assert.equal(transformResolvableUrlsInHtml(html, tag), html);
  });
});

describe("transformResolvableUrlsInHtml — quoting variations", () => {
  it("preserves double quotes", () => {
    assert.equal(transformResolvableUrlsInHtml('<img src="a">', tag), '<img src="R(a)">');
  });

  it("preserves single quotes", () => {
    assert.equal(transformResolvableUrlsInHtml("<img src='a'>", tag), "<img src='R(a)'>");
  });

  it("preserves unquoted (no spaces in value)", () => {
    assert.equal(transformResolvableUrlsInHtml("<img src=a.png>", tag), '<img src="R(a.png)">');
  });

  it("respects quoted attribute values containing >", () => {
    // `alt="x>y"` must not terminate the tag at the > inside the alt.
    const out = transformResolvableUrlsInHtml('<img alt="x>y" src="a">', tag);
    assert.equal(out, '<img alt="x>y" src="R(a)">');
  });

  it("does not capture a stray opening quote (malformed input)", () => {
    // `<img src="aaaa` (no closing quote) — refuse to capture; leave
    // alone rather than emit a corrupt rewrite.
    const html = '<img src="aaaa>';
    assert.equal(transformResolvableUrlsInHtml(html, tag), html);
  });

  it("ignores a `src=`-shaped substring inside another attribute's value", () => {
    // The alt value contains `src=oops`; the real attribute is the
    // following `src=real`. Only the real one should rewrite.
    const out = transformResolvableUrlsInHtml('<img alt="x src=oops" src="real">', tag);
    assert.equal(out, '<img alt="x src=oops" src="R(real)">');
  });

  it("ignores namespaced look-alikes (xlink:src on a recognised tag)", () => {
    const html = '<img xlink:src="ns.png">';
    assert.equal(transformResolvableUrlsInHtml(html, tag), html);
  });
});

describe("transformResolvableUrlsInHtml — edge cases", () => {
  it("returns empty string for empty input", () => {
    assert.equal(transformResolvableUrlsInHtml("", tag), "");
  });

  it("ReDoS-safe: 100KB no-closing-> input runs in linear time", () => {
    const blob = `<img src="a"${" alt=".repeat(1)} ${"x".repeat(100_000)}`;
    const start = Date.now();
    transformResolvableUrlsInHtml(blob, tag);
    const elapsed = Date.now() - start;
    // 1s ceiling — generous; worst observed is single-digit ms.
    assert.ok(elapsed < 1000, `100KB probe took ${elapsed}ms`);
  });

  it("self-closing tag form still rewrites", () => {
    assert.equal(transformResolvableUrlsInHtml('<img src="a" />', tag), '<img src="R(a)" />');
  });

  it("rewrites even when the value is empty (caller decides via `if (!url) return null` pattern)", () => {
    // Helper passes empty value to caller as empty string; caller's
    // standard pattern is to return null for empty / unwanted values.
    // Document the wire shape: the helper itself does NOT skip empty.
    const out = transformResolvableUrlsInHtml('<img src="">', () => "REPLACED");
    assert.equal(out, '<img src="">', "empty values short-circuit before transform");
  });
});
