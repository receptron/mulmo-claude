import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildDailyJsonIndex,
  assembleDailyFile,
  writeDailyFile,
  renderItemForArchive,
  archiveMonthFor,
  groupItemsForArchive,
  appendItemsToArchives,
} from "../../server/workspace/sources/pipeline/write.js";
import { archivePath, dailyNewsPath } from "../../server/workspace/sources/paths.js";
import type { SourceItem } from "../../server/workspace/sources/types.js";

function makeItem(over: Partial<SourceItem> = {}): SourceItem {
  return {
    id: "abc",
    title: "A thing",
    url: "https://example.com/a",
    publishedAt: "2026-04-13T10:00:00Z",
    categories: ["tech-news", "ai"],
    sourceSlug: "hn",
    summary: "short summary",
    ...over,
  };
}

// --- buildDailyJsonIndex -----------------------------------------------

describe("buildDailyJsonIndex", () => {
  it("returns zero counts for empty input", () => {
    const idx = buildDailyJsonIndex([]);
    assert.equal(idx.itemCount, 0);
    assert.deepEqual(idx.byCategory, {});
    assert.deepEqual(idx.items, []);
  });

  it("sums per-category counts (items may span multiple categories)", () => {
    const idx = buildDailyJsonIndex([
      makeItem({ id: "1", categories: ["ai", "tech-news"] }),
      makeItem({ id: "2", categories: ["ai"] }),
      makeItem({ id: "3", categories: ["security"] }),
    ]);
    assert.equal(idx.itemCount, 3);
    assert.deepEqual(idx.byCategory, {
      ai: 2,
      "tech-news": 1,
      security: 1,
    });
  });

  it("strips `summary` / `content` — only compact metadata goes into JSON", () => {
    const idx = buildDailyJsonIndex([makeItem({ summary: "s", content: "c" })]);
    const item = idx.items[0];
    assert.equal("summary" in item, false);
    assert.equal("content" in item, false);
  });

  it("preserves `severity` when set", () => {
    const idx = buildDailyJsonIndex([makeItem({ severity: "critical" })]);
    assert.equal(idx.items[0].severity, "critical");
  });
});

// --- assembleDailyFile --------------------------------------------------

