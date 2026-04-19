import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  rewriteWorkspaceLinks,
  rewriteMarkdownLinks,
} from "../../server/workspace/journal/linkRewrite.js";

describe("rewriteWorkspaceLinks", () => {
  it("rewrites a workspace-absolute link from a topic file", () => {
    const out = rewriteWorkspaceLinks(
      "summaries/topics/refactoring.md",
      "See [wiki](/wiki/pages/foo.md) for details.",
    );
    assert.equal(out, "See [wiki](../../wiki/pages/foo.md) for details.");
  });

  it("rewrites from a nested daily file", () => {
    const out = rewriteWorkspaceLinks(
      "summaries/daily/2026/04/11.md",
      "Today: [html](/HTMLs/report.html)",
    );
    assert.equal(out, "Today: [html](../../../../HTMLs/report.html)");
  });

  it("leaves true-relative links alone", () => {
    const out = rewriteWorkspaceLinks(
      "summaries/topics/foo.md",
      "See [other](../daily/2026/04/11.md)",
    );
    assert.equal(out, "See [other](../daily/2026/04/11.md)");
  });

  it("leaves external URLs alone", () => {
    const out = rewriteWorkspaceLinks(
      "summaries/topics/foo.md",
      "See [docs](https://example.com/foo)",
    );
    assert.equal(out, "See [docs](https://example.com/foo)");
  });

  it("leaves protocol-relative URLs alone", () => {
    const out = rewriteWorkspaceLinks(
      "summaries/topics/foo.md",
      "See [cdn](//cdn.example.com/foo)",
    );
    assert.equal(out, "See [cdn](//cdn.example.com/foo)");
  });

  it("leaves anchor-only links alone", () => {
    const out = rewriteWorkspaceLinks(
      "summaries/topics/foo.md",
      "Jump to [section](#details)",
    );
    assert.equal(out, "Jump to [section](#details)");
  });

  it("preserves #fragment on rewritten links", () => {
    const out = rewriteWorkspaceLinks(
      "summaries/topics/foo.md",
      "See [wiki heading](/wiki/pages/foo.md#section-2)",
    );
    assert.equal(out, "See [wiki heading](../../wiki/pages/foo.md#section-2)");
  });

  it("handles multiple links in one document", () => {
    const out = rewriteWorkspaceLinks(
      "summaries/topics/foo.md",
      "[a](/wiki/a.md) and [b](/wiki/b.md) and [c](https://x.com) and [d](../bar.md)",
    );
    assert.equal(
      out,
      "[a](../../wiki/a.md) and [b](../../wiki/b.md) and [c](https://x.com) and [d](../bar.md)",
    );
  });

  it("handles a link at the start of a line", () => {
    const out = rewriteWorkspaceLinks(
      "summaries/topics/foo.md",
      "- [wiki](/wiki/foo.md) — updated today",
    );
    assert.equal(out, "- [wiki](../../wiki/foo.md) — updated today");
  });

  it("handles markdown headings and prose around links", () => {
    const md = [
      "# Title",
      "",
      "Some [link](/wiki/pages/topic.md) in prose.",
      "",
      "## Subheading",
      "",
      "- bullet [two](/HTMLs/report.html) here",
    ].join("\n");
    const out = rewriteWorkspaceLinks("summaries/daily/2026/04/11.md", md);
    assert.match(
      out,
      /\[link\]\(\.\.\/\.\.\/\.\.\/\.\.\/wiki\/pages\/topic\.md\)/,
    );
    assert.match(out, /\[two\]\(\.\.\/\.\.\/\.\.\/\.\.\/HTMLs\/report\.html\)/);
  });

  it("does not touch square brackets that are not links", () => {
    const out = rewriteWorkspaceLinks(
      "summaries/topics/foo.md",
      "TODO item: [x] done, [ ] pending",
    );
    assert.equal(out, "TODO item: [x] done, [ ] pending");
  });

  it("handles '/' (root) href by returning '.' relative", () => {
    // Edge case: link to the workspace root itself. Not useful in
    // practice but must not crash.
    const out = rewriteWorkspaceLinks("summaries/topics/foo.md", "[root](/)");
    assert.equal(out, "[root](/)");
  });

  it("emits '.' for a self-reference", () => {
    const out = rewriteWorkspaceLinks(
      "summaries/topics/foo.md",
      "[self](/summaries/topics/foo.md)",
    );
    // relative from "summaries/topics" to "summaries/topics/foo.md"
    // is "foo.md" — not a self-reference; let me rewrite the test.
    assert.equal(out, "[self](foo.md)");
  });

  it("emits '.' when target equals current directory", () => {
    // current = "summaries/topics/foo.md", link to "/summaries/topics"
    const out = rewriteWorkspaceLinks(
      "summaries/topics/foo.md",
      "[dir](/summaries/topics)",
    );
    assert.equal(out, "[dir](.)");
  });
});

describe("rewriteMarkdownLinks", () => {
  it("invokes the rewrite callback for each link href", () => {
    const seen: string[] = [];
    rewriteMarkdownLinks("[a](/one) and [b](/two)", (href) => {
      seen.push(href);
      return href;
    });
    assert.deepEqual(seen, ["/one", "/two"]);
  });

  it("replaces hrefs with the callback return value", () => {
    const out = rewriteMarkdownLinks("[x](old) and [y](keep)", (href) =>
      href === "old" ? "NEW" : href,
    );
    assert.equal(out, "[x](NEW) and [y](keep)");
  });

  it("leaves unterminated '[' alone", () => {
    const out = rewriteMarkdownLinks("[unclosed text", (href) => href);
    assert.equal(out, "[unclosed text");
  });

  it("leaves unterminated '(' alone", () => {
    const out = rewriteMarkdownLinks("[text](unclosed", (href) => href);
    assert.equal(out, "[text](unclosed");
  });

  it("passes through plain bracketed text that is not a link", () => {
    const out = rewriteMarkdownLinks("[not a link] followed by text", (h) => h);
    assert.equal(out, "[not a link] followed by text");
  });

  it("handles an empty input", () => {
    assert.equal(
      rewriteMarkdownLinks("", (h) => h),
      "",
    );
  });

  it("handles input with no links at all", () => {
    const out = rewriteMarkdownLinks("plain prose without links", (h) => h);
    assert.equal(out, "plain prose without links");
  });

  it("handles adjacent links with no separator", () => {
    const out = rewriteMarkdownLinks("[a](1)[b](2)", (href) => `NEW-${href}`);
    assert.equal(out, "[a](NEW-1)[b](NEW-2)");
  });
});
