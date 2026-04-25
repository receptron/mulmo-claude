import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeReadState } from "../../server/api/routes/news.js";

describe("sanitizeReadState", () => {
  it("strips non-string entries", () => {
    const result = sanitizeReadState({ readIds: ["a", 1, null, "b"] as unknown[] });
    assert.deepEqual(result.readIds, ["a", "b"]);
  });

  it("dedupes while preserving first-seen order", () => {
    const result = sanitizeReadState({ readIds: ["a", "b", "a", "c", "b"] });
    assert.deepEqual(result.readIds, ["a", "b", "c"]);
  });

  it("rejects empty strings", () => {
    const result = sanitizeReadState({ readIds: ["", "a", "  ", "b"] });
    // `  ` is non-empty (length 2) so it passes the string check.
    assert.deepEqual(result.readIds, ["a", "  ", "b"]);
  });

  it("caps the list at 10000, keeping the most recent", () => {
    const ids = Array.from({ length: 10_005 }, (_, idx) => `id-${idx}`);
    const result = sanitizeReadState({ readIds: ids });
    assert.equal(result.readIds.length, 10_000);
    // The first 5 (oldest) get evicted; tail stays.
    assert.equal(result.readIds[0], "id-5");
    assert.equal(result.readIds[result.readIds.length - 1], "id-10004");
  });

  it("returns an empty array for no input", () => {
    assert.deepEqual(sanitizeReadState({ readIds: [] }).readIds, []);
  });
});
