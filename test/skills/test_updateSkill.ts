// Unit tests for updateProjectSkill() — the writer behind
// PUT /api/skills/:name (#342).

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import { updateProjectSkill } from "../../server/workspace/skills/writer.ts";

let tmpDir = "";

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mulmo-skill-update-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createSkill(name: string, desc: string, body: string): void {
  const skillDir = path.join(tmpDir, ".claude", "skills", name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    `---\ndescription: ${desc}\n---\n\n${body}`,
  );
}

describe("updateProjectSkill", () => {
  it("updates an existing project-scope skill", async () => {
    createSkill("my-skill", "old desc", "old body");
    const result = await updateProjectSkill({
      workspaceRoot: tmpDir,
      name: "my-skill",
      description: "new desc",
      body: "new body",
    });
    assert.equal(result.kind, "updated");
    if (result.kind === "updated") {
      const content = fs.readFileSync(result.path, "utf-8");
      assert.ok(content.includes("new desc"));
      assert.ok(content.includes("new body"));
    }
  });

  it("returns not-found for a non-existent skill", async () => {
    const result = await updateProjectSkill({
      workspaceRoot: tmpDir,
      name: "ghost",
      description: "x",
      body: "y",
    });
    assert.equal(result.kind, "not-found");
  });

  it("returns invalid-slug for bad names", async () => {
    const result = await updateProjectSkill({
      workspaceRoot: tmpDir,
      name: "../escape",
      description: "x",
      body: "y",
    });
    assert.equal(result.kind, "invalid-slug");
  });

  it("returns missing-field when description is empty", async () => {
    createSkill("my-skill", "desc", "body");
    const result = await updateProjectSkill({
      workspaceRoot: tmpDir,
      name: "my-skill",
      description: "",
      body: "body",
    });
    assert.equal(result.kind, "missing-field");
    if (result.kind === "missing-field") {
      assert.equal(result.field, "description");
    }
  });

  it("preserves the file when update overwrites", async () => {
    createSkill("my-skill", "v1", "body v1");
    await updateProjectSkill({
      workspaceRoot: tmpDir,
      name: "my-skill",
      description: "v2",
      body: "body v2",
    });
    const content = fs.readFileSync(
      path.join(tmpDir, ".claude", "skills", "my-skill", "SKILL.md"),
      "utf-8",
    );
    assert.ok(!content.includes("v1"));
    assert.ok(content.includes("v2"));
    assert.ok(content.includes("body v2"));
  });
});
