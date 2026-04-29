// Coverage for rewriteHtmlImageRefs — the helper that routes LLM-emitted
// `<img src="/artifacts/…">` paths through `/api/files/raw` so they
// render inside the presentHtml iframe srcdoc.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rewriteHtmlImageRefs } from "../../../src/utils/image/rewriteHtmlImageRefs";

describe("rewriteHtmlImageRefs", () => {
  it("rewrites leading-slash workspace-rooted paths to /api/files/raw", () => {
    const out = rewriteHtmlImageRefs('<img src="/artifacts/images/2026/04/foo.png">');
    assert.equal(out, '<img src="/api/files/raw?path=artifacts%2Fimages%2F2026%2F04%2Ffoo.png">');
  });

  it("rewrites no-leading-slash workspace-relative paths too", () => {
    const out = rewriteHtmlImageRefs('<img src="artifacts/images/foo.png">');
    assert.equal(out, '<img src="/api/files/raw?path=artifacts%2Fimages%2Ffoo.png">');
  });

  it("leaves data: URIs untouched", () => {
    const html = '<img src="data:image/png;base64,AAAA">';
    assert.equal(rewriteHtmlImageRefs(html), html);
  });

  it("leaves http:// URLs untouched", () => {
    const html = '<img src="http://example.com/foo.png">';
    assert.equal(rewriteHtmlImageRefs(html), html);
  });

  it("leaves https:// URLs untouched", () => {
    const html = '<img src="https://example.com/foo.png">';
    assert.equal(rewriteHtmlImageRefs(html), html);
  });

  it("leaves existing /api/ paths untouched", () => {
    const html = '<img src="/api/files/raw?path=foo.png">';
    assert.equal(rewriteHtmlImageRefs(html), html);
  });

  it("leaves an empty src untouched", () => {
    // Empty string after stripping the leading slash; treat as no-op.
    const html = '<img src="/">';
    assert.equal(rewriteHtmlImageRefs(html), html);
  });

  it("preserves attributes around src", () => {
    const out = rewriteHtmlImageRefs('<img alt="cat" src="/artifacts/images/foo.png" width="100">');
    assert.equal(out, '<img alt="cat" src="/api/files/raw?path=artifacts%2Fimages%2Ffoo.png" width="100">');
  });

  it("rewrites multiple <img> tags in one pass", () => {
    const html = '<p><img src="/artifacts/images/a.png"><img src="data:image/png;base64,AAAA"><img src="/artifacts/images/b.png"></p>';
    const out = rewriteHtmlImageRefs(html);
    assert.match(out, /path=artifacts%2Fimages%2Fa\.png/);
    assert.match(out, /data:image\/png;base64,AAAA/);
    assert.match(out, /path=artifacts%2Fimages%2Fb\.png/);
  });

  it("encodes non-ASCII characters in path", () => {
    const out = rewriteHtmlImageRefs('<img src="/artifacts/images/日本語.png">');
    assert.match(out, /path=artifacts%2Fimages%2F[^"]+\.png/);
  });
});
