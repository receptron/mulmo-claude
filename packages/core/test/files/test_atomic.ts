import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { writeFileAtomic, writeFileAtomicSync, isTransientRenameError, renameWithWindowsRetry } from "../../src/files/atomic.js";
import { writeJsonAtomic } from "../../src/files/json.js";
import { isEnoent } from "../../src/files/safe.js";

let tmpDir: string;

before(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "core-atomic-test-"));
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

const errWithCode = (code: string): Error & { code: string } => Object.assign(new Error(code), { code });

describe("writeFileAtomic", () => {
  it("creates a new file with the expected content (never a half-written one)", async () => {
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
    const file = path.join(tmpDir, "deep", "nested", "file.txt");
    await writeFileAtomic(file, "deep");
    assert.equal(readFileSync(file, "utf-8"), "deep");
  });

  it("cleans up the tmp file on write failure", async () => {
    const dir = path.join(tmpDir, "is-a-dir");
    mkdirSync(dir, { recursive: true });
    await assert.rejects(() => writeFileAtomic(dir, "content"));
    const strays = readdirSync(path.dirname(dir)).filter((name) => name.endsWith(".tmp"));
    assert.equal(strays.length, 0);
  });

  it("applies file mode when specified", async (ctx) => {
    if (process.platform === "win32") {
      ctx.skip("chmod is a no-op on Windows");
      return;
    }
    const file = path.join(tmpDir, "secret.txt");
    await writeFileAtomic(file, "secret", { mode: 0o600 });
    assert.equal(statSync(file).mode & 0o777, 0o600);
  });

  it("round-trips binary content without utf-8 re-encoding", async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x80, 0x81, 0xfe, 0xff]);
    const file = path.join(tmpDir, "blob.bin");
    await writeFileAtomic(file, bytes);
    assert.deepEqual([...readFileSync(file)], [...bytes]);
  });
});

// The staging name used to be the shared `${filePath}.tmp`, so two writers of
// one destination raced: one rename/unlink pulled the staging file out from
// under the other (#2222).
describe("writeFileAtomic — uniqueTmp default (concurrent writers to one dest)", () => {
  it("loses no write when several writers target the same file", async () => {
    const file = path.join(tmpDir, "contended.json");
    await Promise.all(Array.from({ length: 12 }, (_, i) => writeFileAtomic(file, `payload-${i}`)));
    assert.match(readFileSync(file, "utf-8"), /^payload-\d+$/);
  });

  it("leaves no staging files behind after a contended burst", async () => {
    const file = path.join(tmpDir, "contended-cleanup.json");
    await Promise.all(Array.from({ length: 8 }, (_, i) => writeFileAtomic(file, `v${i}`)));
    const strays = readdirSync(tmpDir).filter((name) => name.startsWith("contended-cleanup.json.") && name.endsWith(".tmp"));
    assert.deepEqual(strays, []);
  });

  it("honours an explicit uniqueTmp: false (predictable staging path)", async () => {
    const file = path.join(tmpDir, "predictable.txt");
    await writeFileAtomic(file, "ok", { uniqueTmp: false });
    await writeFileAtomic(file, "ok2", { uniqueTmp: false });
    assert.equal(readFileSync(file, "utf-8"), "ok2");
  });
});

describe("writeFileAtomicSync", () => {
  it("writes content synchronously", () => {
    const file = path.join(tmpDir, "sync.txt");
    writeFileAtomicSync(file, "sync-content");
    assert.equal(readFileSync(file, "utf-8"), "sync-content");
  });

  it("cleans up tmp on failure", () => {
    const dir = path.join(tmpDir, "sync-is-dir");
    mkdirSync(dir, { recursive: true });
    assert.throws(() => writeFileAtomicSync(dir, "content"));
    assert.equal(readdirSync(path.dirname(dir)).filter((name) => name.endsWith(".tmp")).length, 0);
  });
});

// The safety-critical Windows decision, tested cross-platform via the injected
// `isWindows` flag (retrying transient handle contention from AV / Search Indexer).
describe("isTransientRenameError", () => {
  for (const code of ["EPERM", "EBUSY", "EACCES"]) {
    it(`is transient for ${code} on Windows`, () => {
      assert.equal(isTransientRenameError(errWithCode(code), true), true);
    });
    it(`is NOT transient for ${code} on POSIX`, () => {
      assert.equal(isTransientRenameError(errWithCode(code), false), false);
    });
  }
  it("is not transient for ENOENT even on Windows", () => {
    assert.equal(isTransientRenameError(errWithCode("ENOENT"), true), false);
  });
  it("is not transient for a non-errno value", () => {
    assert.equal(isTransientRenameError(new Error("boom"), true), false);
    assert.equal(isTransientRenameError(null, true), false);
  });
});

describe("renameWithWindowsRetry (injected rename/sleep)", () => {
  const noSleep = async () => {};

  it("retries a transient EPERM then succeeds", async () => {
    let calls = 0;
    const rename = async () => {
      calls += 1;
      if (calls < 3) throw errWithCode("EPERM");
    };
    await renameWithWindowsRetry("from", "to", { rename, sleep: noSleep, isWindows: true });
    assert.equal(calls, 3);
  });

  it("does NOT retry a non-transient error — throws on the first attempt", async () => {
    let calls = 0;
    const rename = async () => {
      calls += 1;
      throw errWithCode("ENOENT");
    };
    await assert.rejects(() => renameWithWindowsRetry("from", "to", { rename, sleep: noSleep, isWindows: true }), /ENOENT/);
    assert.equal(calls, 1);
  });

  it("does NOT retry EPERM when not on Windows", async () => {
    let calls = 0;
    const rename = async () => {
      calls += 1;
      throw errWithCode("EPERM");
    };
    await assert.rejects(() => renameWithWindowsRetry("from", "to", { rename, sleep: noSleep, isWindows: false }), /EPERM/);
    assert.equal(calls, 1);
  });
});

describe("writeJsonAtomic", () => {
  it("writes 2-space-indented JSON", async () => {
    const file = path.join(tmpDir, "data.json");
    await writeJsonAtomic(file, { a: 1, b: [2, 3] });
    assert.equal(readFileSync(file, "utf-8"), '{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');
  });
});

describe("isEnoent", () => {
  it("is true only for ENOENT", () => {
    assert.equal(isEnoent(errWithCode("ENOENT")), true);
    assert.equal(isEnoent(errWithCode("EACCES")), false);
    assert.equal(isEnoent(new Error("x")), false);
    assert.equal(isEnoent(null), false);
  });
});
