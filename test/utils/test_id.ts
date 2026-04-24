import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeId, makeUuid, shortId } from "../../server/utils/id.js";

describe("makeUuid", () => {
  it("returns a UUID v4 (hyphenated, 36 chars)", () => {
    const uuid = makeUuid();
    assert.equal(uuid.length, 36);
    // v4: 8-4-4-4-12 hex with version nibble "4" and variant "8/9/a/b"
    assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("generates unique values", () => {
    const uuids = new Set(Array.from({ length: 100 }, () => makeUuid()));
    assert.equal(uuids.size, 100);
  });
});

describe("shortId", () => {
  it("returns exactly 16 hex characters", () => {
    const slug = shortId();
    assert.equal(slug.length, 16);
    assert.match(slug, /^[0-9a-f]{16}$/);
  });

  it("generates unique values", () => {
    const ids = new Set(Array.from({ length: 100 }, () => shortId()));
    assert.equal(ids.size, 100);
  });
});

describe("makeId", () => {
  it("starts with the given prefix", () => {
    assert.ok(makeId("todo").startsWith("todo_"));
    assert.ok(makeId("sched").startsWith("sched_"));
    assert.ok(makeId("col").startsWith("col_"));
  });

  it("contains a timestamp segment", () => {
    const generatedId = makeId("x");
    const parts = generatedId.split("_");
    // Format: prefix_timestamp_hex
    assert.equal(parts.length, 3);
    const timestamp = Number(parts[1]);
    assert.ok(Number.isFinite(timestamp));
    assert.ok(timestamp > 1_700_000_000_000, "timestamp should be recent epoch ms");
  });

  it("ends with 6 hex characters", () => {
    const generatedId = makeId("test");
    const hex = generatedId.split("_")[2];
    assert.equal(hex.length, 6);
    assert.match(hex, /^[0-9a-f]{6}$/);
  });

  it("generates unique IDs on consecutive calls", () => {
    const ids = new Set(Array.from({ length: 100 }, () => makeId("u")));
    assert.equal(ids.size, 100, "100 calls should produce 100 unique IDs");
  });
});
