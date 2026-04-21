// Registry I/O tests. Pure-parser tests run without touching the
// filesystem; the filesystem tests use `mkdtempSync` to keep the
// real `~/mulmoclaude` out of scope.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseSourceFile,
  buildSource,
  serializeSource,
  readSource,
  writeSource,
  listSources,
  deleteSource,
  DEFAULT_MAX_ITEMS_PER_FETCH,
} from "../../server/workspace/sources/registry.js";
import { sourceFilePath } from "../../server/workspace/sources/paths.js";
import type { Source } from "../../server/workspace/sources/types.js";

// --- pure-parser tests --------------------------------------------------

const VALID_FRONTMATTER = `---
slug: hn-front-page
title: Hacker News front page
url: https://news.ycombinator.com/rss
fetcher_kind: rss
schedule: daily
categories: [tech-news, general, english]
max_items_per_fetch: 30
added_at: 2026-04-13T09:00:00Z
---

# Notes

Why registered: general pulse.
`;

describe("parseSourceFile", () => {
  it("extracts frontmatter and body", () => {
    const out = parseSourceFile(VALID_FRONTMATTER);
    assert.ok(out);
    assert.equal(out!.fields.get("slug"), "hn-front-page");
    assert.equal(out!.fields.get("title"), "Hacker News front page");
    assert.deepEqual(out!.fields.get("categories"), ["tech-news", "general", "english"]);
    assert.match(out!.body, /# Notes/);
  });

  it("returns null for a file with no frontmatter", () => {
    assert.equal(parseSourceFile("just a markdown body\n"), null);
  });

  it("returns null for an unterminated frontmatter block", () => {
    assert.equal(parseSourceFile("---\nslug: x\ntitle: hey\n"), null);
  });

  it("tolerates CRLF line endings", () => {
    const crlf = VALID_FRONTMATTER.replace(/\n/g, "\r\n");
    const out = parseSourceFile(crlf);
    assert.ok(out);
    assert.equal(out!.fields.get("slug"), "hn-front-page");
  });

  it("ignores comment lines in frontmatter", () => {
    const raw = `---
# comment
slug: x
title: hey
url: https://example.com
fetcher_kind: rss
schedule: daily
categories: [ai]
max_items_per_fetch: 10
added_at: 2026-04-13T00:00:00Z
---
`;
    const out = parseSourceFile(raw);
    assert.ok(out);
    assert.equal(out!.fields.get("slug"), "x");
  });

  it("handles empty string values", () => {
    const raw = `---
slug: x
title: empty
url: https://example.com
fetcher_kind: rss
schedule: daily
categories: []
max_items_per_fetch: 5
added_at: 2026-04-13T00:00:00Z
---
`;
    const out = parseSourceFile(raw);
    assert.ok(out);
    assert.deepEqual(out!.fields.get("categories"), []);
  });
});

describe("buildSource — validation", () => {
  function base(): Map<string, string | string[]> {
    return new Map<string, string | string[]>([
      ["slug", "hn"],
      ["title", "HN"],
      ["url", "https://news.ycombinator.com/rss"],
      ["fetcher_kind", "rss"],
      ["schedule", "daily"],
      ["categories", ["tech-news"]],
      ["max_items_per_fetch", "30"],
      ["added_at", "2026-04-13T00:00:00Z"],
    ]);
  }

  it("builds a valid Source from well-formed fields", () => {
    const source = buildSource(base(), "body");
    assert.ok(source);
    assert.equal(source!.slug, "hn");
    assert.equal(source!.title, "HN");
    assert.equal(source!.fetcherKind, "rss");
    assert.equal(source!.schedule, "daily");
    assert.deepEqual(source!.categories, ["tech-news"]);
    assert.equal(source!.maxItemsPerFetch, 30);
    assert.equal(source!.notes, "body");
  });

  it("returns null for missing slug", () => {
    const front = base();
    front.delete("slug");
    assert.equal(buildSource(front, ""), null);
  });

  it("returns null for invalid slug (uppercase)", () => {
    const front = base();
    front.set("slug", "HN");
    assert.equal(buildSource(front, ""), null);
  });

  it("returns null for invalid slug (path traversal)", () => {
    const front = base();
    front.set("slug", "../etc/passwd");
    assert.equal(buildSource(front, ""), null);
  });

  it("returns null for missing title", () => {
    const front = base();
    front.delete("title");
    assert.equal(buildSource(front, ""), null);
  });

  it("returns null for missing url", () => {
    const front = base();
    front.delete("url");
    assert.equal(buildSource(front, ""), null);
  });

  it("returns null for unknown fetcher kind", () => {
    const front = base();
    front.set("fetcher_kind", "bogus");
    assert.equal(buildSource(front, ""), null);
  });

  it("returns null for unknown schedule", () => {
    const front = base();
    front.set("schedule", "quarterly");
    assert.equal(buildSource(front, ""), null);
  });

  it("drops invalid categories silently", () => {
    const front = base();
    front.set("categories", ["ai", "bogus", "security"]);
    const source = buildSource(front, "");
    assert.ok(source);
    assert.deepEqual(source!.categories, ["ai", "security"]);
  });

  it("falls back to the default max_items_per_fetch for invalid values", () => {
    const front = base();
    front.set("max_items_per_fetch", "not-a-number");
    const source = buildSource(front, "");
    assert.ok(source);
    assert.equal(source!.maxItemsPerFetch, DEFAULT_MAX_ITEMS_PER_FETCH);
  });

  it("falls back to the default for a zero / negative max", () => {
    const front = base();
    front.set("max_items_per_fetch", "0");
    assert.equal(buildSource(front, "")!.maxItemsPerFetch, DEFAULT_MAX_ITEMS_PER_FETCH);
    front.set("max_items_per_fetch", "-10");
    assert.equal(buildSource(front, "")!.maxItemsPerFetch, DEFAULT_MAX_ITEMS_PER_FETCH);
  });

  it("collects unrecognized keys into fetcherParams", () => {
    const front = base();
    front.set("github_repo", "anthropics/claude-code");
    front.set("arxiv_query", "cs.CL");
    const source = buildSource(front, "");
    assert.ok(source);
    assert.deepEqual(source!.fetcherParams, {
      github_repo: "anthropics/claude-code",
      arxiv_query: "cs.CL",
    });
  });

  it("ignores array values in fetcherParams (schema mismatch)", () => {
    const front = base();
    front.set("weird_array", ["a", "b"]);
    const source = buildSource(front, "");
    assert.ok(source);
    assert.equal(source!.fetcherParams["weird_array"], undefined);
  });
});

describe("serializeSource — round trip", () => {
  // Renamed from `makeSource` to avoid shadowing the module-level
  // helper at line 319 (triggers `no-shadow` lint).
  function makeRoundTripSource(over: Partial<Source> = {}): Source {
    return {
      slug: "hn",
      title: "Hacker News",
      url: "https://news.ycombinator.com/rss",
      fetcherKind: "rss",
      fetcherParams: {},
      schedule: "daily",
      categories: ["tech-news", "general"],
      maxItemsPerFetch: 30,
      addedAt: "2026-04-13T00:00:00Z",
      notes: "",
      ...over,
    };
  }

  it("round-trips a minimal Source", () => {
    const source = makeRoundTripSource();
    const serialized = serializeSource(source);
    const parsed = parseSourceFile(serialized);
    assert.ok(parsed);
    const rebuilt = buildSource(parsed!.fields, parsed!.body);
    assert.ok(rebuilt);
    assert.deepEqual(rebuilt, source);
  });

  it("round-trips with fetcherParams", () => {
    const source = makeRoundTripSource({
      fetcherKind: "github-releases",
      fetcherParams: { github_repo: "anthropics/claude-code" },
    });
    const serialized = serializeSource(source);
    const parsed = parseSourceFile(serialized);
    const rebuilt = buildSource(parsed!.fields, parsed!.body);
    assert.deepEqual(rebuilt, source);
  });

  it("round-trips notes body", () => {
    const source = makeRoundTripSource({
      notes: "# Notes\n\nWhy this source matters.\n",
    });
    const serialized = serializeSource(source);
    const parsed = parseSourceFile(serialized);
    const rebuilt = buildSource(parsed!.fields, parsed!.body);
    assert.equal(rebuilt!.notes, source.notes);
  });

  it("quotes values that would confuse the flat-YAML parser", () => {
    // A title containing a colon would otherwise break the reader
    // because the parser splits on the first `:`.
    const source = makeRoundTripSource({
      title: "Weekly: The Best of the Web",
    });
    const serialized = serializeSource(source);
    const parsed = parseSourceFile(serialized);
    const rebuilt = buildSource(parsed!.fields, parsed!.body);
    assert.equal(rebuilt!.title, "Weekly: The Best of the Web");
  });

  it("quotes values that look like reserved YAML atoms", () => {
    // `true`, `null`, numbers, dates — the reader currently
    // returns them as strings, but if we ever add YAML-native
    // scalar types this protects us.
    const source = makeRoundTripSource({ title: "true" });
    const serialized = serializeSource(source);
    const parsed = parseSourceFile(serialized);
    const rebuilt = buildSource(parsed!.fields, parsed!.body);
    assert.equal(rebuilt!.title, "true");
  });

  it("sorts fetcherParams alphabetically for stable diffs", () => {
    const source = makeRoundTripSource({
      fetcherParams: { z_key: "1", a_key: "2", m_key: "3" },
    });
    const serialized = serializeSource(source);
    const aIdx = serialized.indexOf("a_key:");
    const mIdx = serialized.indexOf("m_key:");
    const zIdx = serialized.indexOf("z_key:");
    assert.ok(aIdx > 0 && mIdx > aIdx && zIdx > mIdx);
  });

  it("round-trips values with embedded double-quotes", () => {
    // The serializer writes `\"` inside a double-quoted scalar;
    // unquote() must JSON-decode the escape so the original string
    // comes back. Without this, `He said "hi"` round-trips to
    // `He said \"hi\"`.
    const source = makeRoundTripSource({ title: 'He said "hi"' });
    const serialized = serializeSource(source);
    const parsed = parseSourceFile(serialized);
    const rebuilt = buildSource(parsed!.fields, parsed!.body);
    assert.equal(rebuilt!.title, 'He said "hi"');
  });

  it("round-trips values with backslashes", () => {
    // `C:\tmp` would come back as `C:\\tmp` without proper escape
    // handling.
    const source = makeRoundTripSource({ title: "C:\\tmp\\data" });
    const serialized = serializeSource(source);
    const parsed = parseSourceFile(serialized);
    const rebuilt = buildSource(parsed!.fields, parsed!.body);
    assert.equal(rebuilt!.title, "C:\\tmp\\data");
  });
});

// --- filesystem tests ---------------------------------------------------

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "sources-test-"));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function makeSource(): Source {
  return {
    slug: "hn",
    title: "Hacker News",
    url: "https://news.ycombinator.com/rss",
    fetcherKind: "rss",
    fetcherParams: {},
    schedule: "daily",
    categories: ["tech-news"],
    maxItemsPerFetch: 30,
    addedAt: "2026-04-13T00:00:00Z",
    notes: "",
  };
}

