import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  isValidSlug,
  projectSkillsDir,
  projectSkillPath,
  projectSkillDir,
} from "../../server/skills/paths.js";

describe("isValidSlug", () => {
  it("accepts ordinary kebab-case slugs", () => {
    assert.equal(isValidSlug("ci-enable"), true);
    assert.equal(isValidSlug("yarn-update"), true);
    assert.equal(isValidSlug("a"), true);
    assert.equal(isValidSlug("publish"), true);
  });

  it("accepts digits and mixes", () => {
    assert.equal(isValidSlug("v2-release"), true);
    assert.equal(isValidSlug("tool42"), true);
    assert.equal(isValidSlug("0"), true);
  });

  it("rejects empty / non-string input", () => {
    assert.equal(isValidSlug(""), false);
    assert.equal(isValidSlug(undefined as unknown as string), false);
    assert.equal(isValidSlug(null as unknown as string), false);
    assert.equal(isValidSlug(42 as unknown as string), false);
  });

  it("rejects uppercase / underscores / spaces", () => {
    assert.equal(isValidSlug("CI-Enable"), false);
    assert.equal(isValidSlug("ci_enable"), false);
    assert.equal(isValidSlug("ci enable"), false);
  });

  it("rejects path traversal characters", () => {
    assert.equal(isValidSlug(".."), false);
    assert.equal(isValidSlug("../etc"), false);
    assert.equal(isValidSlug("a/b"), false);
    assert.equal(isValidSlug("a\\b"), false);
  });

  it("rejects leading / trailing hyphens", () => {
    assert.equal(isValidSlug("-foo"), false);
    assert.equal(isValidSlug("foo-"), false);
  });

  it("rejects consecutive hyphens", () => {
    assert.equal(isValidSlug("foo--bar"), false);
  });

  it("rejects strings longer than 64 chars", () => {
    assert.equal(isValidSlug("a".repeat(64)), true);
    assert.equal(isValidSlug("a".repeat(65)), false);
  });
});

describe("projectSkillsDir / projectSkillPath / projectSkillDir", () => {
  // Use a platform-appropriate workspace root so the path.join() output
  // matches on Windows (backslashes) as well as POSIX.
  const workspace = path.join(path.sep, "tmp", "ws");

  it("composes the project skills root under the workspace", () => {
    const got = projectSkillsDir(workspace);
    assert.equal(got, path.join(workspace, ".claude", "skills"));
  });

  it("appends the slug + SKILL.md for projectSkillPath", () => {
    const got = projectSkillPath(workspace, "fix-ci");
    assert.equal(
      got,
      path.join(workspace, ".claude", "skills", "fix-ci", "SKILL.md"),
    );
  });

  it("returns the dir holding the SKILL.md", () => {
    const got = projectSkillDir(workspace, "fix-ci");
    assert.equal(got, path.join(workspace, ".claude", "skills", "fix-ci"));
  });
});
