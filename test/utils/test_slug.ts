import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "crypto";
import { DEFAULT_MAX_LENGTH, disambiguateSlug, hasNonAscii, hashSlug, isValidSlug, slugify } from "../../server/utils/slug.js";

const HASH_LEN = 16;

function expectedHash(input: string, len = HASH_LEN): string {
  return createHash("sha256").update(input, "utf-8").digest("base64url").slice(0, len);
}

describe("hasNonAscii", () => {
  it("is false for pure ASCII", () => {
    assert.equal(hasNonAscii("Doing"), false);
    assert.equal(hasNonAscii("project-a_2"), false);
    assert.equal(hasNonAscii(""), false);
  });

  it("is true for any non-ASCII codepoint", () => {
    assert.equal(hasNonAscii("完了"), true);
    assert.equal(hasNonAscii("Doing (進行中)"), true);
    assert.equal(hasNonAscii("🎉"), true);
  });
});

describe("hashSlug", () => {
  it("returns a deterministic base64url-encoded sha256 prefix", () => {
    assert.equal(hashSlug("完了"), expectedHash("完了"));
    assert.equal(hashSlug("完了"), hashSlug("完了"));
  });

  it("yields different hashes for inputs differing only in suffix", () => {
    assert.notEqual(hashSlug("プロジェクトA"), hashSlug("プロジェクトB"));
  });

  it("respects the requested length", () => {
    assert.equal(hashSlug("完了", 8).length, 8);
    assert.equal(hashSlug("完了", 32).length, 32);
  });
});

describe("slugify (ASCII happy path)", () => {
  it("lowercases and hyphenates", () => {
    assert.equal(slugify("Hello World"), "hello-world");
  });

  it("collapses non-alnum runs", () => {
    assert.equal(slugify("Q&A: notes!"), "q-a-notes");
  });

  it("trims leading/trailing hyphens", () => {
    assert.equal(slugify("---foo---"), "foo");
  });

  it("returns the default when input is empty", () => {
    assert.equal(slugify(""), "page");
    assert.equal(slugify("", "column"), "column");
  });

  it("returns the default when all chars strip away", () => {
    assert.equal(slugify("!!!"), "page");
  });

  it("respects maxLength", () => {
    assert.equal(slugify("a".repeat(80), "page", 10), "aaaaaaaaaa");
  });

  it("uses default maxLength=120 when not specified", () => {
    // Default cap was bumped to 120 (#732). A 200-char input gets
    // truncated to exactly 120 — boundary check.
    assert.equal(slugify("a".repeat(200)).length, 120);
  });

  it("does not truncate ASCII inputs at the old 60-char cap", () => {
    // Regression guard: previously the default was 60, so an 80-char
    // input came back as 80 chars but a 70-char input came back as 60.
    // After #732 we want the full 70 (and full 80) preserved.
    const seventy = "a".repeat(70);
    assert.equal(slugify(seventy).length, 70);
  });
});

describe("slugify (non-ASCII fallback)", () => {
  it("produces a deterministic hash for pure non-ASCII labels", () => {
    assert.equal(slugify("完了"), expectedHash("完了"));
  });

  it("gives different ids to labels differing only in suffix", () => {
    const slugA = slugify("プロジェクトA");
    const slugB = slugify("プロジェクトB");
    assert.notEqual(slugA, slugB);
    assert.equal(slugA.length, HASH_LEN);
    assert.equal(slugB.length, HASH_LEN);
  });

  it("keeps an ASCII prefix when ≥3 chars survive", () => {
    const result = slugify("Doing (進行中)");
    assert.match(result, /^doing-[A-Za-z0-9_-]+$/);
    assert.ok(result.endsWith(expectedHash("Doing (進行中)".trim())));
  });

  it("skips the ASCII prefix when <3 chars survive", () => {
    // "A" in "A完了" is only 1 char — too short to be useful
    const result = slugify("A完了");
    assert.equal(result, expectedHash("A完了"));
  });

  it("does not collide 'プロジェクト' and 'プロジェクト ' (whitespace) by design", () => {
    // trim() is applied before hashing, so trailing whitespace collapses.
    // Distinct *content* still hashes distinctly; this is about trim only.
    assert.equal(slugify("プロジェクト"), slugify("プロジェクト "));
  });

  it("honours maxLength when composing 'prefix-hash'", () => {
    const result = slugify("doing-marker-(進行中)", "page", 30);
    assert.ok(result.length <= 30);
    assert.ok(result.endsWith(expectedHash("doing-marker-(進行中)".trim())));
  });

  it("handles emoji-only input", () => {
    const result = slugify("🎉🎊");
    assert.equal(result, expectedHash("🎉🎊"));
  });
});

