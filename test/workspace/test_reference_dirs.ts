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

describe("validateReferenceDirs — error text", () => {
  it("does not echo [object Object] back as the offending path", () => {
    const result = validateReferenceDirs([{ hostPath: { nested: true } }]);
    assert.ok("error" in result);
    assert.doesNotMatch(result.error, /\[object Object\]/);
  });

  it("still reports a genuine string path in the error", () => {
    const result = validateReferenceDirs([{ hostPath: "/etc" }]);
    assert.ok("error" in result);
    assert.match(result.error, /\/etc/);
  });
});
