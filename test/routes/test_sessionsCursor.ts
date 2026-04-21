import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  encodeCursor,
  parseCursor,
  sessionChangeMs,
} from "../../server/api/routes/sessionsCursor.js";

// Pure helpers backing the /api/sessions?since= implementation
// (issue #205). Exercised in isolation so the route handler's
// tests can focus on end-to-end behaviour without re-litigating
// cursor format edge cases.

describe("encodeCursor", () => {
  it("stamps the v1: prefix and a numeric ms", () => {
    assert.equal(encodeCursor(1234), "v1:1234");
  });
  it("floors fractional inputs", () => {
    assert.equal(encodeCursor(1234.9), "v1:1234");
  });
  it("maps 0 / negative / non-finite to v1:0", () => {
    assert.equal(encodeCursor(0), "v1:0");
    assert.equal(encodeCursor(-5), "v1:0");
    assert.equal(encodeCursor(Number.NaN), "v1:0");
    assert.equal(encodeCursor(Number.POSITIVE_INFINITY), "v1:0");
  });
});

describe("parseCursor", () => {
  it("roundtrips encodeCursor", () => {
    assert.equal(
      parseCursor(encodeCursor(1_700_000_000_000)),
      1_700_000_000_000,
    );
  });
  it("returns 0 for non-strings", () => {
    assert.equal(parseCursor(undefined), 0);
    assert.equal(parseCursor(null), 0);
    assert.equal(parseCursor(42), 0);
    assert.equal(parseCursor({}), 0);
  });
  it("returns 0 for unknown prefixes — forces a full resend instead of a 400", () => {
    // Intentional: we would rather download one extra list than
    // break the sidebar after a cursor-format rename.
    assert.equal(parseCursor("v0:1234"), 0);
    assert.equal(parseCursor("1234"), 0);
    assert.equal(parseCursor(""), 0);
    assert.equal(parseCursor("v1:"), 0);
    assert.equal(parseCursor("v1:abc"), 0);
  });
  it("rejects zero / negative encoded values", () => {
    assert.equal(parseCursor("v1:0"), 0);
    assert.equal(parseCursor("v1:-5"), 0);
  });
});

describe("sessionChangeMs", () => {
  it("picks the jsonl mtime when there is no index entry", () => {
    assert.equal(sessionChangeMs(100, undefined), 100);
  });
  it("picks the later of mtime and indexedAt", () => {
    const mtime = 1_700_000_000_000;
    const later = new Date(mtime + 5_000).toISOString();
    assert.equal(sessionChangeMs(mtime, later), mtime + 5_000);

    const earlier = new Date(mtime - 5_000).toISOString();
    assert.equal(sessionChangeMs(mtime, earlier), mtime);
  });
  it("falls back to mtime alone when indexedAt is malformed", () => {
    assert.equal(sessionChangeMs(100, "not a date"), 100);
  });
  it("folds meta mtime into the max", () => {
    const mtime = 1_700_000_000_000;
    assert.equal(
      sessionChangeMs(mtime, undefined, mtime + 9_000),
      mtime + 9_000,
    );
    assert.equal(sessionChangeMs(mtime, undefined, mtime - 9_000), mtime);
  });
  it("ignores an undefined or non-finite meta mtime", () => {
    assert.equal(sessionChangeMs(100, undefined, undefined), 100);
    assert.equal(sessionChangeMs(100, undefined, Number.NaN), 100);
  });
});
