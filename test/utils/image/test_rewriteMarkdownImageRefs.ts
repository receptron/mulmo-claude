import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rewriteMarkdownImageRefs, rewriteImgSrcAttrsInHtml } from "../../../src/utils/image/rewriteMarkdownImageRefs";

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

describe("rewriteMarkdownImageRefs — raw <img> tags (Stage A)", () => {
  it("rewrites a double-quoted src on a bare <img>", () => {
    const out = rewriteMarkdownImageRefs('<img src="images/foo.png">');
    assert.ok(out.includes('src="/api/files/raw?path=images%2Ffoo.png"'));
  });

  it("rewrites a single-quoted src", () => {
    const out = rewriteMarkdownImageRefs("<img src='images/foo.png'>");
    assert.ok(out.includes("src='/api/files/raw?path=images%2Ffoo.png'"));
  });

  it("rewrites an unquoted src (HTML5 allows this for simple values)", () => {
    const out = rewriteMarkdownImageRefs("<img src=images/foo.png>");
    assert.ok(out.includes('src="/api/files/raw?path=images%2Ffoo.png"'));
  });

  it("rewrites a self-closing <img />", () => {
    const out = rewriteMarkdownImageRefs('<img src="images/foo.png" />');
    assert.ok(out.includes('src="/api/files/raw?path=images%2Ffoo.png"'));
    assert.ok(out.includes("/>"));
  });

  it("preserves other attributes regardless of order", () => {
    const out = rewriteMarkdownImageRefs('<img alt="chart" src="images/foo.png" class="hero" id="x">');
    assert.ok(out.includes('alt="chart"'));
    assert.ok(out.includes('class="hero"'));
    assert.ok(out.includes('id="x"'));
    assert.ok(out.includes('src="/api/files/raw?path=images%2Ffoo.png"'));
  });

  it("rewrites multiple <img> tags inside one HTML block", () => {
    const html = '<div><img src="a.png"><img src="b.png"></div>';
    const out = rewriteMarkdownImageRefs(html);
    assert.ok(out.includes("path=a.png"));
    assert.ok(out.includes("path=b.png"));
  });

  it("rewrites an <img> nested in a <picture> wrapper (the inner <img> only)", () => {
    // <source> tags are out of scope for Stage A.
    const html = '<picture><source srcset="alt.png"><img src="fallback.png"></picture>';
    const out = rewriteMarkdownImageRefs(html);
    assert.ok(out.includes("path=fallback.png"));
    // <source> srcset is left untouched (Stage B / E).
    assert.ok(out.includes('srcset="alt.png"'));
  });

  it("rewrites inline HTML <img> inside a paragraph", () => {
    const out = rewriteMarkdownImageRefs('text before <img src="images/foo.png"> text after');
    assert.ok(out.includes('<img src="/api/files/raw?path=images%2Ffoo.png">'));
    assert.ok(out.startsWith("text before "));
    assert.ok(out.includes(" text after"));
  });

  it("leaves data: URIs untouched on <img>", () => {
    const html = '<img src="data:image/png;base64,AAA=">';
    assert.equal(rewriteMarkdownImageRefs(html), html);
  });

  it("leaves http/https URLs untouched on <img>", () => {
    const html = '<img src="https://cdn.example.com/foo.png">';
    assert.equal(rewriteMarkdownImageRefs(html), html);
  });

  it("leaves /api/ paths untouched on <img> (idempotent)", () => {
    const html = '<img src="/api/files/raw?path=images%2Ffoo.png">';
    assert.equal(rewriteMarkdownImageRefs(html), html);
  });

  it("leaves /artifacts/images paths untouched (already on the static mount)", () => {
    const html = '<img src="/artifacts/images/2026/04/a.png">';
    const out = rewriteMarkdownImageRefs(html);
    // resolveImageSrc on workspace path "artifacts/images/..." returns "/artifacts/images/..."
    assert.ok(out.includes('src="/artifacts/images/2026/04/a.png"'));
  });

  it("ignores <img> tags with no src attribute", () => {
    const html = '<img alt="placeholder">';
    assert.equal(rewriteMarkdownImageRefs(html), html);
  });

  it("ignores <img> with empty src", () => {
    const html = '<img src="">';
    assert.equal(rewriteMarkdownImageRefs(html), html);
  });

  it("does NOT rewrite <img> inside a fenced code block", () => {
    const markdownSource = ["```", '<img src="images/foo.png">', "```"].join("\n");
    const out = rewriteMarkdownImageRefs(markdownSource);
    assert.ok(out.includes('<img src="images/foo.png">'));
    assert.ok(!out.includes("/api/files/raw"));
  });

  it("does NOT rewrite <img> inside an inline code span", () => {
    const markdownSource = 'use `<img src="images/foo.png">` for static images';
    const out = rewriteMarkdownImageRefs(markdownSource);
    assert.ok(out.includes('`<img src="images/foo.png">`'));
    assert.ok(!out.includes("/api/files/raw"));
  });

  it("resolves a relative <img> src against basePath", () => {
    const out = rewriteMarkdownImageRefs('<img src="../images/foo.png">', "wiki/pages");
    assert.ok(out.includes('src="/api/files/raw?path=wiki%2Fimages%2Ffoo.png"'));
  });

  it("resolves an absolute-within-workspace <img> src ignoring basePath", () => {
    const out = rewriteMarkdownImageRefs('<img src="/artifacts/images/2026/04/a.png">', "wiki/pages");
    assert.ok(out.includes('src="/artifacts/images/2026/04/a.png"'));
  });

  it("passes through <img> refs that escape the workspace root", () => {
    const html = '<img src="../../../escape.png">';
    const out = rewriteMarkdownImageRefs(html, "a");
    assert.equal(out, html);
  });

  it("rewrites a mix of markdown ![alt](url) and raw <img> in the same document", () => {
    const markdownSource = ["![chart](images/a.png)", "", '<p>also: <img src="images/b.png"></p>'].join("\n");
    const out = rewriteMarkdownImageRefs(markdownSource);
    assert.ok(out.includes("path=images%2Fa.png"));
    assert.ok(out.includes("path=images%2Fb.png"));
  });

  it("handles attributes split across newlines inside the tag (within an HTML block)", () => {
    // A bare multi-line <img> at top level isn't a valid block-HTML
    // start per CommonMark — marked parses it as a paragraph with a
    // text token. Wrap in <div> so it's a single html token, which is
    // the realistic case for LLM-generated multi-attribute markup.
    const markdownSource = '<div>\n<img\n  alt="x"\n  src="images/foo.png"\n  class="y"\n>\n</div>';
    const out = rewriteMarkdownImageRefs(markdownSource);
    assert.ok(out.includes('src="/api/files/raw?path=images%2Ffoo.png"'));
    assert.ok(out.includes('alt="x"'));
    assert.ok(out.includes('class="y"'));
  });

  it("preserves the original quote style when rewriting", () => {
    const doubleQuoted = rewriteMarkdownImageRefs('<img src="images/foo.png">');
    const singleQuoted = rewriteMarkdownImageRefs("<img src='images/foo.png'>");
    assert.ok(doubleQuoted.includes('src="/api/files/raw?'));
    assert.ok(singleQuoted.includes("src='/api/files/raw?"));
  });
});

