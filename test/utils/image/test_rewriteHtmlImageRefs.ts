// Coverage for rewriteHtmlImageRefs — the helper that routes LLM-emitted
// `<img src="/artifacts/…">` paths so they render inside the presentHtml
// iframe srcdoc. Stage 1 (#image-path-routing) made `artifacts/images/`
// paths resolve to the new static mount; everything else still goes
// through `/api/files/raw`.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rewriteHtmlImageRefs } from "../../../src/utils/image/rewriteHtmlImageRefs";

describe("rewriteHtmlImageRefs — artifacts/images static mount", () => {
  it("normalises a leading-slash workspace-rooted path under the static mount", () => {
    const out = rewriteHtmlImageRefs('<img src="/artifacts/images/2026/04/foo.png">');
    assert.equal(out, '<img src="/artifacts/images/2026/04/foo.png">');
  });

  it("adds the leading slash to a workspace-relative path under the static mount", () => {
    const out = rewriteHtmlImageRefs('<img src="artifacts/images/foo.png">');
    assert.equal(out, '<img src="/artifacts/images/foo.png">');
  });

  it("preserves attributes around src on artifacts/images paths", () => {
    const out = rewriteHtmlImageRefs('<img alt="cat" src="/artifacts/images/foo.png" width="100">');
    assert.equal(out, '<img alt="cat" src="/artifacts/images/foo.png" width="100">');
  });

  it("rewrites multiple <img> tags in one pass", () => {
    const html = '<p><img src="/artifacts/images/a.png"><img src="data:image/png;base64,AAAA"><img src="/artifacts/images/b.png"></p>';
    const out = rewriteHtmlImageRefs(html);
    assert.match(out, /src="\/artifacts\/images\/a\.png"/);
    assert.match(out, /data:image\/png;base64,AAAA/);
    assert.match(out, /src="\/artifacts\/images\/b\.png"/);
  });

  it("leaves non-ASCII characters in the path unencoded — the browser encodes at request time", () => {
    // The static mount form lets the browser handle UTF-8 → percent-
    // encoding when it builds the actual GET. Encoding here would
    // double-encode and break the express.static lookup.
    const out = rewriteHtmlImageRefs('<img src="/artifacts/images/日本語.png">');
    assert.equal(out, '<img src="/artifacts/images/日本語.png">');
  });
});

describe("rewriteHtmlImageRefs — non-images workspace paths via /api/files/raw", () => {
  it("rewrites a leading-slash workspace path outside artifacts/images to /api/files/raw", () => {
    const out = rewriteHtmlImageRefs('<img src="/data/wiki/pages/x.png">');
    assert.equal(out, '<img src="/api/files/raw?path=data%2Fwiki%2Fpages%2Fx.png">');
  });

  it("rewrites a no-leading-slash workspace path outside artifacts/images to /api/files/raw", () => {
    const out = rewriteHtmlImageRefs('<img src="data/wiki/pages/x.png">');
    assert.equal(out, '<img src="/api/files/raw?path=data%2Fwiki%2Fpages%2Fx.png">');
  });
});

describe("rewriteHtmlImageRefs — passthrough", () => {
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
});
