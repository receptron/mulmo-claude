import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { writeFileAtomic, writeFileAtomicSync } from "../../../server/utils/files/atomic.js";

let tmpDir: string;

before(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "atomic-test-"));
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("writeFileAtomic", () => {
  it("creates a new file with the expected content", async () => {
    const file = path.join(tmpDir, "new.txt");
    await writeFileAtomic(file, "hello");
    assert.equal(readFileSync(file, "utf-8"), "hello");
  });

  it("overwrites an existing file atomically", async () => {
    const file = path.join(tmpDir, "overwrite.txt");
    await writeFileAtomic(file, "first");
    await writeFileAtomic(file, "second");
    assert.equal(readFileSync(file, "utf-8"), "second");
  });

  it("creates parent directories if missing", async () => {
    const file = path.join(tmpDir, "deep", "nested", "dir", "file.txt");
    await writeFileAtomic(file, "deep");
    assert.equal(readFileSync(file, "utf-8"), "deep");
  });

  it("cleans up tmp file on write failure", async () => {
    // Use a directory as the target path — writeFile will fail
    const dir = path.join(tmpDir, "is-a-dir");
    mkdirSync(dir, { recursive: true });
    await assert.rejects(() => writeFileAtomic(dir, "content"));
    // No .tmp file should be left behind
    const siblings = readdirSync(path.dirname(dir));
    const tmps = siblings.filter((file) => file.endsWith(".tmp"));
    assert.equal(tmps.length, 0);
  });

  it("applies file mode when specified", async () => {
    if (process.platform === "win32") return; // chmod no-op on Windows
    const file = path.join(tmpDir, "secret.txt");
    await writeFileAtomic(file, "secret", { mode: 0o600 });
    const stat = statSync(file);
    assert.equal(stat.mode & 0o777, 0o600);
  });

  it("uses unique tmp filenames when uniqueTmp is set", async () => {
    const file = path.join(tmpDir, "unique.txt");
    // Two concurrent writes should both succeed without collision
    await Promise.all([writeFileAtomic(file, "a", { uniqueTmp: true }), writeFileAtomic(file, "b", { uniqueTmp: true })]);
    const content = readFileSync(file, "utf-8");
    assert.ok(content === "a" || content === "b");
  });
});

describe("writeFileAtomicSync", () => {
  it("writes content synchronously", () => {
    const file = path.join(tmpDir, "sync.txt");
    writeFileAtomicSync(file, "sync-content");
    assert.equal(readFileSync(file, "utf-8"), "sync-content");
  });

  it("creates parent directories", () => {
    const file = path.join(tmpDir, "sync-deep", "nested", "file.txt");
    writeFileAtomicSync(file, "deep-sync");
    assert.equal(readFileSync(file, "utf-8"), "deep-sync");
  });

  it("cleans up tmp on failure", () => {
    const dir = path.join(tmpDir, "sync-is-dir");
    mkdirSync(dir, { recursive: true });
    assert.throws(() => writeFileAtomicSync(dir, "content"));
    const siblings = readdirSync(path.dirname(dir));
    assert.equal(siblings.filter((file) => file.endsWith(".tmp")).length, 0);
  });
});

describe("writeFileAtomic — binary content (#881 v1)", () => {
  // PNG signature + IHDR for a 1x1 transparent PNG. Easier to write
  // a real-shaped byte sequence than to assert "any bytes" — we want
  // to confirm the bytes round-trip *exactly*, with no utf-8 mangling.
  const PNG_BYTES = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
    0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
  ]);

  it("writes a Buffer round-trip without re-encoding (async)", async () => {
    const file = path.join(tmpDir, "bin-async.png");
    await writeFileAtomic(file, PNG_BYTES);
    const read = readFileSync(file);
    assert.deepEqual([...read], [...PNG_BYTES]);
  });

  it("writes a Buffer round-trip without re-encoding (sync)", () => {
    const file = path.join(tmpDir, "bin-sync.png");
    writeFileAtomicSync(file, PNG_BYTES);
    const read = readFileSync(file);
    assert.deepEqual([...read], [...PNG_BYTES]);
  });

  it("accepts a plain Uint8Array (not just Buffer)", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const file = path.join(tmpDir, "bin-u8.bin");
    await writeFileAtomic(file, bytes);
    const read = readFileSync(file);
    assert.deepEqual([...read], [1, 2, 3, 4, 5]);
  });

  it("does NOT re-encode bytes as utf-8 — high bytes survive", async () => {
    // 0x80–0xFF are valid bytes in a binary file but invalid stand-
    // alone utf-8 sequences; if the implementation accidentally
    // forced encoding="utf-8" the file would gain replacement
    // characters and the size would change.
    const bytes = Buffer.from([0x80, 0x81, 0xfe, 0xff]);
    const file = path.join(tmpDir, "bin-high.bin");
    await writeFileAtomic(file, bytes);
    const read = readFileSync(file);
    assert.equal(read.length, 4);
    assert.deepEqual([...read], [0x80, 0x81, 0xfe, 0xff]);
  });

  it("applies file mode for Buffer content", async () => {
    if (process.platform === "win32") return; // chmod no-op on Windows
    const file = path.join(tmpDir, "bin-mode.bin");
    await writeFileAtomic(file, Buffer.from([1, 2, 3]), { mode: 0o600 });
    const stat = statSync(file);
    assert.equal(stat.mode & 0o777, 0o600);
  });

  it("cleans up tmp file on Buffer write failure", async () => {
    // Targeting a directory forces writeFile to reject regardless
    // of content type — same shape as the string failure test, just
    // pinning that the binary path also unlinks the tmp.
    const dir = path.join(tmpDir, "bin-is-a-dir");
    mkdirSync(dir, { recursive: true });
    await assert.rejects(() => writeFileAtomic(dir, Buffer.from([1, 2, 3])));
    const siblings = readdirSync(path.dirname(dir));
    assert.equal(siblings.filter((file) => file.endsWith(".tmp")).length, 0);
  });
});
