import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractSlugFromBulletHref,
  findBrokenLinksInPage,
  findMissingFiles,
  findOrphanPages,
  formatLintReport,
  parseIndexEntries,
  wikiSlugify,
  type WikiPageEntry,
} from "../../server/api/routes/wiki.js";

describe("wikiSlugify", () => {
  it("lowercases input", () => {
    assert.equal(wikiSlugify("Hello"), "hello");
  });

  it("replaces spaces with hyphens", () => {
    assert.equal(wikiSlugify("video generation"), "video-generation");
  });

  it("collapses multiple whitespace into single hyphens", () => {
    assert.equal(wikiSlugify("a   b\tc"), "a-b-c");
  });

  it("strips characters that aren't a-z / 0-9 / hyphen", () => {
    assert.equal(wikiSlugify("foo!@#$bar"), "foobar");
    assert.equal(wikiSlugify("hello, world"), "hello-world");
  });

  it("preserves digits", () => {
    assert.equal(wikiSlugify("step 1 of 2"), "step-1-of-2");
  });

  it("handles empty input", () => {
    assert.equal(wikiSlugify(""), "");
  });
});

describe("extractSlugFromBulletHref", () => {
  it("extracts slug from pages/<slug>.md", () => {
    assert.equal(extractSlugFromBulletHref("pages/sakura-internet.md"), "sakura-internet");
  });

  it("handles leading ./ and deeper prefixes", () => {
    assert.equal(extractSlugFromBulletHref("./pages/foo.md"), "foo");
    assert.equal(extractSlugFromBulletHref("wiki/pages/foo.md"), "foo");
  });

  it("accepts a bare <slug>.md without the pages prefix", () => {
    assert.equal(extractSlugFromBulletHref("foo.md"), "foo");
  });

  it("accepts just <slug> with no .md extension", () => {
    assert.equal(extractSlugFromBulletHref("foo"), "foo");
  });

  it("strips surrounding whitespace", () => {
    assert.equal(extractSlugFromBulletHref("  pages/foo.md  "), "foo");
  });

  it("returns empty for absolute URLs (caller should fall back)", () => {
    assert.equal(extractSlugFromBulletHref("https://example.com/foo"), "");
    assert.equal(extractSlugFromBulletHref("http://x/foo.md"), "");
  });

  it("returns empty for an empty input", () => {
    assert.equal(extractSlugFromBulletHref(""), "");
    assert.equal(extractSlugFromBulletHref("   "), "");
  });
});

describe("parseIndexEntries", () => {
  it("returns an empty array for empty input", () => {
    assert.deepEqual(parseIndexEntries(""), []);
  });

  it("parses a markdown table with header + separator + rows", () => {
    const md = [
      "| slug | title | description |",
      "|------|-------|-------------|",
      "| `video-gen` | Video Gen | Notes about video |",
      "| `audio-gen` | Audio Gen | Notes about audio |",
    ].join("\n");
    const entries = parseIndexEntries(md);
    assert.equal(entries.length, 2);
    assert.deepEqual(entries[0], {
      slug: "video-gen",
      title: "Video Gen",
      description: "Notes about video",
    });
  });

  it("falls back to slug as title when title is empty", () => {
    const md = ["| slug | title |", "|------|-------|", "| `bare` |  |"].join("\n");
    const entries = parseIndexEntries(md);
    assert.equal(entries[0]?.title, "bare");
  });

  it("parses bullet markdown links", () => {
    const md = "- [Video Generation](pages/video-generation.md) — about video";
    const entries = parseIndexEntries(md);
    assert.deepEqual(entries[0], {
      title: "Video Generation",
      slug: "video-generation",
      description: "about video",
    });
  });

  it("derives slug from href for non-ASCII titles", () => {
    // Regression for the Japanese-wiki case: before, the slug was
    // `wikiSlugify(title)` which stripped every non-ASCII character
    // and returned "", breaking in-canvas navigation. The slug must
    // now come from the href segment.
    const md = "- [さくらインターネット](pages/sakura-internet.md) — クラウド事業者";
    const entries = parseIndexEntries(md);
    assert.deepEqual(entries[0], {
      title: "さくらインターネット",
      slug: "sakura-internet",
      description: "クラウド事業者",
    });
  });

  it("derives slug from a bare filename href", () => {
    // Some historical index.md files used `[Title](slug.md)` without
    // the `pages/` prefix. Still valid — use the filename as slug.
    const md = "- [Video Generation](video-generation.md) — about video";
    const entries = parseIndexEntries(md);
    assert.equal(entries[0]?.slug, "video-generation");
  });

  it("derives slug from a plain filename with no extension", () => {
    const md = "- [Video Generation](video-generation) — about video";
    const entries = parseIndexEntries(md);
    assert.equal(entries[0]?.slug, "video-generation");
  });

  it("falls back to slugifying the title when the href is an external URL", () => {
    // External URLs have no wiki-page slug, so the old title-derived
    // slug is the only reasonable choice. For non-ASCII titles this
    // still produces "" — but that's fine: such a row isn't a
    // real wiki page entry in the first place.
    const md = "- [Video Generation](https://example.com/xyz) — about video";
    const entries = parseIndexEntries(md);
    assert.equal(entries[0]?.slug, "video-generation");
  });

  it("parses bullet wiki links", () => {
    const md = "- [[Video Generation]] — about video";
    const entries = parseIndexEntries(md);
    assert.deepEqual(entries[0], {
      title: "Video Generation",
      slug: "video-generation",
      description: "about video",
    });
  });

  it("treats em-dash, en-dash, and hyphen as the same description separator", () => {
    const out1 = parseIndexEntries("- [[A]] — desc");
    const out2 = parseIndexEntries("- [[A]] – desc");
    const out3 = parseIndexEntries("- [[A]] - desc");
    assert.equal(out1[0]?.description, "desc");
    assert.equal(out2[0]?.description, "desc");
    assert.equal(out3[0]?.description, "desc");
  });

  it("handles a missing description on bullet links", () => {
    const md = "- [Topic](pages/topic.md)";
    const entries = parseIndexEntries(md);
    assert.equal(entries[0]?.description, "");
  });

  it("ignores lines that don't match any format", () => {
    const md = "Just some text\n# A heading\n";
    assert.deepEqual(parseIndexEntries(md), []);
  });

  it("handles a mix of table and bullet entries", () => {
    const md = ["| slug | title |", "|------|-------|", "| `t1` | Topic 1 |", "", "- [[Topic 2]]"].join("\n");
    const entries = parseIndexEntries(md);
    assert.equal(entries.length, 2);
    assert.equal(entries[0]?.slug, "t1");
    assert.equal(entries[1]?.slug, "topic-2");
  });
});

