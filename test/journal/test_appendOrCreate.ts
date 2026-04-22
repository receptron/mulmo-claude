import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { WORKSPACE_DIRS } from "../../server/workspace/paths.js";
import { appendOrCreateTopic } from "../../server/utils/files/journal-io.js";

function makeWorkspace(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mulmoclaude-aoc-"));
  // Create the summaries/topics/ dir inside the workspace root
  mkdirSync(path.join(dir, WORKSPACE_DIRS.summaries, "topics"), {
    recursive: true,
  });
  return realpathSync(dir);
}

function rmDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function topicPath(root: string, slug: string): string {
  return path.join(root, WORKSPACE_DIRS.summaries, "topics", `${slug}.md`);
}

describe("appendOrCreateTopic — happy paths", () => {
  let root: string;
  before(() => {
    root = makeWorkspace();
  });
  after(() => rmDir(root));

  it("writes a fresh file when missing and reports 'created'", async () => {
    const outcome = await appendOrCreateTopic("topic-a", "first line", root);
    assert.equal(outcome, "created");
    assert.equal(readFileSync(topicPath(root, "topic-a"), "utf-8"), "first line");
  });

  it("appends with a blank-line separator and reports 'updated'", async () => {
    writeFileSync(topicPath(root, "topic-b"), "existing line");
    const outcome = await appendOrCreateTopic("topic-b", "new line", root);
    assert.equal(outcome, "updated");
    assert.equal(readFileSync(topicPath(root, "topic-b"), "utf-8"), "existing line\n\nnew line\n");
  });

  it("trims trailing whitespace from existing content before appending", async () => {
    writeFileSync(topicPath(root, "topic-c"), "existing\n\n\n");
    await appendOrCreateTopic("topic-c", "added", root);
    assert.equal(readFileSync(topicPath(root, "topic-c"), "utf-8"), "existing\n\nadded\n");
  });

  it("appends correctly across multiple calls", async () => {
    await appendOrCreateTopic("topic-d", "one", root);
    await appendOrCreateTopic("topic-d", "two", root);
    await appendOrCreateTopic("topic-d", "three", root);
    assert.equal(readFileSync(topicPath(root, "topic-d"), "utf-8"), "one\n\ntwo\n\nthree\n");
  });
});

describe("appendOrCreateTopic — non-ENOENT read errors", () => {
  let root: string;
  before(() => {
    root = makeWorkspace();
  });
  after(() => {
    try {
      chmodSync(root, 0o755);
    } catch {
      /* ignore */
    }
    rmDir(root);
  });

  it("rethrows EACCES instead of clobbering an unreadable file", async (testCtx) => {
    if (process.platform === "win32" || process.getuid?.() === 0) {
      testCtx.skip("requires POSIX permissions and a non-root user");
      return;
    }
    const lockPath = topicPath(root, "locked");
    writeFileSync(lockPath, "important content");
    chmodSync(lockPath, 0o000);
    try {
      await assert.rejects(() => appendOrCreateTopic("locked", "would clobber", root), /EACCES|EPERM/);
      chmodSync(lockPath, 0o644);
      assert.equal(readFileSync(lockPath, "utf-8"), "important content");
    } finally {
      try {
        chmodSync(lockPath, 0o644);
      } catch {
        /* ignore */
      }
    }
  });
});
