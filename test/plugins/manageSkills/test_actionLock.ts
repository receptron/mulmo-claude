import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { acquireActionKey, releaseActionKey } from "../../../src/plugins/manageSkills/actionLock.js";

describe("acquireActionKey", () => {
  it("acquires when idle", () => {
    assert.deepEqual(acquireActionKey(null, "a"), { acquired: true, key: "a" });
  });

  it("rejects while another key is held, leaving the holder unchanged", () => {
    assert.deepEqual(acquireActionKey("a", "b"), { acquired: false, key: "a" });
  });

  // Double-click on the same entry while its action is in flight.
  it("rejects re-acquiring the same key", () => {
    assert.deepEqual(acquireActionKey("a", "a"), { acquired: false, key: "a" });
  });
});

describe("releaseActionKey", () => {
  it("releases when the caller owns the lock", () => {
    assert.equal(releaseActionKey("a", "a"), null);
  });

  // A superseded action's late completion must not clear a newer holder.
  it("leaves a newer holder untouched when a stale owner releases", () => {
    assert.equal(releaseActionKey("b", "a"), "b");
  });

  it("is a no-op when the lock is already free", () => {
    assert.equal(releaseActionKey(null, "a"), null);
  });
});

describe("acquire/release round-trip", () => {
  it("returns to idle after the owner releases", () => {
    const { acquired, key } = acquireActionKey(null, "x");
    assert.equal(acquired, true);
    assert.equal(releaseActionKey(key, "x"), null);
  });

  it("a rejected acquirer releasing does not free the real holder", () => {
    const held = "owner";
    const { acquired } = acquireActionKey(held, "intruder");
    assert.equal(acquired, false);
    // The intruder never owned it, so its release must be a no-op.
    assert.equal(releaseActionKey(held, "intruder"), held);
  });
});
