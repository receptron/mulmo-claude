import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rewriteWorkspaceLinks, rewriteMarkdownLinks, splitFragmentAndQuery } from "../../server/utils/markdown.js";

describe("splitFragmentAndQuery", () => {
  it("splits a hash fragment", () => {
    assert.deepEqual(splitFragmentAndQuery("page#section"), {
      pathPart: "page",
      suffix: "#section",
    });
  });

  it("splits a query string", () => {
    assert.deepEqual(splitFragmentAndQuery("page?foo=1"), {
      pathPart: "page",
      suffix: "?foo=1",
    });
  });

  it("returns the full string when no fragment or query", () => {
    assert.deepEqual(splitFragmentAndQuery("page.md"), {
      pathPart: "page.md",
      suffix: "",
    });
  });

  it("picks the earlier of # and ?", () => {
    assert.deepEqual(splitFragmentAndQuery("p?q=1#h"), {
      pathPart: "p",
      suffix: "?q=1#h",
    });
  });
});

describe("rewriteMarkdownLinks", () => {
  it("rewrites the href of every markdown link", () => {
    const input = "See [foo](old) and [bar](old2).";
    const result = rewriteMarkdownLinks(input, (h) => h.toUpperCase());
    assert.equal(result, "See [foo](OLD) and [bar](OLD2).");
  });

  it("leaves non-link brackets alone", () => {
    const input = "This is [not a link and some text.";
    const result = rewriteMarkdownLinks(input, () => "x");
    assert.equal(result, input);
  });

  it("handles adjacent links", () => {
    const input = "[a](1)[b](2)";
    const result = rewriteMarkdownLinks(input, (h) => `_${h}_`);
    assert.equal(result, "[a](_1_)[b](_2_)");
  });
});

describe("rewriteWorkspaceLinks", () => {
  it("rewrites absolute workspace paths to relative", () => {
    const content = "See [wiki](/wiki/pages/foo.md) for details.";
    const result = rewriteWorkspaceLinks("summaries/daily/2026/04/17.md", content);
    assert.equal(result, "See [wiki](../../../../wiki/pages/foo.md) for details.");
  });

  it("leaves external URLs untouched", () => {
    const content = "[ext](//example.com)";
    const result = rewriteWorkspaceLinks("summaries/daily.md", content);
    assert.equal(result, "[ext](//example.com)");
  });

  it("leaves relative paths untouched", () => {
    const content = "[rel](../topics/foo.md)";
    const result = rewriteWorkspaceLinks("summaries/daily.md", content);
    assert.equal(result, "[rel](../topics/foo.md)");
  });

  it("preserves fragment suffixes", () => {
    const content = "[s](/wiki/pages/foo.md#section)";
    const result = rewriteWorkspaceLinks("summaries/index.md", content);
    assert.equal(result, "[s](../wiki/pages/foo.md#section)");
  });
});
