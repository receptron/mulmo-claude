// Unit tests for the wiki-embed registry + marked extension
// (#1221 PR-B).
//
// Drives the actual marked instance after setup so the test
// covers the integration: register handlers, install extension,
// run marked, assert the rendered HTML.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { marked } from "marked";

import { escapeHtml } from "@mulmoclaude/core/wiki";
import { _resetWikiEmbeds, listWikiEmbedPrefixes, registerWikiEmbed, wikiEmbedExtension } from "../../../src/utils/markdown/wikiEmbeds";
import {
  amazonTldForLocale,
  registerAmazonEmbed,
  registerIsbnEmbed,
  registerYoutubeEmbed,
  registerBuiltInWikiEmbeds,
} from "../../../src/utils/markdown/wikiEmbedHandlers";

// `marked.use()` mutates the global instance — install once per
// suite. Tests that need a fresh handler set call
// `_resetWikiEmbeds()` and re-register.
marked.use(wikiEmbedExtension);

beforeEach(() => {
  _resetWikiEmbeds();
});

describe("escapeHtml", () => {
  it("escapes the five HTML-meaningful characters", () => {
    assert.equal(escapeHtml(`& < > " '`), "&amp; &lt; &gt; &quot; &#39;");
  });

  it("leaves benign characters untouched", () => {
    assert.equal(escapeHtml("hello, world!"), "hello, world!");
  });
});

describe("registerWikiEmbed", () => {
  it("re-registering the same prefix overwrites the handler", () => {
    registerWikiEmbed({ prefix: "demo", render: () => "v1" });
    registerWikiEmbed({ prefix: "demo", render: () => "v2" });
    assert.deepEqual(listWikiEmbedPrefixes(), ["demo"]);
  });

  it("normalises prefix to lowercase", () => {
    registerWikiEmbed({ prefix: "DEMO", render: () => "x" });
    assert.deepEqual(listWikiEmbedPrefixes(), ["demo"]);
  });
});

describe("marked extension — token recognition", () => {
  beforeEach(() => {
    registerWikiEmbed({ prefix: "x", render: (embedId) => `<span class="x">${escapeHtml(embedId)}</span>` });
  });

  it("substitutes a single embed", () => {
    const html = (marked.parse("hello [[x:abc]] world") as string).trim();
    assert.match(html, /<span class="x">abc<\/span>/);
  });

  it("matches case-insensitively on the prefix", () => {
    const html = (marked.parse("[[X:abc]]") as string).trim();
    assert.match(html, /<span class="x">abc<\/span>/);
  });

  it("ignores prefixes with no registered handler — leaves the raw text", () => {
    const html = (marked.parse("[[unknown:abc]]") as string).trim();
    // marked encodes the raw `[[ ]]` as plain text inside <p>.
    assert.match(html, /\[\[unknown:abc\]\]/);
  });

  it("does NOT substitute inside fenced code blocks", () => {
    const html = (marked.parse("```\n[[x:abc]]\n```") as string).trim();
    assert.match(html, /<code>\[\[x:abc\]\]/);
    assert.doesNotMatch(html, /<span class="x">/);
  });

  it("does NOT substitute inside inline code", () => {
    const html = (marked.parse("see `[[x:abc]]` for details") as string).trim();
    assert.doesNotMatch(html, /<span class="x">/);
  });

  it("supports multiple embeds in one paragraph", () => {
    const html = (marked.parse("a [[x:one]] b [[x:two]] c") as string).trim();
    assert.match(html, /<span class="x">one<\/span>/);
    assert.match(html, /<span class="x">two<\/span>/);
  });

  it("rejects empty id (`[[x:]]`)", () => {
    const html = (marked.parse("[[x:]]") as string).trim();
    assert.doesNotMatch(html, /<span class="x">/);
    assert.match(html, /\[\[x:\]\]/);
  });

  it("rejects whitespace-only id (`[[x: ]]`)", () => {
    const html = (marked.parse("[[x:   ]]") as string).trim();
    assert.doesNotMatch(html, /<span class="x">/);
  });

  it("preserves ids with slashes (path-style — github:owner/repo)", () => {
    registerWikiEmbed({
      prefix: "gh",
      render: (embedId) => {
        const escaped = escapeHtml(embedId);
        return `<a href="${escaped}">${escaped}</a>`;
      },
    });
    const html = (marked.parse("[[gh:owner/repo/issues/42]]") as string).trim();
    assert.match(html, /owner\/repo\/issues\/42/);
  });

  it("preserves ids with commas (coords — map:35.6,139.7)", () => {
    registerWikiEmbed({
      prefix: "map",
      render: (embedId) => `<span class="map">${escapeHtml(embedId)}</span>`,
    });
    const html = (marked.parse("[[map:35.6,139.7]]") as string).trim();
    assert.match(html, /<span class="map">35\.6,139\.7<\/span>/);
  });
});

