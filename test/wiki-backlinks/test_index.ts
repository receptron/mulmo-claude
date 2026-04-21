import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { maybeAppendWikiBacklinks, type WikiBacklinksDeps } from "../../server/workspace/wiki-backlinks/index.js";
import { BACKLINKS_MARKER } from "../../server/workspace/wiki-backlinks/sessionBacklinks.js";
import { WORKSPACE_DIRS } from "../../server/workspace/paths.js";

const SID = "3e0382cb-f02f-4f5b-a9a3-a71e50d7ad0c";

// Relative path from a wiki page (data/wiki/pages/) to the chat jsonl
// (conversations/chat/). Derived from WORKSPACE_DIRS so the layout
// rename in #284 — or any future rename — only needs one source-of-
// truth update.
const EXPECTED_BACKLINK_HREF = path.posix.join("..", "..", "..", WORKSPACE_DIRS.chat, `${SID}.jsonl`);

async function setMtime(filePath: string, mtimeMs: number): Promise<void> {
  const secs = mtimeMs / 1000;
  await utimes(filePath, secs, secs);
}

describe("maybeAppendWikiBacklinks (driver)", () => {
  let workspaceRoot: string;

  before(async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "wiki-backlinks-"));
  });

  after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("no-op when wiki/pages/ does not exist", async () => {
    await maybeAppendWikiBacklinks({
      chatSessionId: SID,
      turnStartedAt: Date.now(),
      workspaceRoot,
    });
    // Should complete without throwing. No assertion beyond that.
  });

  it("appends backlink to a page modified during the turn", async () => {
    const pagesDir = path.join(workspaceRoot, WORKSPACE_DIRS.wikiPages);
    await mkdir(pagesDir, { recursive: true });

    const filePath = path.join(pagesDir, "topic.md");
    await writeFile(filePath, "# Topic\n\nBody.\n", "utf-8");

    const turnStartedAt = Date.now() - 5000; // well in the past
    // Ensure mtime is after turnStartedAt (it will be, since we just wrote).
    await maybeAppendWikiBacklinks({
      chatSessionId: SID,
      turnStartedAt,
      workspaceRoot,
    });

    const updated = await readFile(filePath, "utf-8");
    assert.ok(updated.includes(BACKLINKS_MARKER));
    assert.ok(updated.includes(`[session 3e0382cb]`));
    assert.ok(updated.includes(EXPECTED_BACKLINK_HREF));
  });

  it("skips a page whose mtime is older than the turn start", async () => {
    const pagesDir = path.join(workspaceRoot, WORKSPACE_DIRS.wikiPages);
    await mkdir(pagesDir, { recursive: true });

    const oldPath = path.join(pagesDir, "old.md");
    await writeFile(oldPath, "# Old\n\nOld body.\n", "utf-8");
    // Set mtime to well before the turn start.
    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    await setMtime(oldPath, tenMinAgo);

    await maybeAppendWikiBacklinks({
      chatSessionId: SID,
      turnStartedAt: Date.now(),
      workspaceRoot,
    });

    const unchanged = await readFile(oldPath, "utf-8");
    assert.ok(!unchanged.includes(BACKLINKS_MARKER));
  });

  it("does not rewrite a file whose content is already up-to-date (dedupe)", async () => {
    const pagesDir = path.join(workspaceRoot, WORKSPACE_DIRS.wikiPages);
    await mkdir(pagesDir, { recursive: true });

    const filePath = path.join(pagesDir, "already.md");
    const original = ["# Already", "", "Body.", "", BACKLINKS_MARKER, "## History", "", `- [session 3e0382cb](${EXPECTED_BACKLINK_HREF})`, ""].join("\n");
    await writeFile(filePath, original, "utf-8");

    let writeCalls = 0;
    const deps: Partial<WikiBacklinksDeps> = {
      writeFile: async (__p: string, __c: string) => {
        writeCalls++;
      },
    };

    await maybeAppendWikiBacklinks({
      chatSessionId: SID,
      turnStartedAt: Date.now() - 5000,
      workspaceRoot,
      deps,
    });

    assert.equal(writeCalls, 0, "no write when content is unchanged");
    const onDisk = await readFile(filePath, "utf-8");
    assert.equal(onDisk, original);
  });

  it("continues past one failed file and updates the rest", async () => {
    const pagesDir = path.join(workspaceRoot, WORKSPACE_DIRS.wikiPages);
    await mkdir(pagesDir, { recursive: true });

    const okPath = path.join(pagesDir, "ok.md");
    const brokenPath = path.join(pagesDir, "broken.md");
    await writeFile(okPath, "# OK\n", "utf-8");
    await writeFile(brokenPath, "# Broken\n", "utf-8");

    const deps: Partial<WikiBacklinksDeps> = {
      readFile: async (filePath: string) => {
        if (filePath.endsWith("broken.md")) throw new Error("simulated read failure");
        return readFile(filePath, "utf-8");
      },
    };

    await maybeAppendWikiBacklinks({
      chatSessionId: SID,
      turnStartedAt: Date.now() - 5000,
      workspaceRoot,
      deps,
    });

    const okContent = await readFile(okPath, "utf-8");
    assert.ok(okContent.includes(BACKLINKS_MARKER));
    // Broken page untouched (read threw before write).
    const brokenContent = await readFile(brokenPath, "utf-8");
    assert.equal(brokenContent, "# Broken\n");
  });

  it("no-op on empty chatSessionId (defensive)", async () => {
    const pagesDir = path.join(workspaceRoot, WORKSPACE_DIRS.wikiPages);
    await mkdir(pagesDir, { recursive: true });
    const filePath = path.join(pagesDir, "defensive.md");
    await writeFile(filePath, "# Defensive\n", "utf-8");

    await maybeAppendWikiBacklinks({
      chatSessionId: "",
      turnStartedAt: 0,
      workspaceRoot,
    });

    const content = await readFile(filePath, "utf-8");
    assert.equal(content, "# Defensive\n");
  });
});
