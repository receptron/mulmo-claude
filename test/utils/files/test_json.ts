import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { loadJsonFile, writeJsonAtomic, readJsonOrNull } from "../../../server/utils/files/json.js";

let tmpDir: string;

before(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "json-test-"));
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadJsonFile (sync)", () => {
  it("returns default when file is missing", () => {
    const val = loadJsonFile(path.join(tmpDir, "missing.json"), { x: 1 });
    assert.deepEqual(val, { x: 1 });
  });

  it("parses a well-formed JSON file", () => {
    const file = path.join(tmpDir, "good.json");
    writeFileSync(file, JSON.stringify({ a: "hello" }));
    assert.deepEqual(loadJsonFile(file, {}), { a: "hello" });
  });

  it("returns default on malformed JSON", () => {
    const file = path.join(tmpDir, "bad.json");
    writeFileSync(file, "not json");
    assert.deepEqual(loadJsonFile(file, []), []);
  });
});

describe("writeJsonAtomic (async)", () => {
  it("writes atomically and pretty-prints", async () => {
    const file = path.join(tmpDir, "atomic.json");
    await writeJsonAtomic(file, { c: true });
    const raw = readFileSync(file, "utf-8");
    assert.deepEqual(JSON.parse(raw), { c: true });
    // Pretty-printed: contains newlines
    assert.ok(raw.includes("\n"));
  });

  it("creates parent directories", async () => {
    // Old `saveJsonFile` covered this via mkdirSync(); after the
    // #881 v2 removal, writeJsonAtomic inherits parent-dir creation
    // from writeFileAtomic and should still pass the same shape.
    const file = path.join(tmpDir, "atomic-deep", "nested.json");
    await writeJsonAtomic(file, [1, 2, 3]);
    assert.deepEqual(JSON.parse(readFileSync(file, "utf-8")), [1, 2, 3]);
  });
});

describe("readJsonOrNull (async)", () => {
  it("returns parsed JSON from a valid file", async () => {
    const file = path.join(tmpDir, "read.json");
    writeFileSync(file, JSON.stringify({ d: 4 }));
    assert.deepEqual(await readJsonOrNull(file), { d: 4 });
  });

  it("returns null for missing file", async () => {
    assert.equal(await readJsonOrNull(path.join(tmpDir, "nope.json")), null);
  });

  it("returns null for malformed JSON", async () => {
    const file = path.join(tmpDir, "corrupt.json");
    writeFileSync(file, "{broken");
    assert.equal(await readJsonOrNull(file), null);
  });
});