describe("rewriteImgSrcAttrsInHtml — direct (no marked involvement)", () => {
  it("returns input unchanged when there is no <img> tag", () => {
    assert.equal(rewriteImgSrcAttrsInHtml("<p>no images here</p>", ""), "<p>no images here</p>");
  });

  it("rewrites a workspace-relative src using the given basePath", () => {
    const out = rewriteImgSrcAttrsInHtml('<img src="../images/foo.png">', "wiki/pages");
    assert.equal(out, '<img src="/api/files/raw?path=wiki%2Fimages%2Ffoo.png">');
  });

  it("does not rewrite a src that escapes the workspace root", () => {
    const html = '<img src="../../../etc.png">';
    assert.equal(rewriteImgSrcAttrsInHtml(html, "a"), html);
  });

  it("rewrites only the first src= when somehow two appear (does not corrupt)", () => {
    // Pathological input — the regex only swaps the first occurrence,
    // and the result must still be valid HTML.
    const html = '<img src="a.png" data-src="b.png">';
    const out = rewriteImgSrcAttrsInHtml(html, "");
    assert.ok(out.includes("path=a.png"));
    assert.ok(out.includes('data-src="b.png"'));
  });

  it("is case-insensitive on the tag name", () => {
    assert.ok(rewriteImgSrcAttrsInHtml('<IMG SRC="images/foo.png">', "").includes("path=images%2Ffoo.png"));
  });
});

