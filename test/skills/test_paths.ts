import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  projectSkillsDir,
  projectSkillPath,
  projectSkillDir,
} from "../../server/workspace/skills/paths.js";
// isValidSlug tests moved to test/utils/test_slug.ts — the function
// itself was consolidated to server/utils/slug.ts in PR #377.

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
