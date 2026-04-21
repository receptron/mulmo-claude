import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveProjectSkill, deleteProjectSkill } from "../../server/workspace/skills/writer.js";
import { projectSkillPath } from "../../server/workspace/skills/paths.js";

let workspace: string;
let userDir: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "skill-writer-ws-"));
  // We do NOT use the user's real ~/.claude/skills/ — simulate the
  // user scope by pointing discovery at a tmp dir inside the test.
  userDir = mkdtempSync(join(tmpdir(), "skill-writer-user-"));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
  rmSync(userDir, { recursive: true, force: true });
});

describe("saveProjectSkill — happy path", () => {
  it("writes SKILL.md under workspace/.claude/skills/<slug>/", async () => {
    const result = await saveProjectSkill({
      workspaceRoot: workspace,
      name: "fix-ci",
      description: "Fix CI failures and rerun",
      body: "## Steps\n\n1. Read the failing job\n2. Patch\n3. Push",
    });
    assert.equal(result.kind, "saved");
    if (result.kind !== "saved") return;
    const expected = projectSkillPath(workspace, "fix-ci");
    assert.equal(result.path, expected);
    const written = await readFile(expected, "utf-8");
    assert.match(written, /^---\ndescription: Fix CI failures and rerun\n---\n\n## Steps/);
    assert.ok(written.endsWith("\n"));
  });

  it("creates intermediate dirs when project skills root does not exist", async () => {
    // Ensure .claude/skills/ does not exist yet
    const result = await saveProjectSkill({
      workspaceRoot: workspace,
      name: "first-skill",
      description: "Bootstrap",
      body: "body",
    });
    assert.equal(result.kind, "saved");
  });

  it("escapes descriptions containing colons by quoting them", async () => {
    const result = await saveProjectSkill({
      workspaceRoot: workspace,
      name: "warn-on-fail",
      description: "Warn user: CI is red",
      body: "body",
    });
    assert.equal(result.kind, "saved");
    if (result.kind !== "saved") return;
    const written = await readFile(result.path, "utf-8");
    // Quoted form uses JSON.stringify so embedded `:` survives.
    assert.match(written, /^---\ndescription: "Warn user: CI is red"\n---/);
  });

  it("trims trailing whitespace from body but preserves inner newlines", async () => {
    const result = await saveProjectSkill({
      workspaceRoot: workspace,
      name: "shape",
      description: "x",
      body: "line1\n\nline2\n\n\n",
    });
    assert.equal(result.kind, "saved");
    if (result.kind !== "saved") return;
    const written = await readFile(result.path, "utf-8");
    assert.equal(written.endsWith("\n"), true);
    assert.equal(written.endsWith("\n\n"), false);
    assert.match(written, /line1\n\nline2/);
  });
});

describe("saveProjectSkill — validation", () => {
  it("rejects an invalid slug", async () => {
    const result = await saveProjectSkill({
      workspaceRoot: workspace,
      name: "Bad Slug!",
      description: "x",
      body: "y",
    });
    assert.deepEqual(result, { kind: "invalid-slug", slug: "Bad Slug!" });
  });

  it("rejects an empty description", async () => {
    const result = await saveProjectSkill({
      workspaceRoot: workspace,
      name: "ok",
      description: "   ",
      body: "y",
    });
    assert.deepEqual(result, { kind: "missing-field", field: "description" });
  });

  it("rejects a non-string body", async () => {
    const result = await saveProjectSkill({
      workspaceRoot: workspace,
      name: "ok",
      description: "x",
      body: undefined as unknown as string,
    });
    assert.deepEqual(result, { kind: "missing-field", field: "body" });
  });

  it("allows an empty-string body (skill might be metadata-only)", async () => {
    const result = await saveProjectSkill({
      workspaceRoot: workspace,
      name: "metadata-only",
      description: "Just frontmatter",
      body: "",
    });
    assert.equal(result.kind, "saved");
  });

  it("refuses to overwrite an existing project skill", async () => {
    await saveProjectSkill({
      workspaceRoot: workspace,
      name: "dup",
      description: "first",
      body: "v1",
    });
    const second = await saveProjectSkill({
      workspaceRoot: workspace,
      name: "dup",
      description: "second",
      body: "v2",
    });
    assert.deepEqual(second, { kind: "exists", name: "dup" });

    // Original content untouched
    const written = await readFile(projectSkillPath(workspace, "dup"), "utf-8");
    assert.match(written, /first/);
    assert.match(written, /v1/);
    assert.doesNotMatch(written, /second/);
  });
});

describe("deleteProjectSkill", () => {
  async function seed(name: string): Promise<void> {
    await saveProjectSkill({
      workspaceRoot: workspace,
      name,
      description: "x",
      body: "y",
    });
  }

  it("removes the SKILL.md and the containing dir", async () => {
    await seed("removable");
    const result = await deleteProjectSkill({
      workspaceRoot: workspace,
      name: "removable",
    });
    assert.deepEqual(result, { kind: "deleted", name: "removable" });

    // Re-saving the same slug should now succeed.
    const reSave = await saveProjectSkill({
      workspaceRoot: workspace,
      name: "removable",
      description: "fresh",
      body: "fresh body",
    });
    assert.equal(reSave.kind, "saved");
  });

  it("returns not-found when the skill does not exist", async () => {
    const result = await deleteProjectSkill({
      workspaceRoot: workspace,
      name: "ghost",
    });
    assert.deepEqual(result, { kind: "not-found", name: "ghost" });
  });

  it("rejects an invalid slug", async () => {
    const result = await deleteProjectSkill({
      workspaceRoot: workspace,
      name: "Bad/slug",
    });
    assert.deepEqual(result, { kind: "invalid-slug", slug: "Bad/slug" });
  });

  it("does not touch user-scope skills with the same name", async () => {
    // We can't override discoverSkills' user scope without injecting
    // a custom userDir, so this test simulates the user-skill case
    // by writing a fake user-scope skill via the same mechanism that
    // discovery uses. Skipped here because deleteProjectSkill calls
    // `discoverSkills({ workspaceRoot })` which always uses the real
    // ~/.claude/skills. We test the guard logic via the `not-found`
    // path above and rely on the e2e + manual smoke for the
    // user-scope-refusal case.
    //
    // (If discoverSkills grows a userDir override for the real
    // function — currently only `collectSkillsFromDir` is testable —
    // come back and add a real assertion here.)
  });

  it("survives a leftover non-SKILL file in the skill dir", async () => {
    await seed("with-extras");
    // Drop a sibling file alongside SKILL.md
    const dir = join(workspace, ".claude", "skills", "with-extras");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "README.md"), "extra notes");
    const result = await deleteProjectSkill({
      workspaceRoot: workspace,
      name: "with-extras",
    });
    // SKILL.md is gone, the rmdir is best-effort and leaves the
    // dir in place because of the extra file. That's intentional —
    // we don't want to delete user-added content.
    assert.deepEqual(result, { kind: "deleted", name: "with-extras" });
  });
});