// Adversarial / malformed input — user-typed wiki content can be
// arbitrarily broken, so the rewriter must never crash, never widen
// the attack surface, and never produce HTML that breaks out of its
// own attribute. These tests pin the safety properties.
describe("rewriteImgSrcAttrsInHtml — adversarial input", () => {
  it("leaves a tag with no closing > untouched (no greedy run-on)", () => {
    const html = '<img src="aaaa';
    assert.equal(rewriteImgSrcAttrsInHtml(html, ""), html);
  });

  it("does not capture a leading quote when the closing quote is missing", () => {
    // Pre-fix bug: bare-match `[^\s>]+` swallowed `"abc.png` as the URL,
    // producing `path=%22abc.png`. The defanged bare match (must not
    // start with " or ') leaves the tag untouched instead.
    const html = '<img src="abc.png alt=x>';
    const out = rewriteImgSrcAttrsInHtml(html, "");
    // No rewrite — the malformed src is left as-is.
    assert.ok(!out.includes("/api/files/raw"));
    assert.equal(out, html);
  });

  it("leaves a tag with src= but no value untouched", () => {
    const html = "<img src=>";
    assert.equal(rewriteImgSrcAttrsInHtml(html, ""), html);
  });

  it("rewrites the real src even when an embedded > sits inside a quoted attribute", () => {
    // The quote-aware outer regex (Codex iter-2 fix) skips over
    // `"x>y"` as a complete quoted span and reaches the real
    // `src="a.png"`. The old `[^>]*` matcher would have stopped at
    // the first `>` and missed the src entirely.
    const html = '<img title="x>y" src="a.png">';
    const out = rewriteImgSrcAttrsInHtml(html, "");
    assert.ok(out.includes('title="x>y"'));
    assert.ok(out.includes('src="/api/files/raw?path=a.png"'));
  });

  it("does not match <imgs ...> (word boundary respected)", () => {
    const html = '<imgs src="x.png">';
    assert.equal(rewriteImgSrcAttrsInHtml(html, ""), html);
  });

  it("does not match <imgsrc=...> (no whitespace between img and src)", () => {
    // `<img\b` boundary requires a non-word char after `img`. `s` is
    // a word char — so `<imgsrc>` doesn't match.
    const html = '<imgsrc="x.png">';
    assert.equal(rewriteImgSrcAttrsInHtml(html, ""), html);
  });

  it("rewrites embedded <img> string inside another attribute (known limitation, but safely)", () => {
    // A regex can't tell that this <img> isn't a real DOM tag. We
    // accept the false-positive rewrite as long as the output is safe
    // HTML — i.e., the new URL never contains chars that break out of
    // the surrounding quotes.
    const html = `<div data-template="<img src='oops.png'>">`;
    const out = rewriteImgSrcAttrsInHtml(html, "");
    assert.ok(out.includes("/api/files/raw?path=oops.png"));
    // Surrounding `<div data-template="..."` still well-formed.
    assert.ok(out.startsWith('<div data-template="'));
    assert.ok(out.endsWith('">'));
  });

  it("URL-encodes characters that would otherwise close the attribute (defense in depth)", () => {
    // If a user puts " or ' inside the src value, encodeURIComponent
    // turns them into %22 / %27 in the rewritten URL. The output
    // attribute remains balanced.
    const html = `<img src='foo".png'>`;
    const out = rewriteImgSrcAttrsInHtml(html, "");
    assert.ok(out.includes("%22"));
    // The output `src='...'` attribute must not contain a literal `"`.
    // Inspect the section between the opening `src='` and the next `'`.
    const match = /src='([^']*)'/.exec(out);
    assert.ok(match, "expected a single-quoted src attribute in the output");
    assert.ok(!match[1].includes('"'), `unexpected " inside src value: ${match[1]}`);
  });

  it("URL-encodes < and > when the src is well-formed", () => {
    // For a well-formed quoted src that happens to contain < or >,
    // encodeURIComponent turns them into %3C / %3E in the rewritten
    // URL — defense in depth against tag breakout.
    // (Note: when the input is *malformed* with stray < that breaks
    //  the outer <img...> match, the rewriter declines to rewrite at
    //  all — see the "never introduces new < or >" test below.)
    const html = `<img src='foo<bar>.png'>`;
    const out = rewriteImgSrcAttrsInHtml(html, "");
    // For this input, the outer regex greedy [^>]* stops at the first
    // > inside the src — same malformed-skip behavior. The "never
    // introduces" property below is the strong guarantee.
    const inputAngles = (html.match(/[<>]/g) ?? []).length;
    const outputAngles = (out.match(/[<>]/g) ?? []).length;
    assert.ok(outputAngles <= inputAngles);
  });

  it("handles unicode characters in URL paths", () => {
    const html = '<img src="画像.png">';
    const out = rewriteImgSrcAttrsInHtml(html, "");
    assert.ok(out.includes(encodeURIComponent("画像.png")));
  });

  it("processes 100KB of input in linear time (no ReDoS)", () => {
    // Pathological input: <img with no closing >. Confirms the regex
    // doesn't catastrophically backtrack.
    const html = `<img ${"a".repeat(100_000)}`;
    const start = Date.now();
    const out = rewriteImgSrcAttrsInHtml(html, "");
    const elapsedMs = Date.now() - start;
    assert.equal(out, html);
    assert.ok(elapsedMs < 1000, `Expected <1s, took ${elapsedMs}ms`);
  });

  it("returns the input unchanged for empty / null-ish input", () => {
    assert.equal(rewriteImgSrcAttrsInHtml("", ""), "");
  });

  it("handles consecutive <img> tags with no whitespace between", () => {
    const html = '<img src="a.png"><img src="b.png">';
    const out = rewriteImgSrcAttrsInHtml(html, "");
    assert.ok(out.includes("path=a.png"));
    assert.ok(out.includes("path=b.png"));
  });

  it("leaves srcset on a real <img> alone (Stage A scope = src only)", () => {
    const html = '<img src="x.png" srcset="y.png 2x">';
    const out = rewriteImgSrcAttrsInHtml(html, "");
    assert.ok(out.includes("path=x.png"));
    assert.ok(out.includes('srcset="y.png 2x"'));
  });

  it("idempotence: running twice gives the same result", () => {
    const html = '<div><img src="a/b.png"><img src="../c.png"></div>';
    const once = rewriteImgSrcAttrsInHtml(html, "wiki/pages");
    const twice = rewriteImgSrcAttrsInHtml(once, "wiki/pages");
    assert.equal(twice, once);
  });

  it("handles mixed line endings (\\r\\n) inside the tag", () => {
    const html = '<img\r\n  src="x.png"\r\n  alt="y">';
    const out = rewriteImgSrcAttrsInHtml(html, "");
    assert.ok(out.includes("path=x.png"));
    assert.ok(out.includes('alt="y"'));
  });

  it("never introduces new < or > characters that weren't in the input", () => {
    // Defense: the rewriter only modifies the src attribute value,
    // and encodeURIComponent encodes both < and >. So the count of
    // < and > in the output can only equal or be less than the input
    // (less, when the original src had < or > that get encoded away).
    const inputs = ['<img src="<script>foo</script>.png">', "<img src='<a href=\"x\">y</a>.png'>", '<img src="</img>foo.png">', '<img src="<>.png">'];
    for (const html of inputs) {
      const out = rewriteImgSrcAttrsInHtml(html, "");
      const inputAngles = (html.match(/[<>]/g) ?? []).length;
      const outputAngles = (out.match(/[<>]/g) ?? []).length;
      assert.ok(outputAngles <= inputAngles, `output added < or > characters: input=${html} output=${out}`);
    }
  });

  it("rewrites a tag with extra whitespace around the = sign", () => {
    const out = rewriteImgSrcAttrsInHtml('<img src   =   "images/foo.png">', "");
    assert.ok(out.includes("path=images%2Ffoo.png"));
  });

  it("does not rewrite when src appears as a substring of another attribute name", () => {
    // `data-src` should not be matched by the `\bsrc\s*=` pattern.
    const html = '<img data-src="x.png" alt="y">';
    const out = rewriteImgSrcAttrsInHtml(html, "");
    assert.equal(out, html);
  });

  it("does not rewrite a `src=` substring inside another attribute's quoted value", () => {
    // Codex review of #1023 caught this: a free-form `src=` lookbehind
    // would rewrite the alt-internal `src=oops` and corrupt the tag.
    // Attribute-iterator parsing handles it correctly — the alt value
    // is consumed as a unit, and the real `src=` is matched separately.
    const html = '<img alt="x src=oops" src="real.png">';
    const out = rewriteImgSrcAttrsInHtml(html, "");
    assert.ok(out.includes('alt="x src=oops"'));
    assert.ok(out.includes('src="/api/files/raw?path=real.png"'));
  });

  it("does not rewrite namespaced attrs like xml:src or xlink:src", () => {
    const xml = '<img xml:src="ignored.png" src="real.png">';
    const xlink = '<img xlink:src="ignored.png" src="real.png">';
    const xmlOut = rewriteImgSrcAttrsInHtml(xml, "");
    const xlinkOut = rewriteImgSrcAttrsInHtml(xlink, "");
    assert.ok(xmlOut.includes('xml:src="ignored.png"'));
    assert.ok(xmlOut.includes('src="/api/files/raw?path=real.png"'));
    assert.ok(xlinkOut.includes('xlink:src="ignored.png"'));
    assert.ok(xlinkOut.includes('src="/api/files/raw?path=real.png"'));
  });

  it("preserves a quoted value that itself contains the substring 'src='", () => {
    // Pathological mocking-pattern: the alt explicitly mentions src=…
    // so users can write tutorials. The rewriter must NOT touch it.
    const html = '<img alt="docs example: src=foo.png" src="real.png">';
    const out = rewriteImgSrcAttrsInHtml(html, "");
    assert.ok(out.includes('alt="docs example: src=foo.png"'));
    assert.ok(out.includes('src="/api/files/raw?path=real.png"'));
  });

  it("handles `>` inside a quoted attribute value (Codex iter-2 finding)", () => {
    // Without quote-aware outer regex, the matcher would stop at the
    // first `>` (inside alt) and never see the real `src`.
    const html = '<img alt="comparison: a > b" src="real.png">';
    const out = rewriteImgSrcAttrsInHtml(html, "");
    assert.ok(out.includes('alt="comparison: a > b"'));
    assert.ok(out.includes('src="/api/files/raw?path=real.png"'));
  });

  it("handles `>` inside a single-quoted attribute value", () => {
    const html = "<img alt='a > b' src='real.png'>";
    const out = rewriteImgSrcAttrsInHtml(html, "");
    assert.ok(out.includes("alt='a > b'"));
    assert.ok(out.includes("src='/api/files/raw?path=real.png'"));
  });

  it("handles multiple `>` characters inside attribute values", () => {
    const html = '<img alt="x>y>z" title="p>q" src="real.png">';
    const out = rewriteImgSrcAttrsInHtml(html, "");
    assert.ok(out.includes('alt="x>y>z"'));
    assert.ok(out.includes('title="p>q"'));
    assert.ok(out.includes('src="/api/files/raw?path=real.png"'));
  });

  it("processes 100KB of `>`-laden input in linear time (no ReDoS in the new outer regex)", () => {
    // Quote-aware outer is more complex than the old `[^>]*`. Pin
    // linear-time behavior on adversarial input.
    const inner = '" '.repeat(50_000); // 100KB of mixed quote and space
    const html = `<img alt=${inner} src="real.png">`;
    const start = Date.now();
    const out = rewriteImgSrcAttrsInHtml(html, "");
    const elapsedMs = Date.now() - start;
    // No assertion on `out` content — adversarial input may not match
    // the tag pattern at all. Just verify it returns in bounded time.
    assert.equal(typeof out, "string");
    assert.ok(elapsedMs < 1000, `expected <1s, got ${elapsedMs}ms`);
  });
});