describe("findOrphanPages", () => {
  it("returns no issues when every file is indexed", () => {
    const files = new Set(["a", "b"]);
    const indexed = new Set(["a", "b"]);
    assert.deepEqual(findOrphanPages(files, indexed), []);
  });

  it("flags a file that is not in the index", () => {
    const files = new Set(["a", "b", "orphan"]);
    const indexed = new Set(["a", "b"]);
    const issues = findOrphanPages(files, indexed);
    assert.equal(issues.length, 1);
    assert.match(issues[0] ?? "", /Orphan page.*orphan\.md/);
  });

  it("flags multiple orphans", () => {
    const files = new Set(["a", "b", "c"]);
    const indexed = new Set<string>();
    assert.equal(findOrphanPages(files, indexed).length, 3);
  });
});

describe("findMissingFiles", () => {
  function entry(slug: string): WikiPageEntry {
    return { slug, title: slug, description: "" };
  }

  it("returns no issues when every indexed entry has a file", () => {
    const entries = [entry("a"), entry("b")];
    const files = new Set(["a", "b"]);
    assert.deepEqual(findMissingFiles(entries, files), []);
  });

  it("flags an indexed entry whose file does not exist", () => {
    const entries = [entry("a"), entry("missing")];
    const files = new Set(["a"]);
    const issues = findMissingFiles(entries, files);
    assert.equal(issues.length, 1);
    assert.match(issues[0] ?? "", /Missing file.*missing/);
  });
});

describe("findBrokenLinksInPage", () => {
  it("returns no issues when every wiki link resolves", () => {
    const content = "See [[Topic A]] and [[Topic B]] for details.";
    const fileSlugs = new Set(["topic-a", "topic-b"]);
    assert.deepEqual(findBrokenLinksInPage("source.md", content, fileSlugs), []);
  });

  it("flags a broken link", () => {
    const content = "See [[Missing Topic]] for details.";
    const fileSlugs = new Set(["other"]);
    const issues = findBrokenLinksInPage("source.md", content, fileSlugs);
    assert.equal(issues.length, 1);
    assert.match(issues[0] ?? "", /Broken link\*\* in `source\.md`/);
    assert.match(issues[0] ?? "", /missing-topic\.md/);
  });

  it("ignores non-wiki-link bracket sequences", () => {
    const content = "Plain text with [normal](link) references.";
    const fileSlugs = new Set<string>();
    assert.deepEqual(findBrokenLinksInPage("source.md", content, fileSlugs), []);
  });

  it("flags multiple broken links in the same page", () => {
    const content = "[[A]] and [[B]] and [[C]]";
    const fileSlugs = new Set<string>();
    assert.equal(findBrokenLinksInPage("source.md", content, fileSlugs).length, 3);
  });
});

describe("formatLintReport", () => {
  it("returns the healthy banner when no issues", () => {
    const out = formatLintReport([]);
    assert.match(out, /✓ No issues found\. Wiki is healthy\./);
  });

  it("uses singular noun when exactly 1 issue", () => {
    const out = formatLintReport(["- one"]);
    assert.match(out, /1 issue found:/);
  });

  it("uses plural noun when > 1 issue", () => {
    const out = formatLintReport(["- one", "- two"]);
    assert.match(out, /2 issues found:/);
  });

  it("includes every issue line in the report body", () => {
    const out = formatLintReport(["- one", "- two", "- three"]);
    assert.match(out, /- one/);
    assert.match(out, /- two/);
    assert.match(out, /- three/);
  });
});
