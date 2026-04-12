import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { appendOrCreate } from "../../server/journal/dailyPass.js";

function makeScratch(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mulmoclaude-aoc-"));
  return fs.realpathSync(dir);
}

function rm(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe("appendOrCreate — happy paths", () => {
  let scratch: string;
  before(() => {
    scratch = makeScratch();
  });
  after(() => rm(scratch));

  it("writes a fresh file when missing and reports 'created'", async () => {
    const p = path.join(scratch, "topic-a.md");
    const outcome = await appendOrCreate(p, "first line");
    assert.equal(outcome, "created");
    assert.equal(fs.readFileSync(p, "utf-8"), "first line");
  });

  it("appends with a blank-line separator and reports 'updated'", async () => {
    const p = path.join(scratch, "topic-b.md");
    fs.writeFileSync(p, "existing line");
    const outcome = await appendOrCreate(p, "new line");
    assert.equal(outcome, "updated");
    assert.equal(fs.readFileSync(p, "utf-8"), "existing line\n\nnew line\n");
  });

  it("trims trailing whitespace from existing content before appending", async () => {
    const p = path.join(scratch, "topic-c.md");
    fs.writeFileSync(p, "existing\n\n\n");
    await appendOrCreate(p, "added");
    assert.equal(fs.readFileSync(p, "utf-8"), "existing\n\nadded\n");
  });

  it("appends correctly across multiple calls (trimEnd before each join)", async () => {
    const p = path.join(scratch, "topic-d.md");
    await appendOrCreate(p, "one");
    await appendOrCreate(p, "two");
    await appendOrCreate(p, "three");
    // Each append trims the previous trailing newline before joining
    // with "\n\n", so blank lines never multiply.
    assert.equal(fs.readFileSync(p, "utf-8"), "one\n\ntwo\n\nthree\n");
  });
});

// REGRESSION GUARD for the data-loss bug CodeRabbit caught:
// readTextOrNull-based versions returned null on ANY read error, so
// a transient EACCES on an existing topic file would cause
// appendOrCreate to clobber it. The fixed version distinguishes
// ENOENT and rethrows everything else.
describe("appendOrCreate — non-ENOENT read errors", () => {
  let scratch: string;
  before(() => {
    scratch = makeScratch();
  });
  after(() => {
    // Restore mode in case the test failed mid-flight, otherwise rm
    // can't traverse the dir.
    try {
      fs.chmodSync(scratch, 0o755);
    } catch {
      /* ignore */
    }
    rm(scratch);
  });

  it("rethrows EACCES instead of clobbering an unreadable file", async (t) => {
    if (process.platform === "win32" || process.getuid?.() === 0) {
      // Windows perms don't behave the same way; root bypasses chmod.
      t.skip("requires POSIX permissions and a non-root user");
      return;
    }
    const p = path.join(scratch, "locked.md");
    fs.writeFileSync(p, "important content");
    fs.chmodSync(p, 0o000);
    try {
      await assert.rejects(
        () => appendOrCreate(p, "would clobber"),
        /EACCES|EPERM/,
      );
      // Restore perms and verify the file was NOT touched.
      fs.chmodSync(p, 0o644);
      assert.equal(fs.readFileSync(p, "utf-8"), "important content");
    } finally {
      try {
        fs.chmodSync(p, 0o644);
      } catch {
        /* ignore */
      }
    }
  });
});
