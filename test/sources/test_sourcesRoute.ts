// Unit tests for the pure helpers in `server/api/routes/sources.ts`.
// End-to-end HTTP tests would need supertest (not in the dep
// tree) — pinning the validators + slug derivation table-driven
// gives good coverage without that.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateFetcherKind,
  validateSchedule,
  validateFetcherParams,
  resolveSlug,
  deriveSourceSlug,
} from "../../server/api/routes/sources.js";

// --- validateFetcherKind ------------------------------------------------

describe("validateFetcherKind", () => {
  it("returns the default when the field is undefined", () => {
    assert.equal(validateFetcherKind(undefined, "rss"), "rss");
  });

  it("returns the value when it matches the enum", () => {
    for (const kind of [
      "rss",
      "github-releases",
      "github-issues",
      "arxiv",
      "web-fetch",
      "web-search",
    ] as const) {
      assert.equal(validateFetcherKind(kind, "rss"), kind);
    }
  });

  it("returns null for unknown / wrong-typed values", () => {
    assert.equal(validateFetcherKind("bogus", "rss"), null);
    assert.equal(validateFetcherKind(42, "rss"), null);
    assert.equal(validateFetcherKind(null, "rss"), null);
    assert.equal(validateFetcherKind({}, "rss"), null);
  });
});

// --- validateSchedule ---------------------------------------------------

describe("validateSchedule", () => {
  it("returns the default when the field is undefined", () => {
    assert.equal(validateSchedule(undefined, "daily"), "daily");
  });

  it("returns the value when it matches the enum", () => {
    for (const sched of ["hourly", "daily", "weekly", "on-demand"] as const) {
      assert.equal(validateSchedule(sched, "daily"), sched);
    }
  });

  it("returns null for unknown / wrong-typed values", () => {
    assert.equal(validateSchedule("quarterly", "daily"), null);
    assert.equal(validateSchedule("Daily", "daily"), null); // case
    assert.equal(validateSchedule(42, "daily"), null);
  });
});

// --- validateFetcherParams ----------------------------------------------

describe("validateFetcherParams", () => {
  it("returns empty object when field is undefined (default)", () => {
    assert.deepEqual(validateFetcherParams(undefined), {});
  });

  it("returns the flat string map for a valid object", () => {
    assert.deepEqual(
      validateFetcherParams({
        github_repo: "anthropics/claude-code",
        arxiv_query: "cat:cs.CL",
      }),
      {
        github_repo: "anthropics/claude-code",
        arxiv_query: "cat:cs.CL",
      },
    );
  });

  it("returns null for arrays", () => {
    assert.equal(validateFetcherParams([1, 2, 3]), null);
    assert.equal(validateFetcherParams(["a", "b"]), null);
  });

  it("returns null for non-object primitive inputs", () => {
    assert.equal(validateFetcherParams("string"), null);
    assert.equal(validateFetcherParams(42), null);
    assert.equal(validateFetcherParams(null), null);
  });

  it("returns null when any value is non-string", () => {
    assert.equal(validateFetcherParams({ github_repo: "ok", max: 42 }), null);
    assert.equal(validateFetcherParams({ nested: { inner: "no" } }), null);
    assert.equal(validateFetcherParams({ bad: null }), null);
  });

  it("accepts empty object", () => {
    assert.deepEqual(validateFetcherParams({}), {});
  });
});

// --- deriveSourceSlug ---------------------------------------------------

describe("deriveSourceSlug", () => {
  it("derives a clean slug from an ASCII title", () => {
    assert.equal(deriveSourceSlug("Hacker News"), "hacker-news");
    assert.equal(
      deriveSourceSlug("Claude Code Releases"),
      "claude-code-releases",
    );
  });

  it("collapses runs of whitespace and punctuation into single hyphens", () => {
    assert.equal(deriveSourceSlug("HN!!! -- Front page"), "hn-front-page");
  });

  it("strips leading / trailing hyphens", () => {
    assert.equal(deriveSourceSlug("--leading"), "leading");
    assert.equal(deriveSourceSlug("trailing--"), "trailing");
  });

  it("falls back to the hash form when the ASCII derivation is empty", () => {
    // `!!` has no letters / digits → derived ASCII is "" →
    // hash fallback keeps a stable filename.
    assert.match(deriveSourceSlug("!!"), /^source-[0-9a-f]{10}$/);
  });

  it("caps at 60 characters", () => {
    const title = "word ".repeat(50);
    const slug = deriveSourceSlug(title);
    assert.ok(slug.length <= 60);
  });

  it("falls back to a hash for titles with no ASCII alnum", () => {
    // Pure CJK / emoji — no ASCII letters or digits to build a
    // slug from. Hash fallback keeps a stable filename.
    const slug = deriveSourceSlug("日本のニュース");
    assert.match(slug, /^source-[0-9a-f]{10}$/);
  });

  it("is deterministic for the same input", () => {
    const a = deriveSourceSlug("Cool feed");
    const b = deriveSourceSlug("Cool feed");
    assert.equal(a, b);
    const h1 = deriveSourceSlug("日本語");
    const h2 = deriveSourceSlug("日本語");
    assert.equal(h1, h2);
  });
});

// --- resolveSlug --------------------------------------------------------

describe("resolveSlug", () => {
  it("uses the caller-supplied slug when valid", () => {
    assert.equal(resolveSlug("my-feed", "Any title"), "my-feed");
  });

  it("trims whitespace on the caller slug", () => {
    assert.equal(resolveSlug("  trim-me  ", "t"), "trim-me");
  });

  it("returns null when the caller-supplied slug is invalid", () => {
    // Doesn't silently auto-derive — signals the shape error back
    // to the client so they fix their input.
    assert.equal(resolveSlug("UPPERCASE", "fallback"), null);
    assert.equal(resolveSlug("with spaces", "fallback"), null);
    assert.equal(resolveSlug("../etc", "fallback"), null);
    assert.equal(resolveSlug("double--hyphen", "fallback"), null);
  });

  it("derives from title when slug is missing / empty", () => {
    assert.equal(resolveSlug(undefined, "Hacker News"), "hacker-news");
    assert.equal(resolveSlug("", "Hacker News"), "hacker-news");
    assert.equal(resolveSlug("   ", "Hacker News"), "hacker-news");
  });

  it("derives from title when slug is not a string", () => {
    assert.equal(resolveSlug(42, "Hacker News"), "hacker-news");
    assert.equal(resolveSlug(null, "Hacker News"), "hacker-news");
  });
});
