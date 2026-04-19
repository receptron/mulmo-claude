import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findDirtySessions,
  applyProcessed,
  type SessionFileMeta,
} from "../../server/workspace/journal/diff.js";

describe("findDirtySessions", () => {
  it("treats every session as dirty when processed state is empty", () => {
    const current: SessionFileMeta[] = [
      { id: "a", mtimeMs: 1000 },
      { id: "b", mtimeMs: 2000 },
    ];
    const { dirty, missing } = findDirtySessions(current, {});
    assert.deepEqual(dirty.sort(), ["a", "b"]);
    assert.deepEqual(missing, []);
  });

  it("returns no dirty sessions when every mtime matches", () => {
    const current: SessionFileMeta[] = [
      { id: "a", mtimeMs: 1000 },
      { id: "b", mtimeMs: 2000 },
    ];
    const { dirty } = findDirtySessions(current, {
      a: { lastMtimeMs: 1000 },
      b: { lastMtimeMs: 2000 },
    });
    assert.deepEqual(dirty, []);
  });

  it("flags a session whose mtime has advanced", () => {
    const current: SessionFileMeta[] = [{ id: "a", mtimeMs: 2500 }];
    const { dirty } = findDirtySessions(current, {
      a: { lastMtimeMs: 1000 },
    });
    assert.deepEqual(dirty, ["a"]);
  });

  it("does not flag a session whose mtime is unchanged but flags a sibling that moved", () => {
    const current: SessionFileMeta[] = [
      { id: "stable", mtimeMs: 1000 },
      { id: "moved", mtimeMs: 3000 },
    ];
    const { dirty } = findDirtySessions(current, {
      stable: { lastMtimeMs: 1000 },
      moved: { lastMtimeMs: 2000 },
    });
    assert.deepEqual(dirty, ["moved"]);
  });

  it("reports processed sessions that no longer exist on disk as missing", () => {
    const current: SessionFileMeta[] = [{ id: "a", mtimeMs: 1000 }];
    const { dirty, missing } = findDirtySessions(current, {
      a: { lastMtimeMs: 1000 },
      "b-gone": { lastMtimeMs: 500 },
    });
    assert.deepEqual(dirty, []);
    assert.deepEqual(missing, ["b-gone"]);
  });

  it("handles the combined case of new, changed, unchanged, and missing", () => {
    const current: SessionFileMeta[] = [
      { id: "new", mtimeMs: 5000 },
      { id: "changed", mtimeMs: 4000 },
      { id: "unchanged", mtimeMs: 1000 },
    ];
    const { dirty, missing } = findDirtySessions(current, {
      changed: { lastMtimeMs: 2000 },
      unchanged: { lastMtimeMs: 1000 },
      deleted: { lastMtimeMs: 100 },
    });
    assert.deepEqual(dirty.sort(), ["changed", "new"]);
    assert.deepEqual(missing, ["deleted"]);
  });
});

describe("applyProcessed", () => {
  it("inserts new records for previously-unknown sessions", () => {
    const result = applyProcessed({}, [{ id: "a", mtimeMs: 1000 }]);
    assert.deepEqual(result, { a: { lastMtimeMs: 1000 } });
  });

  it("overwrites mtime for already-known sessions", () => {
    const result = applyProcessed({ a: { lastMtimeMs: 500 } }, [
      { id: "a", mtimeMs: 2000 },
    ]);
    assert.deepEqual(result, { a: { lastMtimeMs: 2000 } });
  });

  it("preserves records for sessions not in the just-processed list", () => {
    const result = applyProcessed({ kept: { lastMtimeMs: 111 } }, [
      { id: "new", mtimeMs: 222 },
    ]);
    assert.deepEqual(result, {
      kept: { lastMtimeMs: 111 },
      new: { lastMtimeMs: 222 },
    });
  });

  it("does not mutate the previous map", () => {
    const previous = { a: { lastMtimeMs: 1 } };
    applyProcessed(previous, [{ id: "a", mtimeMs: 999 }]);
    assert.deepEqual(previous, { a: { lastMtimeMs: 1 } });
  });
});
