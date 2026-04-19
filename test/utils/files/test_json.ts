import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  loadJsonFile,
  saveJsonFile,
  writeJsonAtomic,
  readJsonOrNull,
} from "../../../server/utils/files/json.js";

let tmpDir: string;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "json-test-"));
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadJsonFile (sync)", () => {
  it("returns default when file is missing", () => {
    const val = loadJsonFile(path.join(tmpDir, "missing.json"), { x: 1 });
    assert.deepEqual(val, { x: 1 });
  });

  it("parses a well-formed JSON file", () => {
    const file = path.join(tmpDir, "good.json");
    fs.writeFileSync(file, JSON.stringify({ a: "hello" }));
    assert.deepEqual(loadJsonFile(file, {}), { a: "hello" });
  });

  it("returns default on malformed JSON", () => {
    const file = path.join(tmpDir, "bad.json");
    fs.writeFileSync(file, "not json");
    assert.deepEqual(loadJsonFile(file, []), []);
  });
});

describe("saveJsonFile (sync)", () => {
  it("writes pretty-printed JSON", () => {
    const file = path.join(tmpDir, "save.json");
    saveJsonFile(file, { b: 2 });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf-8")), { b: 2 });
  });

  it("creates parent directories", () => {
    const file = path.join(tmpDir, "save-deep", "nested.json");
    saveJsonFile(file, [1, 2, 3]);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf-8")), [1, 2, 3]);
  });
});

describe("writeJsonAtomic (async)", () => {
  it("writes atomically and pretty-prints", async () => {
    const file = path.join(tmpDir, "atomic.json");
    await writeJsonAtomic(file, { c: true });
    const raw = fs.readFileSync(file, "utf-8");
    assert.deepEqual(JSON.parse(raw), { c: true });
    // Pretty-printed: contains newlines
    assert.ok(raw.includes("\n"));
  });
});

describe("readJsonOrNull (async)", () => {
  it("returns parsed JSON from a valid file", async () => {
    const file = path.join(tmpDir, "read.json");
    fs.writeFileSync(file, JSON.stringify({ d: 4 }));
    assert.deepEqual(await readJsonOrNull(file), { d: 4 });
  });

  it("returns null for missing file", async () => {
    assert.equal(await readJsonOrNull(path.join(tmpDir, "nope.json")), null);
  });

  it("returns null for malformed JSON", async () => {
    const file = path.join(tmpDir, "corrupt.json");
    fs.writeFileSync(file, "{broken");
    assert.equal(await readJsonOrNull(file), null);
  });
});
