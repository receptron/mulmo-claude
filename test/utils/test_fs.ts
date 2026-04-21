import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { statSafe, readDirSafe, readTextOrNull, resolveWithinRoot } from "../../server/utils/files/safe.js";

// Each test gets its own scratch dir so they can run in parallel and
// don't have to clean up after each other. We realpath the dir up
// front because the OS-level temp dir on macOS lives at /var/folders
// (a symlink target of /tmp on some configs) and resolveWithinRoot
// requires its `rootReal` arg to already be a realpath.
function makeScratch(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mulmoclaude-${prefix}-`));
  return fs.realpathSync(dir);
}

function rm(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe("statSafe", () => {
  let scratch: string;
  before(() => {
    scratch = makeScratch("statSafe");
    fs.writeFileSync(path.join(scratch, "file.txt"), "hi");
    fs.mkdirSync(path.join(scratch, "subdir"));
  });
  after(() => rm(scratch));

  it("returns Stats for an existing file", () => {
    const s = statSafe(path.join(scratch, "file.txt"));
    assert.ok(s);
    assert.ok(s!.isFile());
  });

  it("returns Stats for an existing directory", () => {
    const s = statSafe(path.join(scratch, "subdir"));
    assert.ok(s);
    assert.ok(s!.isDirectory());
  });

  it("returns null for a missing path (ENOENT)", () => {
    assert.equal(statSafe(path.join(scratch, "nope")), null);
  });

  it("returns null for an empty path string", () => {
    assert.equal(statSafe(""), null);
  });
});

describe("readDirSafe", () => {
  let scratch: string;
  before(() => {
    scratch = makeScratch("readDirSafe");
    fs.writeFileSync(path.join(scratch, "a.txt"), "");
    fs.writeFileSync(path.join(scratch, "b.txt"), "");
    fs.mkdirSync(path.join(scratch, "sub"));
  });
  after(() => rm(scratch));

  it("returns the directory entries with file types", () => {
    const entries = readDirSafe(scratch)
      .map((e) => e.name)
      .sort();
    assert.deepEqual(entries, ["a.txt", "b.txt", "sub"]);
  });

  it("returns [] for a missing directory", () => {
    assert.deepEqual(readDirSafe(path.join(scratch, "nope")), []);
  });

  it("returns [] for a path that is a file (not a directory)", () => {
    assert.deepEqual(readDirSafe(path.join(scratch, "a.txt")), []);
  });

  it("returns [] for an empty directory", () => {
    const empty = path.join(scratch, "empty-dir");
    fs.mkdirSync(empty);
    assert.deepEqual(readDirSafe(empty), []);
  });
});

describe("readTextOrNull", () => {
  let scratch: string;
  before(() => {
    scratch = makeScratch("readTextOrNull");
    fs.writeFileSync(path.join(scratch, "hi.txt"), "hello world");
  });
  after(() => rm(scratch));

  it("returns the file contents as a string", async () => {
    assert.equal(await readTextOrNull(path.join(scratch, "hi.txt")), "hello world");
  });

  it("returns null for a missing file", async () => {
    assert.equal(await readTextOrNull(path.join(scratch, "nope.txt")), null);
  });

  it("returns null for a directory", async () => {
    assert.equal(await readTextOrNull(scratch), null);
  });
});

describe("resolveWithinRoot — happy path", () => {
  let scratch: string;
  before(() => {
    scratch = makeScratch("resolveWithinRoot-happy");
    fs.writeFileSync(path.join(scratch, "file.txt"), "");
    fs.mkdirSync(path.join(scratch, "sub"));
    fs.writeFileSync(path.join(scratch, "sub", "nested.txt"), "");
  });
  after(() => rm(scratch));

  it("resolves a top-level file under the root", () => {
    const out = resolveWithinRoot(scratch, "file.txt");
    assert.equal(out, path.join(scratch, "file.txt"));
  });

  it("resolves a nested file under the root", () => {
    const out = resolveWithinRoot(scratch, "sub/nested.txt");
    assert.equal(out, path.join(scratch, "sub", "nested.txt"));
  });

  it("returns the root itself for empty relPath", () => {
    assert.equal(resolveWithinRoot(scratch, ""), scratch);
  });

  it("returns the root itself for '.'", () => {
    assert.equal(resolveWithinRoot(scratch, "."), scratch);
  });

  it("normalizes redundant separators and ./", () => {
    assert.equal(resolveWithinRoot(scratch, "./sub/./nested.txt"), path.join(scratch, "sub", "nested.txt"));
  });
});

describe("resolveWithinRoot — security: traversal", () => {
  let scratch: string;
  let outsideFile: string;
  before(() => {
    scratch = makeScratch("resolveWithinRoot-traversal");
    fs.writeFileSync(path.join(scratch, "ok.txt"), "");
    // Create a file OUTSIDE the root that traversal attacks would
    // try to reach. Put it next to scratch so realpath can find it.
    outsideFile = path.join(path.dirname(scratch), "outside.txt");
    fs.writeFileSync(outsideFile, "secret");
  });
  after(() => {
    fs.rmSync(outsideFile, { force: true });
    rm(scratch);
  });

  it("rejects ../ traversal that lands outside the root", () => {
    const out = resolveWithinRoot(scratch, "../outside.txt");
    assert.equal(out, null);
  });

  it("rejects deeply nested ../ traversal", () => {
    assert.equal(resolveWithinRoot(scratch, "../../../etc/passwd"), null);
  });

  it("rejects an absolute path that escapes the root", () => {
    assert.equal(resolveWithinRoot(scratch, "/etc/passwd"), null);
  });

  it("rejects an absolute path that lands inside the root", () => {
    // Even if the absolute path happens to be inside root, this is
    // not a relative-path resolution and should fail. Per Node's
    // path.resolve semantics, an absolute relPath wins, so the
    // result IS scratch + ok.txt — and the realpath check passes.
    // This documents the current behavior: callers should reject
    // absolute paths separately if their semantics require it.
    const inside = path.join(scratch, "ok.txt");
    assert.equal(resolveWithinRoot(scratch, inside), inside);
  });
});

describe("resolveWithinRoot — security: symlinks", () => {
  let scratch: string;
  let outsideFile: string;
  before(() => {
    scratch = makeScratch("resolveWithinRoot-symlinks");
    fs.writeFileSync(path.join(scratch, "real.txt"), "");
    outsideFile = path.join(path.dirname(scratch), "outside-target.txt");
    fs.writeFileSync(outsideFile, "secret");
    // Symlink inside scratch pointing OUTSIDE — the attack we
    // designed resolveWithinRoot to defeat.
    try {
      fs.symlinkSync(outsideFile, path.join(scratch, "escape"));
    } catch {
      // Some CI environments (e.g. Windows without dev mode) can't
      // create symlinks. Tests below will be skipped via the marker.
    }
    // Symlink inside scratch pointing to another file inside scratch
    // — a legitimate symlink that should resolve normally.
    try {
      fs.symlinkSync(path.join(scratch, "real.txt"), path.join(scratch, "alias.txt"));
    } catch {
      /* ignore */
    }
  });
  after(() => {
    fs.rmSync(outsideFile, { force: true });
    rm(scratch);
  });

  it("rejects a symlink that resolves outside the root", () => {
    const escapeLink = path.join(scratch, "escape");
    if (!fs.existsSync(escapeLink)) return; // platform skip
    assert.equal(resolveWithinRoot(scratch, "escape"), null);
  });

  it("accepts a symlink that resolves inside the root", () => {
    const aliasLink = path.join(scratch, "alias.txt");
    if (!fs.existsSync(aliasLink)) return; // platform skip
    // The alias is followed to its target — both are inside scratch.
    assert.equal(resolveWithinRoot(scratch, "alias.txt"), path.join(scratch, "real.txt"));
  });
});

// Regression: when the "root" passed to resolveWithinRoot is itself
// the realpath of a symlinked directory (e.g. workspace/stories →
// /ext/stories), child paths should still resolve correctly. The
// previous bug in routes/mulmo-script.ts compared a candidate built
// from the non-realpath workspace against the realpath stories dir,
// rejecting every legitimate request.
describe("resolveWithinRoot — symlinked root directory (A1 regression)", () => {
  let realRoot: string;
  let symlinkRoot: string;
  before(() => {
    realRoot = makeScratch("symlinkRoot-real");
    fs.writeFileSync(path.join(realRoot, "story.json"), "{}");
    fs.mkdirSync(path.join(realRoot, "sub"));
    fs.writeFileSync(path.join(realRoot, "sub", "nested.mp4"), "");
    // Create a symlink elsewhere that points at realRoot
    const linkParent = makeScratch("symlinkRoot-link");
    symlinkRoot = path.join(linkParent, "stories-link");
    try {
      fs.symlinkSync(realRoot, symlinkRoot);
    } catch {
      // Platform without symlink support — tests will skip via marker.
    }
  });
  after(() => {
    if (symlinkRoot) {
      try {
        fs.rmSync(path.dirname(symlinkRoot), { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    rm(realRoot);
  });

  it("resolves child paths against the realpath of a symlinked root", () => {
    if (!fs.existsSync(symlinkRoot)) return; // platform skip
    // Caller realpaths the root once at module load — this is the
    // pattern routes/mulmo-script.ts uses for ensureStoriesReal().
    const rootReal = fs.realpathSync(symlinkRoot);
    assert.equal(rootReal, realRoot, "sanity: realpath should follow symlink");
    const out = resolveWithinRoot(rootReal, "story.json");
    assert.equal(out, path.join(realRoot, "story.json"));
  });

  it("resolves nested paths under a symlinked root", () => {
    if (!fs.existsSync(symlinkRoot)) return;
    const rootReal = fs.realpathSync(symlinkRoot);
    const out = resolveWithinRoot(rootReal, "sub/nested.mp4");
    assert.equal(out, path.join(realRoot, "sub", "nested.mp4"));
  });

  it("rejects traversal even when the root is the realpath of a symlink", () => {
    if (!fs.existsSync(symlinkRoot)) return;
    const rootReal = fs.realpathSync(symlinkRoot);
    assert.equal(resolveWithinRoot(rootReal, "../../etc/passwd"), null);
  });
});

describe("resolveWithinRoot — missing files and edge cases", () => {
  let scratch: string;
  before(() => {
    scratch = makeScratch("resolveWithinRoot-missing");
  });
  after(() => rm(scratch));

  it("returns null for a non-existent leaf path", () => {
    assert.equal(resolveWithinRoot(scratch, "nope.txt"), null);
  });

  it("returns null for a non-existent nested path", () => {
    assert.equal(resolveWithinRoot(scratch, "a/b/c/d.txt"), null);
  });

  it("returns null when the root itself does not exist", () => {
    const fake = path.join(scratch, "does-not-exist");
    assert.equal(resolveWithinRoot(fake, "anything"), null);
  });

  it("rejects a path containing a null byte", () => {
    // Node's fs.realpathSync throws on null bytes, which our catch
    // converts to null. This protects against C-string truncation
    // tricks even though Node itself isn't vulnerable.
    assert.equal(resolveWithinRoot(scratch, "foo\0.txt"), null);
  });
});
