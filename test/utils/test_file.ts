import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import path from "path";
import { tmpdir } from "os";
import { loadJsonFile, saveJsonFile, writeFileAtomic, writeJsonAtomic, readJsonOrNull } from "../../server/utils/files/index.js";

let tmpDir = "";

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "mulmo-file-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadJsonFile (existing)", () => {
  it("returns the parsed JSON when the file exists", () => {
    const filePath = path.join(tmpDir, "x.json");
    writeFileSync(filePath, JSON.stringify({ hello: "world" }));
    assert.deepEqual(loadJsonFile<{ hello: string }>(filePath, { hello: "default" }), {
      hello: "world",
    });
  });

  it("returns the default when the file is missing", () => {
    const filePath = path.join(tmpDir, "missing.json");
    assert.deepEqual(loadJsonFile<{ x: number }>(filePath, { x: 42 }), {
      x: 42,
    });
  });

  it("returns the default on malformed JSON", () => {
    const filePath = path.join(tmpDir, "bad.json");
    writeFileSync(filePath, "{ not valid");
    assert.deepEqual(loadJsonFile<{ x: number }>(filePath, { x: 42 }), {
      x: 42,
    });
  });
});

describe("saveJsonFile (existing)", () => {
  it("creates the parent directory and writes pretty JSON", () => {
    const filePath = path.join(tmpDir, "nested", "deep", "x.json");
    saveJsonFile(filePath, { a: 1, b: [2, 3] });
    const raw = readFileSync(filePath, "utf-8");
    assert.ok(raw.includes("\n"), "JSON should be pretty-printed");
    assert.deepEqual(JSON.parse(raw), { a: 1, b: [2, 3] });
  });
});

describe("writeFileAtomic", () => {
  it("writes plain text to the target path", async () => {
    const filePath = path.join(tmpDir, "out.txt");
    await writeFileAtomic(filePath, "hello\n");
    assert.equal(readFileSync(filePath, "utf-8"), "hello\n");
  });

  it("creates parent directories", async () => {
    const filePath = path.join(tmpDir, "a", "b", "c.txt");
    await writeFileAtomic(filePath, "x");
    assert.ok(existsSync(filePath));
  });

  it("uses a .tmp suffix by default and cleans it up on success", async () => {
    const filePath = path.join(tmpDir, "out.txt");
    await writeFileAtomic(filePath, "hello");
    assert.ok(!existsSync(`${filePath}.tmp`), "tmp file should not remain");
  });

  it("uses a UUID-suffixed tmp name when uniqueTmp is true", async () => {
    const filePath = path.join(tmpDir, "out.txt");
    await writeFileAtomic(filePath, "hello", { uniqueTmp: true });
    // Final file exists, and no `.tmp` siblings survive.
    assert.equal(readFileSync(filePath, "utf-8"), "hello");
    const siblings = readdirSync(tmpDir);
    assert.deepEqual(siblings, ["out.txt"]);
  });

  it("honours the `mode` option on the final file", async () => {
    const filePath = path.join(tmpDir, "secret.txt");
    await writeFileAtomic(filePath, "shhh", { mode: 0o600 });
    const stat = statSync(filePath);
    // On POSIX the file-mode bits should reflect 0o600. On Windows
    // node's mode bits are best-effort; skip the assertion there.
    if (process.platform !== "win32") {
      assert.equal(stat.mode & 0o777, 0o600);
    }
  });

  it("leaves the existing target untouched if the tmp write fails", async () => {
    const filePath = path.join(tmpDir, "out.txt");
    writeFileSync(filePath, "ORIGINAL");
    mkdirSync(`${filePath}.tmp`);
    await assert.rejects(writeFileAtomic(filePath, "NEW"));
    assert.equal(readFileSync(filePath, "utf-8"), "ORIGINAL");
  });

  it("overwrites an existing file atomically", async () => {
    const filePath = path.join(tmpDir, "data.txt");
    writeFileSync(filePath, "old");
    await writeFileAtomic(filePath, "new");
    assert.equal(readFileSync(filePath, "utf-8"), "new");
  });
});

describe("writeJsonAtomic", () => {
  it("serialises as pretty JSON and writes atomically", async () => {
    const filePath = path.join(tmpDir, "data.json");
    await writeJsonAtomic(filePath, { hello: "world", n: 1 });
    const raw = readFileSync(filePath, "utf-8");
    assert.ok(raw.includes("\n  "), "pretty-printed with 2-space indent");
    assert.deepEqual(JSON.parse(raw), { hello: "world", n: 1 });
  });

  it("supports arrays, numbers, and nested structures", async () => {
    const filePath = path.join(tmpDir, "nested.json");
    await writeJsonAtomic(filePath, [1, 2, { a: [3, 4] }]);
    assert.deepEqual(JSON.parse(readFileSync(filePath, "utf-8")), [1, 2, { a: [3, 4] }]);
  });
});

describe("readJsonOrNull", () => {
  it("returns the parsed JSON when the file exists", async () => {
    const filePath = path.join(tmpDir, "x.json");
    writeFileSync(filePath, JSON.stringify({ n: 7 }));
    const got = await readJsonOrNull<{ n: number }>(filePath);
    assert.deepEqual(got, { n: 7 });
  });

  it("returns null when the file is missing", async () => {
    const filePath = path.join(tmpDir, "nope.json");
    assert.equal(await readJsonOrNull(filePath), null);
  });

  it("returns null on malformed JSON", async () => {
    const filePath = path.join(tmpDir, "bad.json");
    writeFileSync(filePath, "not json");
    assert.equal(await readJsonOrNull(filePath), null);
  });
});
