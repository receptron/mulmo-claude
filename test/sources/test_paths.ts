import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  sourcesRoot,
  sourceFilePath,
  sourceStatePath,
  robotsCachePath,
  dailyNewsPath,
  archivePath,
  isValidSlug,
} from "../../server/sources/paths.js";

const root = path.join("/tmp", "ws");

describe("path helpers", () => {
  it("sourcesRoot joins under workspace", () => {
    assert.equal(sourcesRoot(root), path.join(root, "sources"));
  });

  it("sourceFilePath builds workspace/sources/<slug>.md", () => {
    assert.equal(
      sourceFilePath(root, "hn-front-page"),
      path.join(root, "sources", "hn-front-page.md"),
    );
  });

  it("sourceStatePath nests under _state", () => {
    assert.equal(
      sourceStatePath(root, "hn-front-page"),
      path.join(root, "sources", "_state", "hn-front-page.json"),
    );
  });

  it("robotsCachePath sanitizes colons in host:port", () => {
    // Hosts with explicit ports have colons that break on some
    // filesystems. Colon → underscore.
    const p = robotsCachePath(root, "example.com:8080");
    assert.equal(
      p,
      path.join(root, "sources", "_state", "robots", "example.com_8080.txt"),
    );
  });

  it("dailyNewsPath splits YYYY-MM-DD into year / month / day.md", () => {
    assert.equal(
      dailyNewsPath(root, "2026-04-13"),
      path.join(root, "news", "daily", "2026", "04", "13.md"),
    );
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
    assert.equal(
      archivePath(root, "hn-front-page", "2026-04"),
      path.join(root, "news", "archive", "hn-front-page", "2026", "04.md"),
    );
  });

  it("archivePath splits the year-month even for edge months", () => {
    assert.equal(
      archivePath(root, "x", "2026-01"),
      path.join(root, "news", "archive", "x", "2026", "01.md"),
    );
    assert.equal(
      archivePath(root, "x", "2026-12"),
      path.join(root, "news", "archive", "x", "2026", "12.md"),
    );
  });

  it("archivePath rejects invalid year-month strings", () => {
    assert.throws(() => archivePath(root, "x", "2026/04"), /YYYY-MM/);
    assert.throws(() => archivePath(root, "x", "2026-4"), /YYYY-MM/);
    assert.throws(() => archivePath(root, "x", "26-04"), /YYYY-MM/);
    assert.throws(() => archivePath(root, "x", ""), /YYYY-MM/);
  });
});

describe("isValidSlug", () => {
  it("accepts simple kebab-case slugs", () => {
    assert.equal(isValidSlug("hn"), true);
    assert.equal(isValidSlug("hn-front-page"), true);
    assert.equal(isValidSlug("anthropic-releases"), true);
    assert.equal(isValidSlug("a"), true);
    assert.equal(isValidSlug("arxiv-cs-cl"), true);
  });

  it("accepts digits", () => {
    assert.equal(isValidSlug("arxiv-2024"), true);
    assert.equal(isValidSlug("news3"), true);
    assert.equal(isValidSlug("100"), true);
  });

  it("rejects empty / too-long", () => {
    assert.equal(isValidSlug(""), false);
    assert.equal(isValidSlug("a".repeat(65)), false);
  });

  it("rejects uppercase", () => {
    assert.equal(isValidSlug("HN"), false);
    assert.equal(isValidSlug("Hacker-News"), false);
  });

  it("rejects underscores / dots / slashes / spaces", () => {
    assert.equal(isValidSlug("hn_front"), false);
    assert.equal(isValidSlug("hn.front"), false);
    assert.equal(isValidSlug("hn/front"), false);
    assert.equal(isValidSlug("hn front"), false);
  });

  it("rejects leading / trailing hyphen", () => {
    assert.equal(isValidSlug("-hn"), false);
    assert.equal(isValidSlug("hn-"), false);
    assert.equal(isValidSlug("-"), false);
  });

  it("rejects consecutive hyphens", () => {
    assert.equal(isValidSlug("hn--front"), false);
  });

  it("rejects path-traversal attempts", () => {
    // Defense: the slug doubles as a filename, so ".." or "x/y"
    // would let a caller escape the sources dir. The regex
    // already rejects these but pin the intent.
    assert.equal(isValidSlug(".."), false);
    assert.equal(isValidSlug("../etc/passwd"), false);
    assert.equal(isValidSlug("foo/../bar"), false);
    assert.equal(isValidSlug(".hidden"), false);
  });

  it("rejects non-string", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.equal(isValidSlug(null as any), false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.equal(isValidSlug(42 as any), false);
  });
});
