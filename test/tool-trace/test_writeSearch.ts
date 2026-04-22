import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import {
  buildSearchMarkdown,
  computeSearchHash,
  computeSearchRelPath,
  formatSearchDateDir,
  writeSearchResult,
} from "../../server/workspace/tool-trace/writeSearch.js";

const FIXED_TS = new Date("2026-04-13T05:18:47.123Z");
const SID = "a821d112-539b-4f1b-9e19-adc6e9c6a411";

describe("formatSearchDateDir", () => {
  it("formats a UTC date as YYYY-MM-DD", () => {
    assert.equal(formatSearchDateDir(FIXED_TS), "2026-04-13");
  });

  it("zero-pads single-digit months and days", () => {
    assert.equal(formatSearchDateDir(new Date("2026-01-02T00:00:00Z")), "2026-01-02");
  });
});

describe("computeSearchHash", () => {
  it("is deterministic for the same inputs", () => {
    const hash1 = computeSearchHash("foo", SID, FIXED_TS);
    const hash2 = computeSearchHash("foo", SID, FIXED_TS);
    assert.equal(hash1, hash2);
  });

  it("differs when query changes", () => {
    const hash1 = computeSearchHash("foo", SID, FIXED_TS);
    const hash2 = computeSearchHash("bar", SID, FIXED_TS);
    assert.notEqual(hash1, hash2);
  });

  it("differs when sessionId changes", () => {
    const hash1 = computeSearchHash("foo", "session-A", FIXED_TS);
    const hash2 = computeSearchHash("foo", "session-B", FIXED_TS);
    assert.notEqual(hash1, hash2);
  });

  it("returns an 8-char base64url-ish string", () => {
    const hash = computeSearchHash("foo", SID, FIXED_TS);
    assert.equal(hash.length, 8);
    assert.match(hash, /^[A-Za-z0-9_-]+$/);
  });
});

describe("computeSearchRelPath", () => {
  it("builds conversations/searches/YYYY-MM-DD/<slug>-<hash>.md", () => {
    const relPath = computeSearchRelPath({
      query: "熊本地震 2016",
      sessionId: SID,
      timestamp: FIXED_TS,
    });
    assert.ok(relPath.startsWith("conversations/searches/2026-04-13/"));
    assert.ok(relPath.endsWith(".md"));
  });

  it("produces stable path for identical inputs", () => {
    const path1 = computeSearchRelPath({
      query: "claude code",
      sessionId: SID,
      timestamp: FIXED_TS,
    });
    const path2 = computeSearchRelPath({
      query: "claude code",
      sessionId: SID,
      timestamp: FIXED_TS,
    });
    assert.equal(path1, path2);
  });

  it("produces different paths for different queries", () => {
    const path1 = computeSearchRelPath({
      query: "foo",
      sessionId: SID,
      timestamp: FIXED_TS,
    });
    const path2 = computeSearchRelPath({
      query: "bar",
      sessionId: SID,
      timestamp: FIXED_TS,
    });
    assert.notEqual(path1, path2);
  });
});

describe("buildSearchMarkdown", () => {
  it("includes YAML frontmatter + heading + body", () => {
    const markdown = buildSearchMarkdown({
      query: "foo",
      sessionId: SID,
      timestamp: FIXED_TS,
      resultBody: "- result 1\n- result 2",
    });
    assert.ok(markdown.startsWith("---\n"));
    assert.ok(markdown.includes(`query: foo`));
    assert.ok(markdown.includes(`sessionId: ${SID}`));
    assert.ok(markdown.includes(`ts: 2026-04-13T05:18:47.123Z`));
    assert.ok(markdown.includes("# Search: foo"));
    assert.ok(markdown.includes("- result 1"));
    assert.ok(markdown.endsWith("\n"), "should end with a trailing newline");
  });

  it("quotes query when it contains a colon", () => {
    const markdown = buildSearchMarkdown({
      query: "a:b",
      sessionId: SID,
      timestamp: FIXED_TS,
      resultBody: "body",
    });
    assert.ok(markdown.includes('query: "a:b"'));
  });

  it("passes through unicode queries unchanged in the heading", () => {
    const markdown = buildSearchMarkdown({
      query: "熊本地震",
      sessionId: SID,
      timestamp: FIXED_TS,
      resultBody: "body",
    });
    assert.ok(markdown.includes("# Search: 熊本地震"));
  });
});

describe("writeSearchResult (I/O)", () => {
  let workspaceRoot: string;

  before(async () => {
    workspaceRoot = await mkdtemp(path.join(tmpdir(), "tool-trace-"));
  });

  after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("writes a file under conversations/searches/YYYY-MM-DD/ and returns its rel path", async () => {
    const rel = await writeSearchResult({
      workspaceRoot,
      query: "foo query",
      sessionId: SID,
      timestamp: FIXED_TS,
      resultBody: "top result",
    });
    assert.ok(rel.startsWith("conversations/searches/2026-04-13/"));
    const written = await readFile(path.join(workspaceRoot, rel), "utf-8");
    assert.ok(written.includes("top result"));
    assert.ok(written.includes("query: foo-query".replaceAll("-", " ")));
  });

  it("two distinct searches on the same day produce two files", async () => {
    await writeSearchResult({
      workspaceRoot,
      query: "alpha",
      sessionId: SID,
      timestamp: FIXED_TS,
      resultBody: "a",
    });
    await writeSearchResult({
      workspaceRoot,
      query: "beta",
      sessionId: SID,
      timestamp: FIXED_TS,
      resultBody: "b",
    });
    const dir = path.join(workspaceRoot, "conversations", "searches", "2026-04-13");
    const files = (await readdir(dir)).filter((name) => name.endsWith(".md"));
    // At least two files (prior test in this block wrote one too).
    assert.ok(files.length >= 2);
  });
});