// isValidSlug — consolidated from sources/paths.ts + skills/paths.ts
describe("isValidSlug", () => {
  it("accepts lowercase alphanumeric with hyphens", () => {
    assert.equal(isValidSlug("hn"), true);
    assert.equal(isValidSlug("hn-front-page"), true);
    assert.equal(isValidSlug("a"), true);
    assert.equal(isValidSlug("arxiv-2024"), true);
    assert.equal(isValidSlug("100"), true);
  });

  it("rejects empty and too-long strings", () => {
    // Cap is DEFAULT_MAX_LENGTH (120); 121 chars must fail. Bumped from
    // 64→120 alongside the slug-rule unification (#732) so journal /
    // todo / wiki / files share one rule.
    assert.equal(isValidSlug(""), false);
    assert.equal(isValidSlug("a".repeat(121)), false);
  });

  it("accepts the 120-char boundary", () => {
    assert.equal(isValidSlug("a".repeat(120)), true);
  });

  it("rejects uppercase", () => {
    assert.equal(isValidSlug("HN"), false);
    assert.equal(isValidSlug("Hacker-News"), false);
  });

  it("rejects special characters", () => {
    assert.equal(isValidSlug("hn_front"), false);
    assert.equal(isValidSlug("hn.front"), false);
    assert.equal(isValidSlug("hn/front"), false);
    assert.equal(isValidSlug("hn front"), false);
  });

  it("rejects leading/trailing hyphens", () => {
    assert.equal(isValidSlug("-hn"), false);
    assert.equal(isValidSlug("hn-"), false);
    assert.equal(isValidSlug("-"), false);
  });

  it("rejects consecutive hyphens", () => {
    assert.equal(isValidSlug("hn--front"), false);
  });

  it("rejects path-traversal attempts", () => {
    assert.equal(isValidSlug(".."), false);
    assert.equal(isValidSlug("../etc/passwd"), false);
    assert.equal(isValidSlug(".hidden"), false);
  });

  it("rejects non-string inputs", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.equal(isValidSlug(null as any), false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.equal(isValidSlug(42 as any), false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.equal(isValidSlug(undefined as any), false);
  });
});

describe("disambiguateSlug", () => {
  it("returns the base unchanged when no collision exists", () => {
    assert.equal(disambiguateSlug("review", new Set()), "review");
    assert.equal(disambiguateSlug("review", new Set(["other", "another"])), "review");
  });

  it("appends -2 on the first collision", () => {
    assert.equal(disambiguateSlug("review", new Set(["review"])), "review-2");
  });

  it("walks forward through -3, -4, ...", () => {
    assert.equal(disambiguateSlug("review", new Set(["review", "review-2", "review-3"])), "review-4");
  });

  it("preserves a hyphen-prefix base (no double hyphen)", () => {
    // base ends with non-hyphen; suffix join is single hyphen.
    const result = disambiguateSlug("doing-abc", new Set(["doing-abc"]));
    assert.equal(result, "doing-abc-2");
    assert.ok(isValidSlug(result));
  });

  it("truncates when base + suffix would exceed DEFAULT_MAX_LENGTH (Codex iter-1 #732)", () => {
    // 120-char base + "-2" naively yields 122 chars, failing isValidSlug.
    const base = "a".repeat(DEFAULT_MAX_LENGTH);
    const result = disambiguateSlug(base, new Set([base]));
    assert.ok(result.length <= DEFAULT_MAX_LENGTH, `expected length <= ${DEFAULT_MAX_LENGTH}, got ${result.length}`);
    assert.ok(isValidSlug(result), `expected valid slug, got "${result}"`);
    assert.ok(result.endsWith("-2"));
  });

  it("strips a trailing hyphen revealed by truncation so the join doesn't yield '--'", () => {
    // 120-char base where slice(0, 118) ends with "-"; without the
    // trailing-hyphen trim the disambiguation would emit "...--2".
    const tricky = `${"x".repeat(117)}-aa`;
    const result = disambiguateSlug(tricky, new Set([tricky]));
    assert.equal(result.indexOf("--"), -1, `must not contain '--', got "${result}"`);
    assert.ok(isValidSlug(result));
    assert.ok(result.endsWith("-2"));
  });

  it("strips a trailing hyphen on the no-truncation path too (Codex iter-3 #732)", () => {
    // Defensive boundary: a short base ending with "-" fits within
    // `room` so the early-return path applies. Without trimming, the
    // join would yield "abc--2" which fails `isValidSlug`.
    // Current callers (slugify producers) never emit a trailing-
    // hyphen base, but the helper is exported, so it must stay safe
    // for any input.
    const result = disambiguateSlug("abc-", new Set(["abc-"]));
    assert.equal(result.indexOf("--"), -1, `must not contain '--', got "${result}"`);
    assert.equal(result, "abc-2");
    assert.ok(isValidSlug(result));
  });

  it("short-circuits on an empty base instead of fabricating '-2' (Codex iter-4 #732)", () => {
    // Precondition: base must be a canonical slug. Empty and all-
    // hyphen inputs can't produce a valid disambiguation, so the
    // helper returns them unchanged rather than emitting an invalid
    // leading-hyphen slug like "-2". Production callers (slugify
    // producers) never pass these, but the contract guarantees that
    // invalid base in => invalid base out (never invalid base in =>
    // *new* invalid slug out).
    assert.equal(disambiguateSlug("", new Set([""])), "");
    assert.equal(disambiguateSlug("", new Set()), "");
  });

  it("short-circuits on all-hyphen bases ('-', '--', '---')", () => {
    assert.equal(disambiguateSlug("-", new Set(["-"])), "-");
    assert.equal(disambiguateSlug("--", new Set(["--"])), "--");
    assert.equal(disambiguateSlug("---", new Set()), "---");
  });

  it("strips a trailing hyphen at exactly room-size (no overflow, no early return shortcut)", () => {
    // Base length === room (118 for `-2`); the cut point falls exactly
    // at the trailing hyphen. Both paths (overflow / no-overflow) must
    // converge on the same trim behaviour — Codex iter-3 specifically
    // flagged this exact-room-size boundary.
    const base = `${"y".repeat(117)}-`; // length 118 = room for `-2`
    const result = disambiguateSlug(base, new Set([base]));
    assert.equal(result.indexOf("--"), -1, `must not contain '--', got "${result}"`);
    assert.ok(isValidSlug(result));
    assert.ok(result.endsWith("-2"));
  });

  it("walks the truncated suffix through -3, -4 too", () => {
    const base = "a".repeat(DEFAULT_MAX_LENGTH);
    const existing = new Set([base, disambiguateSlug(base, new Set([base])), disambiguateSlug(base, new Set([base, disambiguateSlug(base, new Set([base]))]))]);
    const result = disambiguateSlug(base, existing);
    assert.ok(result.length <= DEFAULT_MAX_LENGTH);
    assert.ok(isValidSlug(result));
    assert.ok(result.endsWith("-4"), `expected -4 suffix, got "${result}"`);
  });
});