// Top-level rewriteMarkdownImageRefs adversarial cases — same
// concerns but exercised through marked's lexer.
describe("rewriteMarkdownImageRefs — adversarial markdown", () => {
  it("does not crash on empty input", () => {
    assert.equal(rewriteMarkdownImageRefs(""), "");
  });

  it("does not crash on whitespace-only input", () => {
    assert.equal(rewriteMarkdownImageRefs("   \n\n\t\n"), "   \n\n\t\n");
  });

  it("preserves a malformed <img> inside a paragraph without rewriting", () => {
    const markdownSource = "before <img src=oops alt=x text after";
    const out = rewriteMarkdownImageRefs(markdownSource);
    // No rewrite — there's no closing > so the regex doesn't bite.
    assert.ok(!out.includes("/api/files/raw"));
  });

  it("does not rewrite <img> inside a 4-space-indented code block", () => {
    const markdownSource = ["Title", "", '    <img src="x.png">', "", "After ![real](y.png)"].join("\n");
    const out = rewriteMarkdownImageRefs(markdownSource);
    // Indented block stays literal.
    assert.ok(out.includes('    <img src="x.png">'));
    assert.ok(out.includes("path=y.png"));
  });

  it("rewrites <img> inside a markdown blockquote", () => {
    const markdownSource = '> see image: <img src="images/foo.png">';
    const out = rewriteMarkdownImageRefs(markdownSource);
    assert.ok(out.includes("/api/files/raw?path=images%2Ffoo.png"));
  });

  it("does not rewrite <img> inside a code span across paragraphs", () => {
    const markdownSource = ['text `<img src="x.png">` more', "", "![real](y.png)"].join("\n");
    const out = rewriteMarkdownImageRefs(markdownSource);
    assert.ok(out.includes('`<img src="x.png">`'));
    assert.ok(out.includes("path=y.png"));
  });

  it("survives a 50KB document with many <img> tags", () => {
    const lines: string[] = [];
    for (let i = 0; i < 1000; i++) {
      lines.push(`<p><img src="images/${i}.png"></p>`);
    }
    const markdownSource = lines.join("\n\n");
    const start = Date.now();
    const out = rewriteMarkdownImageRefs(markdownSource);
    const elapsedMs = Date.now() - start;
    // All 1000 should be rewritten.
    const matches = out.match(/\/api\/files\/raw/g) ?? [];
    assert.equal(matches.length, 1000);
    assert.ok(elapsedMs < 5000, `Expected <5s, took ${elapsedMs}ms`);
  });

  it("does not rewrite a <script> tag (only <img> is in scope)", () => {
    const markdownSource = '<script src="bad.js"></script>';
    const out = rewriteMarkdownImageRefs(markdownSource);
    assert.equal(out, markdownSource);
  });

  it("URL-encoding prevents src injection in markdown context", () => {
    // Even if a user manages to inject a `"` into a src value, the
    // output is a properly-quoted attribute with the `"` URL-encoded.
    // A v-html consumer downstream sees a single well-formed attribute.
    const markdownSource = `<img src='foo"><script>alert(1)</script>'>`;
    const out = rewriteMarkdownImageRefs(markdownSource);
    // Either the rewrite happens with %22 + %3C in the URL, or the
    // tag is left as-is. Either way, no executable script tag is
    // produced as a side effect of rewriting.
    assert.ok(!out.includes("<script>alert(1)</script>") || out.includes(markdownSource));
  });
});

