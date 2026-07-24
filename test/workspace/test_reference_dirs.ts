// Non-string fields in the hand-edited `config/reference-dirs.json`.
//
// These used to reach the validators via `String(value)`, so an object arrived
// as the literal "[object Object]" — usable as a label, and echoed back in the
// error text as if the user had typed it.

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { tmpdir, homedir } from "os";
import { loadReferenceDirs, validateReferenceDirs } from "../../server/workspace/reference-dirs.ts";

function tmpRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "reference-dirs-"));
  mkdirSync(path.join(dir, "config"), { recursive: true });
  return dir;
}

function writeConfig(root: string, data: unknown): void {
  writeFileSync(path.join(root, "config", "reference-dirs.json"), JSON.stringify(data), "utf-8");
}

const targets: string[] = [];

/** A real, mountable directory — entries pointing at one survive validation.
 *  Created under $HOME, not `tmpdir()`: on macOS that resolves under `/var`,
 *  which `SYSTEM_BLOCKED_PREFIXES` rejects, so every entry would be dropped for
 *  the wrong reason. */
function realDir(): string {
  const dir = mkdtempSync(path.join(homedir(), ".mulmoclaude-test-ref-"));
  targets.push(dir);
  return dir;
}

after(() => {
  for (const dir of targets) rmSync(dir, { recursive: true, force: true });
});

describe("loadReferenceDirs — non-string fields", () => {
  it("falls back to the basename when label is an object", () => {
    const root = tmpRoot();
    const target = realDir();
    writeConfig(root, [{ hostPath: target, label: { text: "nope" } }]);
    const entries = loadReferenceDirs(root);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].label, path.basename(target));
    assert.doesNotMatch(entries[0].label, /\[object Object\]/);
  });

  it("falls back to the basename when label is an array", () => {
    const root = tmpRoot();
    const target = realDir();
    writeConfig(root, [{ hostPath: target, label: ["a", "b"] }]);
    const entries = loadReferenceDirs(root);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].label, path.basename(target));
  });

  it("keeps a string label as-is", () => {
    const root = tmpRoot();
    const target = realDir();
    writeConfig(root, [{ hostPath: target, label: "docs" }]);
    const entries = loadReferenceDirs(root);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].label, "docs");
  });

  it("rejects an entry whose hostPath is an object", () => {
    const root = tmpRoot();
    writeConfig(root, [{ hostPath: { dir: "/tmp" }, label: "x" }]);
    assert.deepEqual(loadReferenceDirs(root), []);
  });
});

describe("system directory blocklist — per platform", () => {
  /** The system dir this OS is expected to block. `null` means we have nothing
   *  reliable to assert on (a Windows box exposing neither SystemRoot nor
   *  windir), so those cases skip rather than assert something false. */
  const blockedSystemDir = (): string | null => {
    if (process.platform === "win32") return process.env.SystemRoot ?? process.env.windir ?? null;
    return "/etc";
  };

  const NO_SYSTEM_DIR = "no system dir to assert on (Windows without SystemRoot/windir)";

  const isBlocked = (hostPath: string): boolean => "error" in validateReferenceDirs([{ hostPath, label: "x" }]);

  it("blocks this platform's system directory", (ctx) => {
    const dir = blockedSystemDir();
    if (dir === null) {
      ctx.skip(NO_SYSTEM_DIR);
      return;
    }
    assert.ok(isBlocked(dir), `expected ${dir} to be blocked`);
  });

  it("blocks a subdirectory of it too", (ctx) => {
    const dir = blockedSystemDir();
    if (dir === null) {
      ctx.skip(NO_SYSTEM_DIR);
      return;
    }
    const sub = path.join(dir, "sub");
    assert.ok(isBlocked(sub), `expected ${sub} to be blocked`);
  });

  it("does NOT block a sibling whose name merely starts the same way", (ctx) => {
    // `/etc-backup` must not be swallowed by `/etc`'s subtree — that is what
    // the `+ path.sep` guard in isAtOrUnder buys.
    const dir = blockedSystemDir();
    if (dir === null) {
      ctx.skip(NO_SYSTEM_DIR);
      return;
    }
    const sibling = `${dir}-backup`;
    assert.ok(!isBlocked(sibling), `expected ${sibling} to validate`);
  });

  it("blocks the lowercase spelling on Windows (case-insensitive filesystem)", (ctx) => {
    // POSIX filesystems really are case-sensitive, so there is nothing to assert.
    if (process.platform !== "win32") {
      ctx.skip("win32 only");
      return;
    }
    const dir = blockedSystemDir();
    if (dir === null) {
      ctx.skip(NO_SYSTEM_DIR);
      return;
    }
    assert.ok(isBlocked(dir.toLowerCase()), `expected ${dir.toLowerCase()} to be blocked`);
  });
});

describe("validateReferenceDirs — error text", () => {
  it("does not echo [object Object] back as the offending path", () => {
    const result = validateReferenceDirs([{ hostPath: { nested: true } }]);
    assert.ok("error" in result);
    assert.doesNotMatch(result.error, /\[object Object\]/);
  });

  it("still reports a genuine string path in the error", () => {
    // The filesystem root is blocked on every platform, so this test says
    // nothing about which system dirs a given OS blocks — see the
    // platform-specific suite below for that.
    const blocked = path.parse(path.resolve(".")).root;
    const result = validateReferenceDirs([{ hostPath: blocked }]);
    assert.ok("error" in result);
    assert.ok(result.error.includes(blocked), `expected the error to echo ${blocked}, got: ${result.error}`);
  });

  // The wording is the HTTP response body, so it is pinned verbatim: the
  // generic `validateEntryList` behind this wrapper must not reword it.
  it("reports a non-array input", () => {
    assert.deepEqual(validateReferenceDirs("/tmp"), { error: "expected an array" });
  });

  it("names the offending entry by index", () => {
    const result = validateReferenceDirs([{ hostPath: path.join(homedir(), "docs"), label: "docs" }, { hostPath: "relative/path" }]);
    assert.deepEqual(result, { error: 'entry 1: invalid or blocked path "relative/path"' });
  });

  it("accepts exactly 20 entries", () => {
    const result = validateReferenceDirs(capCandidates(20));
    assert.ok(!("error" in result), `expected 20 entries to pass, got: ${JSON.stringify(result)}`);
    assert.equal(result.entries.length, 20);
  });

  it("rejects 21 entries with the cap in the message", () => {
    assert.deepEqual(validateReferenceDirs(capCandidates(21)), { error: "too many entries (max 20)" });
  });
});

/** Absolute, non-sensitive, uniquely-labelled paths. They need not exist —
 *  `validateReferenceDirs` checks shape, not the filesystem. */
function capCandidates(count: number): unknown[] {
  return Array.from({ length: count }, (_unused, i) => ({
    hostPath: path.join(homedir(), `mulmoclaude-cap-${i}`),
    label: `cap-${i}`,
  }));
}
