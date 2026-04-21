import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EXPANDED_DIRS_STORAGE_KEY, parseStoredExpandedDirs, serializeExpandedDirs } from "../../../src/utils/files/expandedDirs.js";

describe("parseStoredExpandedDirs", () => {
  it("returns the default (root only) when the value is null", () => {
    const result = parseStoredExpandedDirs(null);
    assert.deepEqual([...result], [""]);
  });

  it("returns the default for an empty string (JSON parse fails)", () => {
    const result = parseStoredExpandedDirs("");
    assert.deepEqual([...result], [""]);
  });

  it("returns the default for invalid JSON", () => {
    const result = parseStoredExpandedDirs("{not json");
    assert.deepEqual([...result], [""]);
  });

  it("returns the default for non-array JSON values", () => {
    assert.deepEqual([...parseStoredExpandedDirs('"hello"')], [""]);
    assert.deepEqual([...parseStoredExpandedDirs("42")], [""]);
    assert.deepEqual([...parseStoredExpandedDirs("null")], [""]);
    assert.deepEqual([...parseStoredExpandedDirs("{}")], [""]);
  });

  it("returns an empty Set for an empty array (intentional collapse-all)", () => {
    const result = parseStoredExpandedDirs("[]");
    assert.equal(result.size, 0);
  });

  it("parses a populated array of strings", () => {
    const result = parseStoredExpandedDirs('["", "src", "src/components"]');
    assert.equal(result.size, 3);
    assert.ok(result.has(""));
    assert.ok(result.has("src"));
    assert.ok(result.has("src/components"));
  });

  it("filters out non-string entries gracefully", () => {
    const result = parseStoredExpandedDirs('["", 42, "src", null, true]');
    assert.equal(result.size, 2);
    assert.ok(result.has(""));
    assert.ok(result.has("src"));
  });

  it("deduplicates repeated entries via Set semantics", () => {
    const result = parseStoredExpandedDirs('["src", "src", "src"]');
    assert.equal(result.size, 1);
    assert.ok(result.has("src"));
  });
});

describe("serializeExpandedDirs", () => {
  it("serializes an empty Set to '[]'", () => {
    assert.equal(serializeExpandedDirs(new Set()), "[]");
  });

  it("serializes a populated Set to a JSON array of strings", () => {
    const set = new Set(["", "src", "src/components"]);
    const json = serializeExpandedDirs(set);
    const parsed: unknown = JSON.parse(json);
    assert.ok(Array.isArray(parsed));
    assert.equal(parsed.length, 3);
    assert.deepEqual([...parsed].sort(), ["", "src", "src/components"].sort());
  });
});

describe("expandedDirs roundtrip", () => {
  it("preserves a Set through serialize -> parse", () => {
    const original = new Set(["", "plans", "src/components", "test/utils"]);
    const restored = parseStoredExpandedDirs(serializeExpandedDirs(original));
    assert.equal(restored.size, original.size);
    for (const path of original) {
      assert.ok(restored.has(path), `restored Set missing "${path}"`);
    }
  });

  it("preserves an empty Set through serialize -> parse", () => {
    const restored = parseStoredExpandedDirs(serializeExpandedDirs(new Set()));
    assert.equal(restored.size, 0);
  });
});

describe("EXPANDED_DIRS_STORAGE_KEY", () => {
  it("is exposed as a stable string", () => {
    assert.equal(typeof EXPANDED_DIRS_STORAGE_KEY, "string");
    assert.equal(EXPANDED_DIRS_STORAGE_KEY, "files_expanded_dirs");
  });
});