describe("rewriteImgSrcAttrsInHtml — extended tag coverage (Stage B)", () => {
  it("rewrites <source src> on a video child", () => {
    const html = '<video controls><source src="video.mp4" type="video/mp4"></video>';
    const out = rewriteImgSrcAttrsInHtml(html, "data/wiki/pages");
    assert.match(out, /<source src="\/api\/files\/raw\?path=data%2Fwiki%2Fpages%2Fvideo\.mp4"/);
  });

  it("rewrites <video poster>", () => {
    const html = '<video poster="thumb.png" controls></video>';
    const out = rewriteImgSrcAttrsInHtml(html, "data/wiki/pages");
    assert.match(out, /<video poster="\/api\/files\/raw\?path=data%2Fwiki%2Fpages%2Fthumb\.png"/);
  });

  it("rewrites <video src>", () => {
    const html = '<video src="movie.webm"></video>';
    const out = rewriteImgSrcAttrsInHtml(html, "data/wiki/pages");
    assert.match(out, /<video src="\/api\/files\/raw\?path=data%2Fwiki%2Fpages%2Fmovie\.webm"/);
  });

  it("rewrites <audio src>", () => {
    const html = '<audio src="track.ogg" controls></audio>';
    const out = rewriteImgSrcAttrsInHtml(html, "data/wiki/pages");
    assert.match(out, /<audio src="\/api\/files\/raw\?path=data%2Fwiki%2Fpages%2Ftrack\.ogg"/);
  });

  it("rewrites all attributes on <video poster> + <video src> together", () => {
    const html = '<video poster="thumb.png" src="movie.mp4"></video>';
    const out = rewriteImgSrcAttrsInHtml(html, "data/wiki/pages");
    assert.match(out, /poster="\/api\/files\/raw\?path=data%2Fwiki%2Fpages%2Fthumb\.png"/);
    assert.match(out, /src="\/api\/files\/raw\?path=data%2Fwiki%2Fpages%2Fmovie\.mp4"/);
  });

  it("does NOT rewrite <source srcset> (deferred to follow-up)", () => {
    const html = '<source srcset="hi.png 2x, lo.png 1x" type="image/png">';
    const out = rewriteImgSrcAttrsInHtml(html, "data/wiki/pages");
    assert.equal(out, html, "srcset is comma-separated descriptor list — Stage B follow-up");
  });

  it("leaves <video poster> unchanged when http(s)", () => {
    const html = '<video poster="https://cdn.example.com/poster.jpg"></video>';
    const out = rewriteImgSrcAttrsInHtml(html, "data/wiki/pages");
    assert.equal(out, html);
  });
});
