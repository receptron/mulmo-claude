import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { redactUser } from "../src/redactUser.js";

describe("redactUser", () => {
  it("hashes a Slack user ID to the u_ prefix + 8 hex chars", () => {
    const out = redactUser("U01ABCDEF23");
    assert.match(out, /^u_[0-9a-f]{8}$/);
  });

  it("returns a stable hash for the same input", () => {
    assert.equal(redactUser("U01ABCDEF23"), redactUser("U01ABCDEF23"));
  });

  it("produces different hashes for different users", () => {
    assert.notEqual(redactUser("U01AAA"), redactUser("U01BBB"));
  });

  it("does not leak the raw ID in the output", () => {
    // Regression guard: if the redactUser implementation is ever
    // simplified to a substring/prefix of the raw ID, this catches
    // it immediately. Compare against the full ID AND a substring —
    // the hash must not contain the raw user ID at all.
    const raw = "U01ABCDEF23";
    const out = redactUser(raw);
    assert.ok(!out.includes(raw), `redacted output '${out}' leaks raw ID '${raw}'`);
    assert.ok(!out.includes(raw.slice(1)), `redacted output '${out}' leaks a suffix of the raw ID`);
  });

  it("returns '?' placeholder for undefined", () => {
    assert.equal(redactUser(undefined), "?");
  });

  it("returns '?' placeholder for empty string", () => {
    // Empty strings shouldn't get hashed — an empty-string hash
    // would be the same for every caller, confusing log analysis.
    assert.equal(redactUser(""), "?");
  });
});
