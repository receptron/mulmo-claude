import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { sourcesRoot, sourceFilePath, sourceStatePath, robotsCachePath, dailyNewsPath, archivePath } from "../../server/workspace/sources/paths.js";

const root = path.join("/tmp", "ws");

describe("path helpers", () => {
  it("sourcesRoot joins under workspace", () => {
    assert.equal(sourcesRoot(root), path.join(root, "sources"));
  });

  it("sourceFilePath builds workspace/sources/<slug>.md", () => {
    assert.equal(sourceFilePath(root, "hn-front-page"), path.join(root, "sources", "hn-front-page.md"));
  });

  it("sourceStatePath nests under _state", () => {
    assert.equal(sourceStatePath(root, "hn-front-page"), path.join(root, "sources", "_state", "hn-front-page.json"));
  });

  it("robotsCachePath sanitizes colons in host:port", () => {
    // Hosts with explicit ports have colons that break on some
    // filesystems. Colon → underscore.
    const p = robotsCachePath(root, "example.com:8080");
    assert.equal(p, path.join(root, "sources", "_state", "robots", "example.com_8080.txt"));
  });

  it("dailyNewsPath splits YYYY-MM-DD into year / month / day.md", () => {
    assert.equal(dailyNewsPath(root, "2026-04-13"), path.join(root, "news", "daily", "2026", "04", "13.md"));
  });

  it("dailyNewsPath rejects invalid date strings", () => {
    assert.throws(() => dailyNewsPath(root, ""), /YYYY-MM-DD/);
    assert.throws(() => dailyNewsPath(root, "2026/04/13"), /YYYY-MM-DD/);
    assert.throws(() => dailyNewsPath(root, "2026-4-13"), /YYYY-MM-DD/);
    assert.throws(() => dailyNewsPath(root, "foo"), /YYYY-MM-DD/);
  });

  it("archivePath builds news/archive/<slug>/YYYY/MM.md", () => {
    // The year and month are split into nested dirs so a
    // long-running workspace doesn't end up with 60+ flat files
    // in a single source's archive dir — matches daily/YYYY/MM/DD.md.
    assert.equal(archivePath(root, "hn-front-page", "2026-04"), path.join(root, "news", "archive", "hn-front-page", "2026", "04.md"));
  });

  it("archivePath splits the year-month even for edge months", () => {
    assert.equal(archivePath(root, "x", "2026-01"), path.join(root, "news", "archive", "x", "2026", "01.md"));
    assert.equal(archivePath(root, "x", "2026-12"), path.join(root, "news", "archive", "x", "2026", "12.md"));
  });

  it("archivePath rejects invalid year-month strings", () => {
    assert.throws(() => archivePath(root, "x", "2026/04"), /YYYY-MM/);
    assert.throws(() => archivePath(root, "x", "2026-4"), /YYYY-MM/);
    assert.throws(() => archivePath(root, "x", "26-04"), /YYYY-MM/);
    assert.throws(() => archivePath(root, "x", ""), /YYYY-MM/);
  });
});

// isValidSlug tests moved to test/utils/test_slug.ts — the function
// itself was consolidated to server/utils/slug.ts in PR #377.
