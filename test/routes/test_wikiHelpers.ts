import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildTableColumnMap,
  extractHashTags,
  extractSlugFromBulletHref,
  findBrokenLinksInPage,
  findMissingFiles,
  findOrphanPages,
  findTagDrift,
  formatLintReport,
  parseIndexEntries,
  parseTagsCell,
  wikiSlugify,
  type WikiPageEntry,
} from "../../server/api/routes/wiki.js";
import { parseFrontmatterTags } from "../../server/api/routes/wiki/frontmatter.js";

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

  it("returns empty string for non-ASCII-only input", () => {
    assert.equal(wikiSlugify("テストページ"), "");
  });

  it("preserves ASCII portion of mixed input", () => {
    assert.equal(wikiSlugify("ABC テスト 123"), "abc--123");
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
    const markdown = [
      "| slug | title | description |",
      "|------|-------|-------------|",
      "| `video-gen` | Video Gen | Notes about video |",
      "| `audio-gen` | Audio Gen | Notes about audio |",
    ].join("\n");
    const entries = parseIndexEntries(markdown);
    assert.equal(entries.length, 2);
    assert.deepEqual(entries[0], {
      slug: "video-gen",
      title: "Video Gen",
      description: "Notes about video",
      tags: [],
    });
  });

  it("falls back to slug as title when title is empty", () => {
    const markdown = ["| slug | title |", "|------|-------|", "| `bare` |  |"].join("\n");
    const entries = parseIndexEntries(markdown);
    assert.equal(entries[0]?.title, "bare");
  });

  it("parses bullet markdown links", () => {
    const markdown = "- [Video Generation](pages/video-generation.md) — about video";
    const entries = parseIndexEntries(markdown);
    assert.deepEqual(entries[0], {
      title: "Video Generation",
      slug: "video-generation",
      description: "about video",
      tags: [],
    });
  });

  it("derives slug from href for non-ASCII titles", () => {
    // Regression for the Japanese-wiki case: before, the slug was
    // `wikiSlugify(title)` which stripped every non-ASCII character
    // and returned "", breaking in-canvas navigation. The slug must
    // now come from the href segment.
    const markdown = "- [さくらインターネット](pages/sakura-internet.md) — クラウド事業者";
    const entries = parseIndexEntries(markdown);
    assert.deepEqual(entries[0], {
      title: "さくらインターネット",
      slug: "sakura-internet",
      description: "クラウド事業者",
      tags: [],
    });
  });

  it("derives slug from a bare filename href", () => {
    // Some historical index.md files used `[Title](slug.md)` without
    // the `pages/` prefix. Still valid — use the filename as slug.
    const markdown = "- [Video Generation](video-generation.md) — about video";
    const entries = parseIndexEntries(markdown);
    assert.equal(entries[0]?.slug, "video-generation");
  });

  it("derives slug from a plain filename with no extension", () => {
    const markdown = "- [Video Generation](video-generation) — about video";
    const entries = parseIndexEntries(markdown);
    assert.equal(entries[0]?.slug, "video-generation");
  });

  it("falls back to slugifying the title when the href is an external URL", () => {
    // External URLs have no wiki-page slug, so the old title-derived
    // slug is the only reasonable choice. For non-ASCII titles this
    // still produces "" — but that's fine: such a row isn't a
    // real wiki page entry in the first place.
    const markdown = "- [Video Generation](https://example.com/xyz) — about video";
    const entries = parseIndexEntries(markdown);
    assert.equal(entries[0]?.slug, "video-generation");
  });

  it("parses bullet wiki links", () => {
    const markdown = "- [[Video Generation]] — about video";
    const entries = parseIndexEntries(markdown);
    assert.deepEqual(entries[0], {
      title: "Video Generation",
      slug: "video-generation",
      description: "about video",
      tags: [],
    });
  });

  it("parses a Tags column in the table header", () => {
    const markdown = [
      "| Slug | Title | Summary | Tags | Updated |",
      "|------|-------|---------|------|---------|",
      "| `foo` | Foo | summary text | ai, research, paper | 2026-04-05 |",
    ].join("\n");
    const entries = parseIndexEntries(markdown);
    assert.deepEqual(entries[0]?.tags, ["ai", "paper", "research"]);
    assert.equal(entries[0]?.description, "summary text");
  });

  it("keeps legacy 4-column tables working when Tags header is absent", () => {
    // Regression: the pre-tags workspace index.md uses
    // | Slug | Title | Summary | Updated | — tags must default to [].
    const markdown = ["| Slug | Title | Summary | Updated |", "|------|-------|---------|---------|", "| `foo` | Foo | summary | 2026-04-05 |"].join("\n");
    const entries = parseIndexEntries(markdown);
    assert.deepEqual(entries[0]?.tags, []);
    assert.equal(entries[0]?.description, "summary");
  });

  it("is case- and whitespace-tolerant for the Tags header name", () => {
    const markdown = ["| slug |  TAGS  | title |", "|------|--------|-------|", "| foo | a, b | Foo |"].join("\n");
    const entries = parseIndexEntries(markdown);
    assert.deepEqual(entries[0]?.tags, ["a", "b"]);
  });

  it("extracts #tag tokens from bullet descriptions", () => {
    const markdown = "- [Transformer](pages/transformer.md) — foundational #ml #attention (2026-04-05)";
    const entries = parseIndexEntries(markdown);
    assert.deepEqual(entries[0]?.tags, ["attention", "ml"]);
    assert.match(entries[0]?.description ?? "", /foundational/);
    assert.doesNotMatch(entries[0]?.description ?? "", /#ml|#attention/);
  });

  it("extracts #tag tokens from bullet wiki links", () => {
    const entries = parseIndexEntries("- [[Topic A]] — short #foo #bar");
    assert.deepEqual(entries[0]?.tags, ["bar", "foo"]);
    assert.equal(entries[0]?.description, "short");
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
    const markdown = "- [Topic](pages/topic.md)";
    const entries = parseIndexEntries(markdown);
    assert.equal(entries[0]?.description, "");
  });

  it("ignores lines that don't match any format", () => {
    const markdown = "Just some text\n# A heading\n";
    assert.deepEqual(parseIndexEntries(markdown), []);
  });

  it("handles a mix of table and bullet entries", () => {
    const markdown = ["| slug | title |", "|------|-------|", "| `t1` | Topic 1 |", "", "- [[Topic 2]]"].join("\n");
    const entries = parseIndexEntries(markdown);
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
    return { slug, title: slug, description: "", tags: [] };
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

describe("extractHashTags", () => {
  it("extracts sorted, deduped, lowercased tags and strips them from the description", () => {
    const out = extractHashTags("notes #ML #attention");
    assert.deepEqual(out.tags, ["attention", "ml"]);
    assert.equal(out.description, "notes");
  });

  it("returns an empty tag list when no # tokens are present", () => {
    const out = extractHashTags("just a plain description");
    assert.deepEqual(out.tags, []);
    assert.equal(out.description, "just a plain description");
  });

  it("dedupes repeated tags", () => {
    assert.deepEqual(extractHashTags("#a #a #b").tags, ["a", "b"]);
  });

  it("accepts hyphens inside tag names", () => {
    assert.deepEqual(extractHashTags("#ai-agents #ml-arch").tags, ["ai-agents", "ml-arch"]);
  });

  it("does not match hashes that aren't at a word boundary", () => {
    // `foo#bar` is a URL fragment / anchor, not a tag — leave it
    // alone so we don't corrupt descriptions that link out.
    const out = extractHashTags("see page#frag for details");
    assert.deepEqual(out.tags, []);
    assert.equal(out.description, "see page#frag for details");
  });

  it("collapses internal whitespace left over after stripping tags", () => {
    const out = extractHashTags("foo  #a   bar  #b");
    assert.deepEqual(out.tags, ["a", "b"]);
    assert.equal(out.description, "foo bar");
  });

  it("accepts non-ASCII tag names (Japanese, CJK, etc.)", () => {
    const out = extractHashTags("日本のクラウド事業者 #クラウド #日本企業 #データセンター");
    assert.deepEqual(out.tags, ["クラウド", "データセンター", "日本企業"]);
    assert.equal(out.description, "日本のクラウド事業者");
  });

  it("accepts mixed ASCII + non-ASCII tags", () => {
    const out = extractHashTags("notes #ai-エージェント #foo");
    assert.deepEqual(out.tags, ["ai-エージェント", "foo"]);
  });
});

describe("parseTagsCell", () => {
  it("splits on commas and whitespace", () => {
    assert.deepEqual(parseTagsCell("a, b  c"), ["a", "b", "c"]);
  });

  it("strips leading # and lowercases", () => {
    assert.deepEqual(parseTagsCell("#A,#b"), ["a", "b"]);
  });

  it("dedupes and sorts", () => {
    assert.deepEqual(parseTagsCell("z, a, a, m"), ["a", "m", "z"]);
  });

  it("returns an empty list for an empty cell", () => {
    assert.deepEqual(parseTagsCell(""), []);
    assert.deepEqual(parseTagsCell("   "), []);
  });
});

describe("buildTableColumnMap", () => {
  it("builds a lowercase-keyed map from a header row", () => {
    const map = buildTableColumnMap("| Slug | Title | Summary | Tags | Updated |");
    assert.equal(map.get("slug"), 0);
    assert.equal(map.get("title"), 1);
    assert.equal(map.get("summary"), 2);
    assert.equal(map.get("tags"), 3);
    assert.equal(map.get("updated"), 4);
  });

  it("is whitespace-tolerant", () => {
    const map = buildTableColumnMap("|  slug  |   tags   |");
    assert.equal(map.get("slug"), 0);
    assert.equal(map.get("tags"), 1);
  });

  it("omits empty columns from the map", () => {
    const map = buildTableColumnMap("| slug | | tags |");
    assert.equal(map.get("slug"), 0);
    assert.equal(map.get("tags"), 2);
    assert.equal(map.size, 2);
  });

  it("strips surrounding backticks from header cells", () => {
    // Mirror parseTableRow's data-cell normaliser so a backticked
    // header like `| `tags` |` still resolves via columnMap.get("tags").
    const map = buildTableColumnMap("| `slug` | `tags` |");
    assert.equal(map.get("slug"), 0);
    assert.equal(map.get("tags"), 1);
  });
});

describe("parseFrontmatterTags", () => {
  it("parses flow-style tags", () => {
    const content = "---\ntitle: X\ntags: [a, b, c]\n---\n\n# body";
    assert.deepEqual(parseFrontmatterTags(content), ["a", "b", "c"]);
  });

  it("parses block-style tags", () => {
    const content = "---\ntitle: X\ntags:\n  - foo\n  - bar\n---\n\n# body";
    assert.deepEqual(parseFrontmatterTags(content), ["foo", "bar"]);
  });

  it("lowercases and strips quotes + leading #", () => {
    const content = '---\ntags: ["#AI", "Research-Paper"]\n---';
    assert.deepEqual(parseFrontmatterTags(content), ["ai", "research-paper"]);
  });

  it("returns [] when frontmatter is missing", () => {
    assert.deepEqual(parseFrontmatterTags("# just markdown"), []);
  });

  it("returns [] when the tags field is absent", () => {
    assert.deepEqual(parseFrontmatterTags("---\ntitle: X\n---"), []);
  });

  it("returns [] for malformed frontmatter", () => {
    // Frontmatter block never closes — treated as no frontmatter.
    assert.deepEqual(parseFrontmatterTags("---\ntitle: X\n"), []);
  });

  it("stops at the next top-level key when reading a block list", () => {
    const content = "---\ntags:\n  - a\n  - b\nother: value\n---";
    assert.deepEqual(parseFrontmatterTags(content), ["a", "b"]);
  });
});

describe("findTagDrift", () => {
  function entry(slug: string, tags: string[]): WikiPageEntry {
    return { slug, title: slug, description: "", tags };
  }

  it("returns no issues when index and frontmatter tags match as sets", () => {
    const entries = [entry("foo", ["a", "b"])];
    const frontmatter = new Map<string, string[]>([["foo", ["b", "a"]]]);
    assert.deepEqual(findTagDrift(entries, frontmatter), []);
  });

  it("flags slugs whose tag sets differ", () => {
    const entries = [entry("foo", ["a", "b"])];
    const frontmatter = new Map<string, string[]>([["foo", ["a", "b", "c"]]]);
    const issues = findTagDrift(entries, frontmatter);
    assert.equal(issues.length, 1);
    assert.match(issues[0], /Tag drift.*foo\.md/);
    assert.match(issues[0], /\[a, b, c\]/);
    assert.match(issues[0], /\[a, b\]/);
  });

  it("flags empty index tags against non-empty frontmatter", () => {
    const entries = [entry("foo", [])];
    const frontmatter = new Map<string, string[]>([["foo", ["a"]]]);
    assert.equal(findTagDrift(entries, frontmatter).length, 1);
  });

  it("ignores slugs missing from the frontmatter map (covered by findMissingFiles)", () => {
    const entries = [entry("foo", ["a"])];
    const frontmatter = new Map<string, string[]>();
    assert.deepEqual(findTagDrift(entries, frontmatter), []);
  });

  it("lowercases the lookup so mixed-case filenames still match", () => {
    // collectLintIssues lowercases the map keys. Here the entry's
    // slug is kept mixed-case (as a parser could produce from a
    // `MyPage.md` filename before normalization), while the
    // frontmatter map uses the canonical lowercase key. The test
    // fails if findTagDrift stops calling `.toLowerCase()` on
    // `entry.slug` before the lookup.
    const entries = [entry("MyPage", ["a"])];
    const frontmatter = new Map<string, string[]>([["mypage", ["a", "b"]]]);
    assert.equal(findTagDrift(entries, frontmatter).length, 1);
  });
});
