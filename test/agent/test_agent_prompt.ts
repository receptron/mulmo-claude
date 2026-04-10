import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  buildMemoryContext,
  buildWikiContext,
  buildSystemPrompt,
} from "../../server/agent/prompt.js";
import type { Role } from "../../src/config/roles.js";

function makeRole(overrides?: Partial<Role>): Role {
  return {
    id: "test",
    name: "Test",
    icon: "science",
    prompt: "You are a test assistant.",
    availablePlugins: [],
    ...overrides,
  };
}

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "agent-prompt-test-"));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("buildMemoryContext", () => {
  it("includes memory.md content when file exists", () => {
    writeFileSync(join(workspace, "memory.md"), "User prefers dark mode");
    const result = buildMemoryContext(workspace);
    assert.ok(result.includes("User prefers dark mode"));
    assert.ok(result.includes("## Memory"));
    assert.ok(result.includes('<reference type="memory">'));
  });

  it("includes helps hint even without memory.md", () => {
    const result = buildMemoryContext(workspace);
    assert.ok(result.includes("helps/index.md"));
    assert.ok(!result.includes("User prefers"));
  });

  it("skips empty memory.md", () => {
    writeFileSync(join(workspace, "memory.md"), "   \n  ");
    const result = buildMemoryContext(workspace);
    assert.ok(result.includes("helps/index.md"));
    // The empty content is trimmed, so it won't appear
    assert.ok(!result.includes("   "));
  });
});

describe("buildWikiContext", () => {
  it("returns null when wiki/index.md does not exist", () => {
    const result = buildWikiContext(workspace);
    assert.equal(result, null);
  });

  it("returns layout description when index exists but no summary", () => {
    mkdirSync(join(workspace, "wiki"), { recursive: true });
    writeFileSync(join(workspace, "wiki", "index.md"), "# Index\n- page1");
    const result = buildWikiContext(workspace);
    assert.ok(result !== null);
    assert.ok(result.includes("wiki/index.md"));
    assert.ok(result.includes("wiki/pages/"));
  });

  it("includes summary when summary.md exists", () => {
    mkdirSync(join(workspace, "wiki"), { recursive: true });
    writeFileSync(join(workspace, "wiki", "index.md"), "# Index");
    writeFileSync(
      join(workspace, "wiki", "summary.md"),
      "Key topics: AI, cooking",
    );
    const result = buildWikiContext(workspace);
    assert.ok(result !== null);
    assert.ok(result.includes("Key topics: AI, cooking"));
    assert.ok(result.includes('<reference type="wiki-summary">'));
  });

  it("includes schema hint when SCHEMA.md exists", () => {
    mkdirSync(join(workspace, "wiki"), { recursive: true });
    writeFileSync(join(workspace, "wiki", "index.md"), "# Index");
    writeFileSync(join(workspace, "wiki", "SCHEMA.md"), "# Schema");
    const result = buildWikiContext(workspace);
    assert.ok(result !== null);
    assert.ok(result.includes("wiki/SCHEMA.md"));
  });

  it("falls back to layout hint when summary.md is empty", () => {
    mkdirSync(join(workspace, "wiki"), { recursive: true });
    writeFileSync(join(workspace, "wiki", "index.md"), "# Index");
    writeFileSync(join(workspace, "wiki", "summary.md"), "  ");
    const result = buildWikiContext(workspace);
    assert.ok(result !== null);
    assert.ok(!result.includes('<reference type="wiki-summary">'));
    assert.ok(result.includes("wiki/index.md"));
    assert.ok(result.includes("wiki/pages/"));
  });
});

describe("buildSystemPrompt", () => {
  it("contains role prompt", () => {
    const role = makeRole({ prompt: "You are a chef." });
    const result = buildSystemPrompt({ role, workspacePath: workspace });
    assert.ok(result.includes("You are a chef."));
  });

  it("contains workspace path", () => {
    const role = makeRole();
    const result = buildSystemPrompt({ role, workspacePath: workspace });
    assert.ok(result.includes(`Workspace directory: ${workspace}`));
  });

  it("contains today's date", () => {
    const role = makeRole();
    const result = buildSystemPrompt({ role, workspacePath: workspace });
    const today = new Date().toISOString().split("T")[0];
    assert.ok(result.includes(`Today's date: ${today}`));
  });

  it("contains memory context", () => {
    writeFileSync(join(workspace, "memory.md"), "Remember this");
    const role = makeRole();
    const result = buildSystemPrompt({ role, workspacePath: workspace });
    assert.ok(result.includes("Remember this"));
  });

  it("includes wiki context when wiki exists", () => {
    mkdirSync(join(workspace, "wiki"), { recursive: true });
    writeFileSync(join(workspace, "wiki", "index.md"), "# Index");
    const role = makeRole();
    const result = buildSystemPrompt({ role, workspacePath: workspace });
    assert.ok(result.includes("wiki/index.md"));
  });

  it("omits wiki context when wiki does not exist", () => {
    const role = makeRole();
    const result = buildSystemPrompt({ role, workspacePath: workspace });
    assert.ok(!result.includes("wiki/index.md"));
  });

  it("includes plugin prompt sections when provided", () => {
    const role = makeRole({ availablePlugins: ["manageTodoList"] });
    const result = buildSystemPrompt({
      role,
      workspacePath: workspace,
      pluginPrompts: {
        manageTodoList: "Use todos for task tracking",
      },
    });
    assert.ok(result.includes("## Plugin Instructions"));
    assert.ok(result.includes("### manageTodoList"));
    assert.ok(result.includes("Use todos for task tracking"));
  });

  it("omits plugin section when no prompts", () => {
    const role = makeRole();
    const result = buildSystemPrompt({ role, workspacePath: workspace });
    assert.ok(!result.includes("## Plugin Instructions"));
  });
});