describe("assembleDailyFile", () => {
  it("appends a ```json fenced block with the structured index", () => {
    const md = "# Daily brief\n\n## AI\n- foo\n";
    const file = assembleDailyFile(md, [makeItem()]);
    assert.match(file, /# Daily brief/);
    assert.match(file, /```json/);
    // JSON block must parse.
    const jsonMatch = /```json\n([\s\S]*?)\n```/.exec(file);
    assert.ok(jsonMatch);
    const parsed = JSON.parse(jsonMatch![1]);
    assert.equal(parsed.itemCount, 1);
    assert.equal(parsed.items[0].title, "A thing");
  });

  it("ends with a final newline after the ``` fence", () => {
    const file = assembleDailyFile("# brief\n", []);
    assert.ok(file.endsWith("\n"));
    assert.match(file, /```\n$/);
  });

  it("handles markdown with no trailing newline", () => {
    const file = assembleDailyFile("# brief", []);
    assert.match(file, /# brief\n\n```json/);
  });
});

// --- archiveMonthFor ---------------------------------------------------

describe("archiveMonthFor", () => {
  it("extracts YYYY-MM from a valid ISO timestamp", () => {
    assert.equal(archiveMonthFor("2026-04-13T10:00:00Z", "2026-01"), "2026-04");
    assert.equal(archiveMonthFor("2026-12-31T23:00:00Z", "2026-01"), "2026-12");
    assert.equal(archiveMonthFor("2026-01-01T00:00:00Z", "2026-01"), "2026-01");
  });

  it("falls back to the default month on malformed dates", () => {
    assert.equal(archiveMonthFor("not-a-date", "2026-04"), "2026-04");
    assert.equal(archiveMonthFor("", "2026-04"), "2026-04");
  });
});

// --- groupItemsForArchive ----------------------------------------------

describe("groupItemsForArchive", () => {
  it("groups by (sourceSlug, YYYY-MM)", () => {
    const items = [
      makeItem({
        id: "1",
        sourceSlug: "hn",
        publishedAt: "2026-04-10T00:00:00Z",
      }),
      makeItem({
        id: "2",
        sourceSlug: "hn",
        publishedAt: "2026-04-11T00:00:00Z",
      }),
      makeItem({
        id: "3",
        sourceSlug: "reddit",
        publishedAt: "2026-04-12T00:00:00Z",
      }),
      makeItem({
        id: "4",
        sourceSlug: "hn",
        publishedAt: "2026-05-01T00:00:00Z",
      }),
    ];
    const groups = groupItemsForArchive(items, "2026-04");
    assert.equal(groups.get("hn::2026-04")!.length, 2);
    assert.equal(groups.get("hn::2026-05")!.length, 1);
    assert.equal(groups.get("reddit::2026-04")!.length, 1);
  });

  it("uses the fallback month for items with malformed publishedAt", () => {
    const items = [makeItem({ id: "1", sourceSlug: "hn", publishedAt: "bogus" })];
    const groups = groupItemsForArchive(items, "2026-04");
    assert.equal(groups.get("hn::2026-04")!.length, 1);
  });
});

// --- renderItemForArchive ----------------------------------------------

describe("renderItemForArchive", () => {
  it("renders title, metadata, summary and the trailing separator", () => {
    const md = renderItemForArchive(makeItem({ title: "Cool thing", summary: "It's cool" }));
    assert.match(md, /^## Cool thing/);
    assert.match(md, /\*\*Published:\*\* 2026-04-13T10:00:00Z/);
    assert.match(md, /\*\*Source:\*\* hn/);
    assert.match(md, /\*\*URL:\*\* https:\/\/example\.com\/a/);
    assert.match(md, /\*\*Categories:\*\* tech-news, ai/);
    assert.match(md, /It's cool/);
    // Ends with the separator line (blank + --- + final newline).
    assert.match(md, /---\n$/);
  });

  it("omits content when identical to summary (no repetition)", () => {
    const md = renderItemForArchive(makeItem({ summary: "same text", content: "same text" }));
    // summary appears once, not twice.
    const matches = md.match(/same text/g) ?? [];
    assert.equal(matches.length, 1);
  });

  it("includes severity line when set", () => {
    const md = renderItemForArchive(makeItem({ severity: "critical" }));
    assert.match(md, /\*\*Severity:\*\* critical/);
  });

  it("omits Categories line when categories is empty", () => {
    const md = renderItemForArchive(makeItem({ categories: [] }));
    assert.doesNotMatch(md, /\*\*Categories:\*\*/);
  });
});

// --- filesystem tests ---------------------------------------------------

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "pipeline-write-test-"));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("writeDailyFile", () => {
  it("writes the daily file atomically and creates parent dirs", async () => {
    const target = await writeDailyFile(workspace, "2026-04-13", "# brief\n", [makeItem()]);
    assert.equal(target, dailyNewsPath(workspace, "2026-04-13"));
    const raw = await readFile(target, "utf-8");
    assert.match(raw, /# brief/);
    assert.match(raw, /```json/);
  });

  it("overwrites an existing daily file atomically", async () => {
    await writeDailyFile(workspace, "2026-04-13", "# first\n", []);
    await writeDailyFile(workspace, "2026-04-13", "# second\n", []);
    const raw = await readFile(dailyNewsPath(workspace, "2026-04-13"), "utf-8");
    assert.match(raw, /# second/);
    assert.doesNotMatch(raw, /# first/);
  });
});

describe("appendItemsToArchives", () => {
  it("appends each source-month group to its archive file", async () => {
    const items = [
      makeItem({
        id: "1",
        sourceSlug: "hn",
        title: "HN item",
        publishedAt: "2026-04-10T00:00:00Z",
      }),
      makeItem({
        id: "2",
        sourceSlug: "reddit",
        title: "Reddit item",
        publishedAt: "2026-04-12T00:00:00Z",
      }),
    ];
    const out = await appendItemsToArchives(workspace, items, "2026-04");
    assert.equal(out.errors.length, 0);
    assert.equal(out.writtenPaths.length, 2);

    const hnArchive = await readFile(archivePath(workspace, "hn", "2026-04"), "utf-8");
    assert.match(hnArchive, /## HN item/);
    const redditArchive = await readFile(archivePath(workspace, "reddit", "2026-04"), "utf-8");
    assert.match(redditArchive, /## Reddit item/);
  });

  it("appends across runs rather than overwriting", async () => {
    await appendItemsToArchives(workspace, [makeItem({ id: "1", title: "First" })], "2026-04");
    await appendItemsToArchives(workspace, [makeItem({ id: "2", title: "Second" })], "2026-04");
    const archive = await readFile(archivePath(workspace, "hn", "2026-04"), "utf-8");
    assert.match(archive, /## First/);
    assert.match(archive, /## Second/);
  });

  it("returns empty arrays for empty input", async () => {
    const out = await appendItemsToArchives(workspace, [], "2026-04");
    assert.deepEqual(out.writtenPaths, []);
    assert.deepEqual(out.errors, []);
  });

  it("routes items in different months to different files", async () => {
    const items = [
      makeItem({
        id: "apr",
        title: "April item",
        publishedAt: "2026-04-10T00:00:00Z",
      }),
      makeItem({
        id: "may",
        title: "May item",
        publishedAt: "2026-05-01T00:00:00Z",
      }),
    ];
    await appendItemsToArchives(workspace, items, "2026-04");
    const aprArchive = await readFile(archivePath(workspace, "hn", "2026-04"), "utf-8");
    const mayArchive = await readFile(archivePath(workspace, "hn", "2026-05"), "utf-8");
    assert.match(aprArchive, /April item/);
    assert.doesNotMatch(aprArchive, /May item/);
    assert.match(mayArchive, /May item/);
    assert.doesNotMatch(mayArchive, /April item/);
  });
});
