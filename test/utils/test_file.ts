import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import {
  loadJsonFile,
  saveJsonFile,
  writeFileAtomic,
  writeJsonAtomic,
  readJsonOrNull,
} from "../../server/utils/file.ts";

let tmpDir = "";

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mulmo-file-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadJsonFile (existing)", () => {
  it("returns the parsed JSON when the file exists", () => {
    const p = path.join(tmpDir, "x.json");
    fs.writeFileSync(p, JSON.stringify({ hello: "world" }));
    assert.deepEqual(loadJsonFile<{ hello: string }>(p, { hello: "default" }), {
      hello: "world",
    });
  });

  it("returns the default when the file is missing", () => {
    const p = path.join(tmpDir, "missing.json");
    assert.deepEqual(loadJsonFile<{ x: number }>(p, { x: 42 }), { x: 42 });
  });

  it("returns the default on malformed JSON", () => {
    const p = path.join(tmpDir, "bad.json");
    fs.writeFileSync(p, "{ not valid");
    assert.deepEqual(loadJsonFile<{ x: number }>(p, { x: 42 }), { x: 42 });
  });
});

describe("saveJsonFile (existing)", () => {
  it("creates the parent directory and writes pretty JSON", () => {
    const p = path.join(tmpDir, "nested", "deep", "x.json");
    saveJsonFile(p, { a: 1, b: [2, 3] });
    const raw = fs.readFileSync(p, "utf-8");
    assert.ok(raw.includes("\n"), "JSON should be pretty-printed");
    assert.deepEqual(JSON.parse(raw), { a: 1, b: [2, 3] });
  });
});

describe("writeFileAtomic", () => {
  it("writes plain text to the target path", async () => {
    const p = path.join(tmpDir, "out.txt");
    await writeFileAtomic(p, "hello\n");
    assert.equal(fs.readFileSync(p, "utf-8"), "hello\n");
  });

  it("creates parent directories", async () => {
    const p = path.join(tmpDir, "a", "b", "c.txt");
    await writeFileAtomic(p, "x");
    assert.ok(fs.existsSync(p));
  });

  it("uses a .tmp suffix by default and cleans it up on success", async () => {
    const p = path.join(tmpDir, "out.txt");
    await writeFileAtomic(p, "hello");
    assert.ok(!fs.existsSync(`${p}.tmp`), "tmp file should not remain");
  });

  it("uses a UUID-suffixed tmp name when uniqueTmp is true", async () => {
    const p = path.join(tmpDir, "out.txt");
    await writeFileAtomic(p, "hello", { uniqueTmp: true });
    // Final file exists, and no `.tmp` siblings survive.
    assert.equal(fs.readFileSync(p, "utf-8"), "hello");
    const siblings = fs.readdirSync(tmpDir);
    assert.deepEqual(siblings, ["out.txt"]);
  });

  it("honours the `mode` option on the final file", async () => {
    const p = path.join(tmpDir, "secret.txt");
    await writeFileAtomic(p, "shhh", { mode: 0o600 });
    const stat = fs.statSync(p);
    // On POSIX the file-mode bits should reflect 0o600. On Windows
    // node's mode bits are best-effort; skip the assertion there.
    if (process.platform !== "win32") {
      assert.equal(stat.mode & 0o777, 0o600);
    }
  });

  it("leaves the existing target untouched if the tmp write fails", async () => {
    const p = path.join(tmpDir, "out.txt");
    fs.writeFileSync(p, "ORIGINAL");
    fs.mkdirSync(`${p}.tmp`);
    await assert.rejects(writeFileAtomic(p, "NEW"));
    assert.equal(fs.readFileSync(p, "utf-8"), "ORIGINAL");
  });

  it("overwrites an existing file atomically", async () => {
    const p = path.join(tmpDir, "data.txt");
    fs.writeFileSync(p, "old");
    await writeFileAtomic(p, "new");
    assert.equal(fs.readFileSync(p, "utf-8"), "new");
  });
});

describe("writeJsonAtomic", () => {
  it("serialises as pretty JSON and writes atomically", async () => {
    const p = path.join(tmpDir, "data.json");
    await writeJsonAtomic(p, { hello: "world", n: 1 });
    const raw = fs.readFileSync(p, "utf-8");
    assert.ok(raw.includes("\n  "), "pretty-printed with 2-space indent");
    assert.deepEqual(JSON.parse(raw), { hello: "world", n: 1 });
  });

  it("supports arrays, numbers, and nested structures", async () => {
    const p = path.join(tmpDir, "nested.json");
    await writeJsonAtomic(p, [1, 2, { a: [3, 4] }]);
    assert.deepEqual(JSON.parse(fs.readFileSync(p, "utf-8")), [
      1,
      2,
      { a: [3, 4] },
    ]);
  });
});

describe("readJsonOrNull", () => {
  it("returns the parsed JSON when the file exists", async () => {
    const p = path.join(tmpDir, "x.json");
    fs.writeFileSync(p, JSON.stringify({ n: 7 }));
    const got = await readJsonOrNull<{ n: number }>(p);
    assert.deepEqual(got, { n: 7 });
  });

  it("returns null when the file is missing", async () => {
    const p = path.join(tmpDir, "nope.json");
    assert.equal(await readJsonOrNull(p), null);
  });

  it("returns null on malformed JSON", async () => {
    const p = path.join(tmpDir, "bad.json");
    fs.writeFileSync(p, "not json");
    assert.equal(await readJsonOrNull(p), null);
  });
});
