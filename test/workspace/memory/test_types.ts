// Unit tests for the memory schema helpers (#1029).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isMemoryType, slugifyMemoryName } from "../../../server/workspace/memory/types.js";
import { isSafeMemorySlug } from "../../../server/workspace/memory/io.js";

describe("memory/types — isMemoryType", () => {
  it("accepts the four canonical types", () => {
    assert.equal(isMemoryType("preference"), true);
    assert.equal(isMemoryType("interest"), true);
    assert.equal(isMemoryType("fact"), true);
    assert.equal(isMemoryType("reference"), true);
  });

  it("rejects unknown / wrong-shape values", () => {
    assert.equal(isMemoryType("PREFERENCE"), false);
    assert.equal(isMemoryType(""), false);
    assert.equal(isMemoryType(undefined), false);
    assert.equal(isMemoryType(42), false);
  });
});

describe("memory/types — slugifyMemoryName", () => {
  it("compacts ASCII names into <type>_<words>", () => {
    assert.equal(slugifyMemoryName("yarn を使う", "preference"), "preference_yarn");
    assert.equal(slugifyMemoryName("Egypt trip 2026", "fact"), "fact_egypt-trip-2026");
  });

  it("falls back to a hash suffix when the name has no ASCII alnum chars", () => {
    const slug = slugifyMemoryName("印象派", "interest");
    assert.match(slug, /^interest_[a-z0-9]+$/);
  });

  it("caps long bullets so the result is well under the 200-char safety limit", () => {
    // Real-world case: a recurring-task pointer in the user's
    // legacy memory.md ran ~300 chars, which produced a slug that
    // tripped `isSafeMemorySlug`'s upper bound and dropped the
    // entry on disk. The slugifier must truncate before we hand
    // off to the writer.
    const longName =
      "has a recurring task live-concerts-watch (weekly) that monitors ticket sites Live Nation Japan Creativeman Smash Hostess Hot Stuff uDiscoverMusic for Japan concert dates of 35 watched artists";
    const slug = slugifyMemoryName(longName, "reference");
    assert.ok(slug.startsWith("reference_"), "slug keeps the type prefix");
    assert.ok(slug.length <= 100, `slug is bounded; got ${slug.length} chars`);
    assert.ok(isSafeMemorySlug(slug), "slug passes the writer-side safety gate");
    // Truncation should not leave a dangling separator at the tail.
    assert.equal(slug.endsWith("-"), false);
  });
});
