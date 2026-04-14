import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rewriteMarkdownImageRefs } from "../../../src/utils/image/rewriteMarkdownImageRefs";

describe("rewriteMarkdownImageRefs — no basePath", () => {
  it("rewrites a simple relative image ref to an /api/files/raw URL", () => {
    const out = rewriteMarkdownImageRefs("![chart](images/foo.png)");
    assert.equal(out, "![chart](/api/files/raw?path=images%2Ffoo.png)");
  });

  it("strips a leading ./", () => {
    const out = rewriteMarkdownImageRefs("![a](./images/foo.png)");
    assert.ok(out.includes("path=images%2Ffoo.png"));
  });

  it("leaves data: URIs alone", () => {
    const src = "![a](data:image/png;base64,AAA=)";
    assert.equal(rewriteMarkdownImageRefs(src), src);
  });

  it("leaves http/https URLs alone", () => {
    const src =
      "![cdn](https://cdn.example.com/x.png)\n![http](http://example.com/y.png)";
    assert.equal(rewriteMarkdownImageRefs(src), src);
  });

  it("leaves existing /api/ paths alone (idempotent when pre-resolved)", () => {
    const src = "![a](/api/files/raw?path=images%2Ffoo.png)";
    assert.equal(rewriteMarkdownImageRefs(src), src);
  });

  it("rewrites multiple refs in one document", () => {
    const src = `
# Title
![a](./a.png)
text
![b](images/b.png)
`;
    const out = rewriteMarkdownImageRefs(src);
    assert.ok(out.includes("path=a.png"));
    assert.ok(out.includes("path=images%2Fb.png"));
  });

  it("preserves alt text and empty alt", () => {
    assert.equal(
      rewriteMarkdownImageRefs("![some alt](images/x.png)"),
      "![some alt](/api/files/raw?path=images%2Fx.png)",
    );
    assert.equal(
      rewriteMarkdownImageRefs("![](images/x.png)"),
      "![](/api/files/raw?path=images%2Fx.png)",
    );
  });

  it("does not touch non-image markdown links", () => {
    const src = "[not an image](images/x.png) and [[wiki-link]]";
    assert.equal(rewriteMarkdownImageRefs(src), src);
  });

  it("passes through refs with `..` when basePath is unknown (escapes workspace root)", () => {
    // Without basePath, `../images/foo.png` can't be resolved — any
    // answer would be wrong half the time. Leave the ref alone so the
    // user sees a 404 rather than a silently-wrong image.
    const src = "![a](../images/foo.png)";
    assert.equal(rewriteMarkdownImageRefs(src), src);
  });
});

describe("rewriteMarkdownImageRefs — with basePath", () => {
  it("resolves `../images/foo.png` from wiki/pages to wiki/images/foo.png", () => {
    const out = rewriteMarkdownImageRefs(
      "![a](../images/foo.png)",
      "wiki/pages",
    );
    assert.equal(out, "![a](/api/files/raw?path=wiki%2Fimages%2Ffoo.png)");
  });

  it("resolves `../../images/foo.png` from markdowns/2026 to images/foo.png", () => {
    const out = rewriteMarkdownImageRefs(
      "![a](../../images/foo.png)",
      "markdowns/2026",
    );
    assert.equal(out, "![a](/api/files/raw?path=images%2Ffoo.png)");
  });

  it("resolves `./foo.png` from wiki/pages to wiki/pages/foo.png", () => {
    const out = rewriteMarkdownImageRefs("![a](./foo.png)", "wiki/pages");
    assert.equal(out, "![a](/api/files/raw?path=wiki%2Fpages%2Ffoo.png)");
  });

  it("resolves bare `foo.png` from wiki/pages to wiki/pages/foo.png", () => {
    const out = rewriteMarkdownImageRefs("![a](foo.png)", "wiki/pages");
    assert.equal(out, "![a](/api/files/raw?path=wiki%2Fpages%2Ffoo.png)");
  });

  it("treats a leading `/` as workspace-root absolute, ignoring basePath", () => {
    const out = rewriteMarkdownImageRefs("![a](/images/foo.png)", "wiki/pages");
    assert.equal(out, "![a](/api/files/raw?path=images%2Ffoo.png)");
  });

  it("passes through refs that escape the workspace root", () => {
    // `../../../foo.png` from `wiki/pages` (depth 2) escapes.
    const src = "![a](../../../foo.png)";
    assert.equal(rewriteMarkdownImageRefs(src, "wiki/pages"), src);
  });

  it("normalizes redundant `./` and `..` segments mid-path", () => {
    const out = rewriteMarkdownImageRefs(
      "![a](./sub/../images/foo.png)",
      "wiki/pages",
    );
    assert.equal(
      out,
      "![a](/api/files/raw?path=wiki%2Fpages%2Fimages%2Ffoo.png)",
    );
  });

  it("leaves data/http/api refs untouched even when basePath is given", () => {
    const src =
      "![a](data:image/png;base64,AAA=) ![b](https://ex.com/x.png) ![c](/api/files/raw?path=x)";
    assert.equal(rewriteMarkdownImageRefs(src, "wiki/pages"), src);
  });
});
