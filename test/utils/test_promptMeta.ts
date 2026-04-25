import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { promptMeta } from "../../server/utils/promptMeta.js";

describe("promptMeta", () => {
  it("returns length matching the input string length", () => {
    assert.equal(promptMeta("").length, 0);
    assert.equal(promptMeta("hello").length, 5);
    assert.equal(promptMeta("a".repeat(120)).length, 120);
  });

  it("returns a 12-hex-char sha256 prefix (lowercase)", () => {
    const meta = promptMeta("hello world");
    assert.match(meta.sha256, /^[0-9a-f]{12}$/, "sha256 prefix must be 12 lowercase hex chars");
  });

  it("returns the same fingerprint for the same prompt (deterministic)", () => {
    const first = promptMeta("sunset over kyoto");
    const second = promptMeta("sunset over kyoto");
    assert.deepEqual(first, second);
  });

  it("returns different sha256 prefixes for different prompts", () => {
    // Sanity check on the hash — two visually similar prompts must
    // produce different fingerprints.
    const lower = promptMeta("sunset over kyoto");
    const titled = promptMeta("Sunset over Kyoto");
    assert.notEqual(lower.sha256, titled.sha256);
  });

  it("matches the SHA-256 of the input (first 12 hex chars)", () => {
    // Pin to a known SHA-256 so a future change to the algorithm /
    // length is caught explicitly. SHA-256 of "hello" is
    // 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824.
    assert.equal(promptMeta("hello").sha256, "2cf24dba5fb0");
  });

  it("handles non-ASCII prompts correctly (utf-8 byte hash)", () => {
    // SHA-256 must operate on the utf-8 bytes of the string, not on
    // the JS unit count, otherwise prompts with combining characters
    // would collide unexpectedly.
    const meta = promptMeta("夕焼けの京都");
    assert.equal(meta.length, 6);
    assert.match(meta.sha256, /^[0-9a-f]{12}$/);
  });

  it("does NOT include the raw prompt anywhere in the returned object", () => {
    // The whole point of this helper is to never persist user content
    // to logs. JSON-stringifying the result must not contain the
    // input substring.
    const secret = "sk_live_abcdefg1234567890";
    const meta = promptMeta(`Generate an image of ${secret}`);
    const serialized = JSON.stringify(meta);
    assert.equal(serialized.includes(secret), false);
    assert.equal(serialized.includes("sk_live"), false);
    assert.equal(serialized.includes("Generate an image"), false);
  });
});
