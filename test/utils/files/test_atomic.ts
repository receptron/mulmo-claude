import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  writeFileAtomic,
  writeFileAtomicSync,
} from "../../../server/utils/files/atomic.js";

let tmpDir: string;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-test-"));
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("writeFileAtomic", () => {
  it("creates a new file with the expected content", async () => {
    const file = path.join(tmpDir, "new.txt");
    await writeFileAtomic(file, "hello");
    assert.equal(fs.readFileSync(file, "utf-8"), "hello");
  });

  it("overwrites an existing file atomically", async () => {
    const file = path.join(tmpDir, "overwrite.txt");
    await writeFileAtomic(file, "first");
    await writeFileAtomic(file, "second");
    assert.equal(fs.readFileSync(file, "utf-8"), "second");
  });

  it("creates parent directories if missing", async () => {
    const file = path.join(tmpDir, "deep", "nested", "dir", "file.txt");
    await writeFileAtomic(file, "deep");
    assert.equal(fs.readFileSync(file, "utf-8"), "deep");
  });

  it("cleans up tmp file on write failure", async () => {
    // Use a directory as the target path — writeFile will fail
    const dir = path.join(tmpDir, "is-a-dir");
    fs.mkdirSync(dir, { recursive: true });
    await assert.rejects(() => writeFileAtomic(dir, "content"));
    // No .tmp file should be left behind
    const siblings = fs.readdirSync(path.dirname(dir));
    const tmps = siblings.filter((f) => f.endsWith(".tmp"));
    assert.equal(tmps.length, 0);
  });

  it("applies file mode when specified", async () => {
    if (process.platform === "win32") return; // chmod no-op on Windows
    const file = path.join(tmpDir, "secret.txt");
    await writeFileAtomic(file, "secret", { mode: 0o600 });
    const stat = fs.statSync(file);
    assert.equal(stat.mode & 0o777, 0o600);
  });

  it("uses unique tmp filenames when uniqueTmp is set", async () => {
    const file = path.join(tmpDir, "unique.txt");
    // Two concurrent writes should both succeed without collision
    await Promise.all([
      writeFileAtomic(file, "a", { uniqueTmp: true }),
      writeFileAtomic(file, "b", { uniqueTmp: true }),
    ]);
    const content = fs.readFileSync(file, "utf-8");
    assert.ok(content === "a" || content === "b");
  });
});

describe("writeFileAtomicSync", () => {
  it("writes content synchronously", () => {
    const file = path.join(tmpDir, "sync.txt");
    writeFileAtomicSync(file, "sync-content");
    assert.equal(fs.readFileSync(file, "utf-8"), "sync-content");
  });

  it("creates parent directories", () => {
    const file = path.join(tmpDir, "sync-deep", "nested", "file.txt");
    writeFileAtomicSync(file, "deep-sync");
    assert.equal(fs.readFileSync(file, "utf-8"), "deep-sync");
  });

  it("cleans up tmp on failure", () => {
    const dir = path.join(tmpDir, "sync-is-dir");
    fs.mkdirSync(dir, { recursive: true });
    assert.throws(() => writeFileAtomicSync(dir, "content"));
    const siblings = fs.readdirSync(path.dirname(dir));
    assert.equal(siblings.filter((f) => f.endsWith(".tmp")).length, 0);
  });
});
