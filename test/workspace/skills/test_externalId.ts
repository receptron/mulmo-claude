// The sanitisers that stand between a caller-supplied repo id / subpath and
// `path.join` + git's sparse-checkout patterns. All four shipped untested.
//
// Their failure mode is the dangerous one: they return a STRING, not a throw.
// A hole here does not crash — it hands a traversal token to a path join and
// the escape happens quietly, one layer down.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isSafeRepoId, safeRepoId, safeSkillFolder, sanitiseSubpath } from "../../../server/workspace/skills/external/id.js";

describe("isSafeRepoId", () => {
  it("accepts the shape deriveRepoId produces", () => {
    assert.equal(isSafeRepoId("owner-repo"), true);
    assert.equal(isSafeRepoId("a"), true);
    assert.equal(isSafeRepoId("a1"), true);
    assert.equal(isSafeRepoId("my-org-my-repo"), true);
  });

  it("rejects uppercase — ids are lowercased at derivation", () => {
    assert.equal(isSafeRepoId("Owner-Repo"), false);
  });

  it("rejects leading and trailing hyphens", () => {
    assert.equal(isSafeRepoId("-repo"), false);
    assert.equal(isSafeRepoId("repo-"), false);
  });

  it("rejects the empty string", () => {
    assert.equal(isSafeRepoId(""), false);
  });

  // These are the characters that would matter if one slipped into a path.
  it("rejects separators, dots and traversal tokens", () => {
    for (const bad of ["..", ".", "a/b", "a\\b", "a.b", "a_b", "a b", "a\0b"]) {
      assert.equal(isSafeRepoId(bad), false, `expected ${JSON.stringify(bad)} to be rejected`);
    }
  });

  // A `$` anchor alone would let a newline-terminated string through; the regex
  // must not treat the value as multiline.
  it("rejects a value with a trailing newline", () => {
    assert.equal(isSafeRepoId("repo\n"), false);
    assert.equal(isSafeRepoId("repo\nrm -rf /"), false);
  });
});

describe("safeRepoId", () => {
  it("returns the id unchanged when it is already safe", () => {
    assert.equal(safeRepoId("owner-repo"), "owner-repo");
  });

  it("returns null for anything the shape check rejects", () => {
    for (const bad of ["", "..", "a/b", "Owner", "-x", "x-"]) {
      assert.equal(safeRepoId(bad), null, `expected ${JSON.stringify(bad)} to be rejected`);
    }
  });

  // The basename round-trip is what CodeQL recognises as the path-injection
  // sanitiser; the regex alone is not enough, so it must actually run.
  it("returns null when the value is not its own basename", () => {
    assert.equal(safeRepoId("dir/owner-repo"), null);
  });
});

describe("safeSkillFolder", () => {
  it("accepts an ordinary folder leaf", () => {
    assert.equal(safeSkillFolder("my-skill"), "my-skill");
    assert.equal(safeSkillFolder("My_Skill"), "My_Skill");
  });

  // Deliberately more permissive than the repo-id rule: install discovery
  // accepts these, and the read side must agree or an installed skill becomes
  // invisible.
  it("allows interior dots and mixed case", () => {
    assert.equal(safeSkillFolder("v1.2"), "v1.2");
    assert.equal(safeSkillFolder("Skill.v2"), "Skill.v2");
  });

  it("rejects empty, dot and dot-dot", () => {
    assert.equal(safeSkillFolder(""), null);
    assert.equal(safeSkillFolder("."), null);
    assert.equal(safeSkillFolder(".."), null);
  });

  it("rejects hidden folders", () => {
    assert.equal(safeSkillFolder(".git"), null);
    assert.equal(safeSkillFolder(".hidden-skill"), null);
  });

  it("rejects separators and NUL", () => {
    for (const bad of ["a/b", "a\\b", "../escape", "a\0b", "/abs"]) {
      assert.equal(safeSkillFolder(bad), null, `expected ${JSON.stringify(bad)} to be rejected`);
    }
  });
});

describe("sanitiseSubpath", () => {
  it("returns a normalised a/b/c path", () => {
    assert.equal(sanitiseSubpath("skills/mine"), "skills/mine");
    assert.equal(sanitiseSubpath("one"), "one");
  });

  // Empty and `.` segments are dropped rather than rejected, so a trailing or
  // doubled slash normalises instead of failing.
  it("drops empty and dot segments", () => {
    assert.equal(sanitiseSubpath("a//b/"), "a/b");
    assert.equal(sanitiseSubpath("a/./b"), "a/b");
    assert.equal(sanitiseSubpath("a/."), "a");
  });

  it("rejects a leading slash", () => {
    assert.equal(sanitiseSubpath("/etc/passwd"), null);
  });

  // The value flows into `path.join(cacheDir, subpath)` AND into a git
  // sparse-checkout pattern, so traversal and pattern-injection characters
  // both have to die here.
  it("rejects traversal segments anywhere in the path", () => {
    assert.equal(sanitiseSubpath(".."), null);
    assert.equal(sanitiseSubpath("../etc"), null);
    assert.equal(sanitiseSubpath("a/../../etc"), null);
    assert.equal(sanitiseSubpath("a/b/.."), null);
  });

  it("rejects NUL, backslash and newlines", () => {
    assert.equal(sanitiseSubpath("a\0b"), null);
    assert.equal(sanitiseSubpath("a\\b"), null);
    assert.equal(sanitiseSubpath("a\nb"), null);
    assert.equal(sanitiseSubpath("a\rb"), null);
  });

  // A segment must be alnum plus `.`, `-`, `_`; anything a shell or a git
  // pattern would treat specially is out.
  it("rejects segments with characters outside the allowlist", () => {
    for (const bad of ["a b", "a*b", "a?b", "a|b", "a;b", "a$b", "a{b}"]) {
      assert.equal(sanitiseSubpath(bad), null, `expected ${JSON.stringify(bad)} to be rejected`);
    }
  });

  it("rejects a path that reduces to nothing", () => {
    assert.equal(sanitiseSubpath(""), null);
    assert.equal(sanitiseSubpath("."), null);
    assert.equal(sanitiseSubpath("//"), null);
  });
});
