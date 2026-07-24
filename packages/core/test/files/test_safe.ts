import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { resolveWithinRoot } from "../../src/files/safe.js";

// Roots are realpath'd up front because the OS temp dir on macOS lives at
// /var/folders (a symlink target of /tmp on some configs) and
// resolveWithinRoot requires its `rootReal` arg to already be a realpath.
function makeScratch(prefix: string): string {
  return realpathSync(mkdtempSync(path.join(tmpdir(), `core-safe-${prefix}-`)));
}

// Some CI environments (e.g. Windows without developer mode) cannot create
// symlinks; tests guard on the link existing and skip otherwise.
function trySymlink(target: string, linkPath: string): void {
  try {
    symlinkSync(target, linkPath);
  } catch {
    /* platform without symlink support */
  }
}

const scratch = makeScratch("root");
writeFileSync(path.join(scratch, "file.txt"), "");
mkdirSync(path.join(scratch, "sub"));
writeFileSync(path.join(scratch, "sub", "nested.txt"), "");

const outsideFile = path.join(path.dirname(scratch), `core-safe-outside-${process.pid}.txt`);
writeFileSync(outsideFile, "secret");
trySymlink(outsideFile, path.join(scratch, "escape"));
trySymlink(path.join(scratch, "file.txt"), path.join(scratch, "alias.txt"));

after(() => {
  rmSync(outsideFile, { force: true });
  rmSync(scratch, { recursive: true, force: true });
});

describe("resolveWithinRoot — containment", () => {
  it("resolves a top-level file under the root", () => {
    assert.equal(resolveWithinRoot(scratch, "file.txt"), path.join(scratch, "file.txt"));
  });

  it("resolves a nested file under the root", () => {
    assert.equal(resolveWithinRoot(scratch, "sub/nested.txt"), path.join(scratch, "sub", "nested.txt"));
  });

  it("returns the root itself for an empty relPath", () => {
    assert.equal(resolveWithinRoot(scratch, ""), scratch);
  });

  it("returns the root itself for '.'", () => {
    assert.equal(resolveWithinRoot(scratch, "."), scratch);
  });
});

describe("resolveWithinRoot — traversal escapes", () => {
  it("rejects ../ traversal that lands outside the root", () => {
    assert.equal(resolveWithinRoot(scratch, `../${path.basename(outsideFile)}`), null);
  });

  it("rejects deeply nested ../ traversal", () => {
    assert.equal(resolveWithinRoot(scratch, "../../../etc/passwd"), null);
  });
});

describe("resolveWithinRoot — symlinks", () => {
  it("rejects a symlink that resolves outside the root", (ctx) => {
    if (!existsSync(path.join(scratch, "escape"))) {
      ctx.skip("symlink creation unsupported on this platform");
      return;
    }
    assert.equal(resolveWithinRoot(scratch, "escape"), null);
  });

  it("accepts a symlink that resolves inside the root", (ctx) => {
    if (!existsSync(path.join(scratch, "alias.txt"))) {
      ctx.skip("symlink creation unsupported on this platform");
      return;
    }
    assert.equal(resolveWithinRoot(scratch, "alias.txt"), path.join(scratch, "file.txt"));
  });
});

describe("resolveWithinRoot — nonexistent paths", () => {
  it("returns null for a nonexistent leaf", () => {
    assert.equal(resolveWithinRoot(scratch, "nope.txt"), null);
  });

  it("returns null for a nonexistent nested path", () => {
    assert.equal(resolveWithinRoot(scratch, "a/b/c/d.txt"), null);
  });

  it("returns null when the root itself does not exist", () => {
    assert.equal(resolveWithinRoot(path.join(scratch, "does-not-exist"), "anything"), null);
  });
});
