import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "fs/promises";
import os from "os";
import path from "path";
import {
  buildSearchMarkdown,
  computeSearchHash,
  computeSearchRelPath,
  formatSearchDateDir,
  writeSearchResult,
} from "../../server/tool-trace/writeSearch.js";

const FIXED_TS = new Date("2026-04-13T05:18:47.123Z");
const SID = "a821d112-539b-4f1b-9e19-adc6e9c6a411";

describe("formatSearchDateDir", () => {
  it("formats a UTC date as YYYY-MM-DD", () => {
    assert.equal(formatSearchDateDir(FIXED_TS), "2026-04-13");
  });

  it("zero-pads single-digit months and days", () => {
    assert.equal(
      formatSearchDateDir(new Date("2026-01-02T00:00:00Z")),
      "2026-01-02",
    );
  });
});

describe("computeSearchHash", () => {
  it("is deterministic for the same inputs", () => {
    const a = computeSearchHash("foo", SID, FIXED_TS);
    const b = computeSearchHash("foo", SID, FIXED_TS);
    assert.equal(a, b);
  });

  it("differs when query changes", () => {
    const a = computeSearchHash("foo", SID, FIXED_TS);
    const b = computeSearchHash("bar", SID, FIXED_TS);
    assert.notEqual(a, b);
  });

  it("differs when sessionId changes", () => {
    const a = computeSearchHash("foo", "session-A", FIXED_TS);
    const b = computeSearchHash("foo", "session-B", FIXED_TS);
    assert.notEqual(a, b);
  });

  it("returns an 8-char base64url-ish string", () => {
    const h = computeSearchHash("foo", SID, FIXED_TS);
    assert.equal(h.length, 8);
    assert.match(h, /^[A-Za-z0-9_-]+$/);
  });
});

describe("computeSearchRelPath", () => {
  it("builds searches/YYYY-MM-DD/<slug>-<hash>.md", () => {
    const p = computeSearchRelPath({
      query: "熊本地震 2016",
      sessionId: SID,
      ts: FIXED_TS,
    });
    assert.ok(p.startsWith("searches/2026-04-13/"));
    assert.ok(p.endsWith(".md"));
  });

  it("produces stable path for identical inputs", () => {
    const a = computeSearchRelPath({
      query: "claude code",
      sessionId: SID,
      ts: FIXED_TS,
    });
    const b = computeSearchRelPath({
      query: "claude code",
      sessionId: SID,
      ts: FIXED_TS,
    });
    assert.equal(a, b);
  });

  it("produces different paths for different queries", () => {
    const a = computeSearchRelPath({
      query: "foo",
      sessionId: SID,
      ts: FIXED_TS,
    });
    const b = computeSearchRelPath({
      query: "bar",
      sessionId: SID,
      ts: FIXED_TS,
    });
    assert.notEqual(a, b);
  });
});

describe("buildSearchMarkdown", () => {
  it("includes YAML frontmatter + heading + body", () => {
    const md = buildSearchMarkdown({
      query: "foo",
      sessionId: SID,
      ts: FIXED_TS,
      resultBody: "- result 1\n- result 2",
    });
    assert.ok(md.startsWith("---\n"));
    assert.ok(md.includes(`query: foo`));
    assert.ok(md.includes(`sessionId: ${SID}`));
    assert.ok(md.includes(`ts: 2026-04-13T05:18:47.123Z`));
    assert.ok(md.includes("# Search: foo"));
    assert.ok(md.includes("- result 1"));
    assert.ok(md.endsWith("\n"), "should end with a trailing newline");
  });

  it("quotes query when it contains a colon", () => {
    const md = buildSearchMarkdown({
      query: "a:b",
      sessionId: SID,
      ts: FIXED_TS,
      resultBody: "body",
    });
    assert.ok(md.includes('query: "a:b"'));
  });

  it("passes through unicode queries unchanged in the heading", () => {
    const md = buildSearchMarkdown({
      query: "熊本地震",
      sessionId: SID,
      ts: FIXED_TS,
      resultBody: "body",
    });
    assert.ok(md.includes("# Search: 熊本地震"));
  });
});

describe("writeSearchResult (I/O)", () => {
  let workspaceRoot: string;

  before(async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "tool-trace-"));
  });

  after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("writes a file under searches/YYYY-MM-DD/ and returns its rel path", async () => {
    const rel = await writeSearchResult({
      workspaceRoot,
      query: "foo query",
      sessionId: SID,
      ts: FIXED_TS,
      resultBody: "top result",
    });
    assert.ok(rel.startsWith("searches/2026-04-13/"));
    const written = await readFile(path.join(workspaceRoot, rel), "utf-8");
    assert.ok(written.includes("top result"));
    assert.ok(written.includes("query: foo-query".replaceAll("-", " ")));
  });

  it("two distinct searches on the same day produce two files", async () => {
    await writeSearchResult({
      workspaceRoot,
      query: "alpha",
      sessionId: SID,
      ts: FIXED_TS,
      resultBody: "a",
    });
    await writeSearchResult({
      workspaceRoot,
      query: "beta",
      sessionId: SID,
      ts: FIXED_TS,
      resultBody: "b",
    });
    const dir = path.join(workspaceRoot, "searches", "2026-04-13");
    const files = (await readdir(dir)).filter((n) => n.endsWith(".md"));
    // At least two files (prior test in this block wrote one too).
    assert.ok(files.length >= 2);
  });
});
