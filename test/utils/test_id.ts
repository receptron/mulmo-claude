import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeId } from "../../server/utils/id.js";

describe("makeId", () => {
  it("starts with the given prefix", () => {
    assert.ok(makeId("todo").startsWith("todo_"));
    assert.ok(makeId("sched").startsWith("sched_"));
    assert.ok(makeId("col").startsWith("col_"));
  });

  it("contains a timestamp segment", () => {
    const id = makeId("x");
    const parts = id.split("_");
    // Format: prefix_timestamp_hex
    assert.equal(parts.length, 3);
    const ts = Number(parts[1]);
    assert.ok(Number.isFinite(ts));
    assert.ok(ts > 1_700_000_000_000, "timestamp should be recent epoch ms");
  });

  it("ends with 6 hex characters", () => {
    const id = makeId("test");
    const hex = id.split("_")[2];
    assert.equal(hex.length, 6);
    assert.match(hex, /^[0-9a-f]{6}$/);
  });

  it("generates unique IDs on consecutive calls", () => {
    const ids = new Set(Array.from({ length: 100 }, () => makeId("u")));
    assert.equal(ids.size, 100, "100 calls should produce 100 unique IDs");
  });
});
