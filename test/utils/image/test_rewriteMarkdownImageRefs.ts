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
    const src = "![cdn](https://cdn.example.com/x.png)\n![http](http://example.com/y.png)";
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
    assert.equal(rewriteMarkdownImageRefs("![some alt](images/x.png)"), "![some alt](/api/files/raw?path=images%2Fx.png)");
    assert.equal(rewriteMarkdownImageRefs("![](images/x.png)"), "![](/api/files/raw?path=images%2Fx.png)");
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
    const out = rewriteMarkdownImageRefs("![a](../images/foo.png)", "wiki/pages");
    assert.equal(out, "![a](/api/files/raw?path=wiki%2Fimages%2Ffoo.png)");
  });

  it("resolves `../../images/foo.png` from markdowns/2026 to images/foo.png", () => {
    const out = rewriteMarkdownImageRefs("![a](../../images/foo.png)", "markdowns/2026");
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
    const out = rewriteMarkdownImageRefs("![a](./sub/../images/foo.png)", "wiki/pages");
    assert.equal(out, "![a](/api/files/raw?path=wiki%2Fpages%2Fimages%2Ffoo.png)");
  });

  it("leaves data/http/api refs untouched even when basePath is given", () => {
    const src = "![a](data:image/png;base64,AAA=) ![b](https://ex.com/x.png) ![c](/api/files/raw?path=x)";
    assert.equal(rewriteMarkdownImageRefs(src, "wiki/pages"), src);
  });
});

describe("rewriteMarkdownImageRefs — code blocks and special chars", () => {
  it("leaves image-ref syntax inside a fenced code block untouched", () => {
    const src = ["Before", "", "```", "![example](images/foo.png)", "```", "", "After ![real](images/bar.png)"].join("\n");
    const out = rewriteMarkdownImageRefs(src);
    // The one inside the code block stays literal.
    assert.ok(out.includes("![example](images/foo.png)"));
    // The one outside gets rewritten.
    assert.ok(out.includes("path=images%2Fbar.png"));
  });

  it("leaves image-ref syntax inside an inline code span untouched", () => {
    const src = "Use `![example](images/foo.png)` in a doc; ![real](images/bar.png) renders.";
    const out = rewriteMarkdownImageRefs(src);
    assert.ok(out.includes("`![example](images/foo.png)`"));
    assert.ok(out.includes("path=images%2Fbar.png"));
  });

  it("leaves image-ref syntax inside a ~~~ fenced block untouched", () => {
    const src = "~~~\n![example](images/foo.png)\n~~~\n![real](x.png)";
    const out = rewriteMarkdownImageRefs(src);
    assert.ok(out.includes("![example](images/foo.png)"));
    assert.ok(out.includes("path=x.png"));
  });

  it("correctly rewrites an image URL that contains `)` inside the path (Wikipedia-style)", () => {
    // The old regex stopped at the first `)` and truncated the href
    // to `wiki/Foo_(bar`. marked's lexer parses balanced parens
    // correctly, so the full `Foo_(bar).png` lands in the href.
    // encodeURIComponent preserves `(` and `)` as literal chars (they
    // are in its "unreserved mark" set) — the resulting URL round-
    // trips through marked because balanced parens stay balanced.
    const src = "![wikilink](wiki/Foo_(bar).png)";
    const out = rewriteMarkdownImageRefs(src);
    assert.equal(out, "![wikilink](/api/files/raw?path=wiki%2FFoo_(bar).png)");
  });

  it("passes through https URLs with balanced parens untouched", () => {
    const src = "![w](https://en.wikipedia.org/wiki/Foo_(bar))";
    assert.equal(rewriteMarkdownImageRefs(src), src);
  });

  it("preserves markdown title when rewriting", () => {
    const out = rewriteMarkdownImageRefs('![alt](images/foo.png "a title")', "");
    assert.equal(out, '![alt](/api/files/raw?path=images%2Ffoo.png "a title")');
  });

  it("does not rewrite a skipped literal when the same raw appears later in real markdown", () => {
    // Regression for a forward-indexOf splice: when a fence contains
    // `![a](x.png)` and a later paragraph contains the identical
    // `![a](x.png)`, the earlier token-tree approach could rewrite
    // the fenced literal instead of the real image.
    const src = "```\n![a](x.png)\n```\n\n![a](x.png)";
    const out = rewriteMarkdownImageRefs(src);
    // Fenced literal unchanged.
    assert.ok(out.includes("```\n![a](x.png)\n```"));
    // Real image rewritten.
    assert.ok(out.includes("![a](/api/files/raw?path=x.png)"));
    // The fenced literal is NOT rewritten.
    assert.ok(!out.includes("![a](/api/files/raw?path=x.png)\n```"));
  });

  it("preserves nested brackets in alt text", () => {
    // `![outer [inner]](img.png)` — CommonMark balanced-bracket alt.
    // The earlier regex-based alt extraction stopped at the first `]`
    // and produced malformed output.
    const src = "![outer [inner]](img.png)";
    const out = rewriteMarkdownImageRefs(src);
    assert.equal(out, "![outer [inner]](/api/files/raw?path=img.png)");
  });

  it("rewrites multiple refs across paragraphs, lists, and blockquotes", () => {
    const src = [
      "# Page",
      "",
      "- one ![a](images/a.png)",
      "- two ![b](images/b.png)",
      "",
      "> quoted ![c](images/c.png)",
      "",
      "```",
      "![skipme](images/skip.png)",
      "```",
    ].join("\n");
    const out = rewriteMarkdownImageRefs(src);
    assert.ok(out.includes("path=images%2Fa.png"));
    assert.ok(out.includes("path=images%2Fb.png"));
    assert.ok(out.includes("path=images%2Fc.png"));
    assert.ok(out.includes("![skipme](images/skip.png)"));
  });
});