describe("writeSource + readSource — filesystem round trip", () => {
  it("writes and reads back an equivalent Source", async () => {
    const source = makeSource();
    await writeSource(workspace, source);
    const read = await readSource(workspace, "hn");
    assert.deepEqual(read, source);
  });

  it("returns null when the file doesn't exist", async () => {
    const read = await readSource(workspace, "missing");
    assert.equal(read, null);
  });

  it("returns null when the slug in the frontmatter doesn't match the filename", async () => {
    // Defense: someone renames the file on disk without editing
    // the frontmatter. Silently loading with the wrong slug would
    // corrupt downstream state lookups — so we refuse the load.
    const source = makeSource();
    await writeSource(workspace, source);
    // Manually rename on disk to simulate the drift.
    const { rename } = await import("node:fs/promises");
    await rename(sourceFilePath(workspace, "hn"), sourceFilePath(workspace, "renamed"));
    const read = await readSource(workspace, "renamed");
    assert.equal(read, null);
  });

  it("refuses to write an invalid slug", async () => {
    const source: Source = { ...makeSource(), slug: "HACK/../etc" };
    await assert.rejects(() => writeSource(workspace, source), /invalid slug/);
  });

  it("refuses to read an invalid slug", async () => {
    assert.equal(await readSource(workspace, "../etc/passwd"), null);
  });

  it("overwrites an existing source atomically", async () => {
    const first = makeSource();
    await writeSource(workspace, first);
    const second: Source = { ...first, title: "Hacker News (updated)" };
    await writeSource(workspace, second);
    const read = await readSource(workspace, "hn");
    assert.equal(read!.title, "Hacker News (updated)");
  });

  it("does not leave a .tmp file behind after a successful write", async () => {
    await writeSource(workspace, makeSource());
    const { readdir } = await import("node:fs/promises");
    const { sourcesRoot } = await import("../../server/workspace/sources/paths.js");
    const entries = await readdir(sourcesRoot(workspace));
    assert.equal(
      entries.some((name) => name.endsWith(".tmp")),
      false,
    );
  });
});

