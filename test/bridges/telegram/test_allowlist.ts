import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createAllowlist,
  parseAllowlist,
} from "../../../bridges/telegram/allowlist.ts";

describe("parseAllowlist", () => {
  it("empty / undefined → deny-everyone allowlist", () => {
    for (const input of [undefined, "", "   "]) {
      const list = parseAllowlist(input);
      assert.equal(list.size(), 0);
      assert.equal(list.allows(123), false);
      assert.equal(list.allows(0), false);
    }
  });

  it("parses a single integer", () => {
    const list = parseAllowlist("12345");
    assert.equal(list.size(), 1);
    assert.equal(list.allows(12345), true);
    assert.equal(list.allows(6789), false);
  });

  it("parses a CSV with whitespace around entries", () => {
    const list = parseAllowlist("1, 2 ,3");
    assert.deepEqual(list.snapshot(), [1, 2, 3]);
  });

  it("accepts negative chat IDs (groups) and zero is valid", () => {
    const list = parseAllowlist("-100123,0,42");
    assert.equal(list.allows(-100123), true);
    assert.equal(list.allows(0), true);
    assert.equal(list.allows(42), true);
  });

  it("drops empty segments from trailing commas", () => {
    const list = parseAllowlist("1,2,");
    assert.deepEqual(list.snapshot(), [1, 2]);
  });

  it("deduplicates repeated entries", () => {
    const list = parseAllowlist("7,7,7");
    assert.equal(list.size(), 1);
    assert.equal(list.allows(7), true);
  });

  it("throws on non-integer entries (typo detector)", () => {
    assert.throws(() => parseAllowlist("abc"), /not an integer/);
    assert.throws(() => parseAllowlist("1,two,3"), /"two"/);
    assert.throws(() => parseAllowlist("1.5"), /not an integer/);
  });
});

describe("createAllowlist", () => {
  it("builds a list from any iterable", () => {
    const list = createAllowlist([1, 2, 3]);
    assert.equal(list.allows(2), true);
    assert.equal(list.allows(4), false);
  });

  it("snapshot() returns a sorted copy, caller cannot mutate state", () => {
    const list = createAllowlist([3, 1, 2]);
    const snap = list.snapshot() as number[];
    assert.deepEqual(snap, [1, 2, 3]);
    snap.push(999);
    assert.equal(list.allows(999), false);
  });
});