describe("Amazon embed handler", () => {
  beforeEach(() => {
    registerAmazonEmbed();
  });

  it("renders a thumbnail-link to amazon.com/dp/<asin> for a valid ASIN", () => {
    const html = (marked.parse("see [[amazon:B00ICN066A]]") as string).trim();
    assert.match(html, /href="https:\/\/www\.amazon\.com\/dp\/B00ICN066A"/);
    assert.match(html, /target="_blank"/);
    assert.match(html, /rel="noopener noreferrer"/);
    assert.match(html, /src="https:\/\/images-na\.ssl-images-amazon\.com\/images\/P\/B00ICN066A\.01\.L\.jpg"/);
    assert.match(html, /loading="lazy"/);
    assert.match(html, /class="wiki-embed wiki-embed-amazon"/);
  });

  it("falls through to verbatim for an invalid ASIN", () => {
    const html = (marked.parse("[[amazon:not-an-asin]]") as string).trim();
    assert.match(html, /\[\[amazon:not-an-asin\]\]/);
    assert.doesNotMatch(html, /amazon\.com\/dp/);
  });

  it("rejects an ASIN-shaped id with HTML metacharacters (no XSS leak)", () => {
    // 10 chars (passing length) but not all alphanumeric — must
    // fail the pattern, not get URL-injected.
    const html = (marked.parse("[[amazon:<script>x]]") as string).trim();
    assert.doesNotMatch(html, /<script/);
  });
});

describe("amazonTldForLocale", () => {
  it("maps a full tag, then a language-only fallback", () => {
    assert.equal(amazonTldForLocale("ja"), "co.jp");
    assert.equal(amazonTldForLocale("pt-BR"), "com.br");
    assert.equal(amazonTldForLocale("de-AT"), "de");
  });

  it("unmapped locales fall back to .com", () => {
    assert.equal(amazonTldForLocale("nl"), "com");
    assert.equal(amazonTldForLocale(""), "com");
  });

  it("a prototype-chain locale falls back to .com, not an inherited function", () => {
    // A bare `AMAZON_TLDS["constructor"]` returns the Object.prototype
    // function, which would become the URL host and break the storefront link.
    assert.equal(amazonTldForLocale("constructor"), "com");
    assert.equal(amazonTldForLocale("toString"), "com");
    assert.equal(amazonTldForLocale("__proto__"), "com");
    assert.equal(amazonTldForLocale("hasOwnProperty"), "com");
  });
});

describe("ISBN embed handler", () => {
  beforeEach(() => {
    registerIsbnEmbed();
  });

  it("renders a link to OpenLibrary for ISBN-13", () => {
    const html = (marked.parse("[[isbn:9780062316097]]") as string).trim();
    assert.match(html, /href="https:\/\/openlibrary\.org\/isbn\/9780062316097"/);
    assert.match(html, /📖 ISBN 9780062316097/);
  });

  it("renders a link for ISBN-10 with the X checksum", () => {
    const html = (marked.parse("[[isbn:020161622X]]") as string).trim();
    assert.match(html, /href="https:\/\/openlibrary\.org\/isbn\/020161622X"/);
  });

  it("normalises hyphenated ISBNs before the pattern check", () => {
    const html = (marked.parse("[[isbn:978-0-06-231609-7]]") as string).trim();
    assert.match(html, /openlibrary\.org\/isbn\/9780062316097/);
  });

  it("falls through to verbatim for an invalid ISBN", () => {
    const html = (marked.parse("[[isbn:not-a-real-isbn]]") as string).trim();
    assert.match(html, /\[\[isbn:not-a-real-isbn\]\]/);
    assert.doesNotMatch(html, /openlibrary\.org/);
  });
});

describe("YouTube embed handler", () => {
  beforeEach(() => {
    registerYoutubeEmbed();
  });

  it("renders an inline iframe via youtube-nocookie.com for a valid 11-char id", () => {
    const html = (marked.parse("watch [[youtube:dQw4w9WgXcQ]]") as string).trim();
    assert.match(html, /<iframe /);
    assert.match(html, /src="https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ"/);
    assert.match(html, /allowfullscreen/);
    assert.match(html, /loading="lazy"/);
    assert.match(html, /class="wiki-embed wiki-embed-youtube"/);
  });

  it("accepts ids containing _ and - characters", () => {
    const html = (marked.parse("[[youtube:abc_def-XYZ]]") as string).trim();
    assert.match(html, /youtube-nocookie\.com\/embed\/abc_def-XYZ/);
  });

  it("falls through to verbatim for an id shorter than 11 chars", () => {
    const html = (marked.parse("[[youtube:tooShort]]") as string).trim();
    assert.match(html, /\[\[youtube:tooShort\]\]/);
    assert.doesNotMatch(html, /youtube-nocookie\.com\/embed/);
  });

  it("falls through to verbatim for an id longer than 11 chars", () => {
    const html = (marked.parse("[[youtube:thisIdIsTooLong]]") as string).trim();
    assert.match(html, /\[\[youtube:thisIdIsTooLong\]\]/);
    assert.doesNotMatch(html, /youtube-nocookie\.com\/embed/);
  });

  it("rejects an id with HTML metacharacters (no XSS leak)", () => {
    // 11 chars (passing length) but contains HTML metacharacters,
    // so it must fail the strict alphanumeric+_- pattern.
    const html = (marked.parse('[[youtube:<script>x"]]') as string).trim();
    assert.doesNotMatch(html, /<script/);
    assert.doesNotMatch(html, /youtube-nocookie\.com\/embed/);
  });
});

describe("registerBuiltInWikiEmbeds — bootstrap convenience", () => {
  it("registers amazon, isbn, and youtube", () => {
    registerBuiltInWikiEmbeds();
    assert.deepEqual(listWikiEmbedPrefixes(), ["amazon", "isbn", "youtube"]);
  });

  it("is idempotent (re-running doesn't add duplicates)", () => {
    registerBuiltInWikiEmbeds();
    registerBuiltInWikiEmbeds();
    assert.deepEqual(listWikiEmbedPrefixes(), ["amazon", "isbn", "youtube"]);
  });
});