describe("listSources", () => {
  it("returns [] when the sources directory doesn't exist", async () => {
    assert.deepEqual(await listSources(workspace), []);
  });

  it("returns every valid source file, sorted by slug", async () => {
    const sources = [
      { ...makeSource(), slug: "charlie", title: "C" },
      { ...makeSource(), slug: "alpha", title: "A" },
      { ...makeSource(), slug: "bravo", title: "B" },
    ];
    for (const src of sources) await writeSource(workspace, src);
    const listed = await listSources(workspace);
    assert.deepEqual(
      listed.map((src) => src.slug),
      ["alpha", "bravo", "charlie"],
    );
  });

  it("skips files starting with _", async () => {
    await writeSource(workspace, makeSource());
    // Meta file written alongside by a hypothetical index generator.
    const { writeFile } = await import("node:fs/promises");
    const { sourcesRoot } = await import("../../server/workspace/sources/paths.js");
    await writeFile(join(sourcesRoot(workspace), "_index.md"), "# Index\n");
    const listed = await listSources(workspace);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].slug, "hn");
  });

  it("skips non-.md files", async () => {
    await writeSource(workspace, makeSource());
    const { writeFile } = await import("node:fs/promises");
    const { sourcesRoot } = await import("../../server/workspace/sources/paths.js");
    await writeFile(join(sourcesRoot(workspace), "hn.json"), JSON.stringify({ something: "else" }));
    const listed = await listSources(workspace);
    assert.equal(listed.length, 1);
  });

  it("logs + skips malformed source files without crashing", async () => {
    await writeSource(workspace, makeSource());
    const { writeFile } = await import("node:fs/promises");
    const { sourcesRoot } = await import("../../server/workspace/sources/paths.js");
    await writeFile(join(sourcesRoot(workspace), "broken.md"), "no frontmatter here");
    const listed = await listSources(workspace);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].slug, "hn");
  });
});

describe("deleteSource", () => {
  it("removes an existing source file and returns true", async () => {
    await writeSource(workspace, makeSource());
    const removed = await deleteSource(workspace, "hn");
    assert.equal(removed, true);
    const read = await readSource(workspace, "hn");
    assert.equal(read, null);
  });

  it("returns false when the file doesn't exist", async () => {
    const removed = await deleteSource(workspace, "missing");
    assert.equal(removed, false);
  });

  it("refuses invalid slugs", async () => {
    const removed = await deleteSource(workspace, "../etc/passwd");
    assert.equal(removed, false);
  });
});

describe("writeSource + readFile — serialization shape", () => {
  it("writes a markdown file with the expected frontmatter prefix", async () => {
    await writeSource(workspace, makeSource());
    const raw = await readFile(sourceFilePath(workspace, "hn"), "utf-8");
    assert.ok(raw.startsWith("---\n"));
    assert.match(raw, /\nslug: hn\n/);
    assert.match(raw, /\nfetcher_kind: rss\n/);
    assert.match(raw, /\n---\n/);
  });
});
