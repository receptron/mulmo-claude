import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CATEGORY_SLUGS,
  isCategorySlug,
  normalizeCategories,
} from "../../server/workspace/sources/taxonomy.js";

describe("CATEGORY_SLUGS — shape pin", () => {
  it("contains the phase-1 taxonomy with no duplicates", () => {
    // A mutation that removes a slug would silently drop every
    // source tagged with it. Pin the list explicitly so any edit
    // lands in this test too.
    assert.deepEqual(Array.from(CATEGORY_SLUGS), [
      "tech-news",
      "business-news",
      "ai",
      "security",
      "devops",
      "frontend",
      "backend",
      "ml-research",
      "dependencies",
      "product-updates",
      "japanese",
      "english",
      "papers",
      "general",
      "startup",
      "personal",
      "finance",
      "design",
      "productivity",
      "science",
      "health",
      "gaming",
      "climate",
      "culture",
      "policy",
    ]);
  });

  it("has no duplicates", () => {
    assert.equal(new Set(CATEGORY_SLUGS).size, CATEGORY_SLUGS.length);
  });
});

describe("isCategorySlug", () => {
  it("accepts every slug in the taxonomy", () => {
    for (const slug of CATEGORY_SLUGS) {
      assert.equal(isCategorySlug(slug), true, `expected ${slug} accepted`);
    }
  });

  it("rejects slugs not in the taxonomy", () => {
    assert.equal(isCategorySlug("artificial-intelligence"), false);
    assert.equal(isCategorySlug("AI"), false); // wrong case
    assert.equal(isCategorySlug("tech_news"), false); // underscore
    assert.equal(isCategorySlug(""), false);
  });

  it("rejects non-string values", () => {
    assert.equal(isCategorySlug(null), false);
    assert.equal(isCategorySlug(undefined), false);
    assert.equal(isCategorySlug(42), false);
    assert.equal(isCategorySlug(["ai"]), false);
    assert.equal(isCategorySlug({ slug: "ai" }), false);
  });
});

describe("normalizeCategories", () => {
  it("returns only valid slugs from a mixed list", () => {
    const out = normalizeCategories([
      "ai",
      "bogus",
      "security",
      "AI", // wrong case
      "startup",
    ]);
    assert.deepEqual(out, ["ai", "security", "startup"]);
  });

  it("deduplicates repeats", () => {
    const out = normalizeCategories(["ai", "ai", "security", "ai"]);
    assert.deepEqual(out, ["ai", "security"]);
  });

  it("preserves input order on the first occurrence of each", () => {
    // A sort-based dedup would fail this test; explicit order
    // preservation matches what the classifier prompt asks for.
    assert.deepEqual(normalizeCategories(["security", "ai", "papers"]), [
      "security",
      "ai",
      "papers",
    ]);
  });

  it("returns [] for non-array inputs", () => {
    assert.deepEqual(normalizeCategories("ai"), []);
    assert.deepEqual(normalizeCategories(null), []);
    assert.deepEqual(normalizeCategories(undefined), []);
    assert.deepEqual(normalizeCategories({ "0": "ai" }), []);
  });

  it("returns [] for an array of no valid slugs", () => {
    assert.deepEqual(normalizeCategories(["foo", "bar", 42]), []);
  });

  it("returns [] for an empty array", () => {
    assert.deepEqual(normalizeCategories([]), []);
  });
});
