import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { buildMemoryContext, buildWikiContext, buildSystemPrompt, headingSection, prependJournalPointer } from "../../server/agent/prompt.js";
import { WORKSPACE_FILES } from "../../server/workspace/paths.js";
import { dirname } from "path";
import type { Role } from "../../src/config/roles.js";

function ensureDir(p: string): void {
  mkdirSync(p, { recursive: true });
}
function writeFileAt(workspace: string, rel: string, content: string): void {
  const abs = join(workspace, rel);
  ensureDir(dirname(abs));
  writeFileSync(abs, content);
}

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

describe("headingSection", () => {
  it("wraps items under a ## heading joined by blank lines", () => {
    const out = headingSection("Plugin Instructions", ["### a\n\nbody a", "### b\n\nbody b"]);
    assert.equal(out, "## Plugin Instructions\n\n### a\n\nbody a\n\n### b\n\nbody b");
  });

  it("returns null when the list is empty so callers can skip the section", () => {
    assert.equal(headingSection("Whatever", []), null);
  });

  it("keeps a single item verbatim under the heading", () => {
    const out = headingSection("Reference Files", ["### helps/index.md\n\ncontent"]);
    assert.equal(out, "## Reference Files\n\n### helps/index.md\n\ncontent");
  });

  it("preserves embedded blank lines inside items", () => {
    // Items can contain their own paragraph breaks; join should use
    // exactly \n\n between items and not touch the item text.
    const out = headingSection("Section", ["line1\n\nline2", "line3"]);
    assert.equal(out, "## Section\n\nline1\n\nline2\n\nline3");
  });
});

describe("buildMemoryContext", () => {
  it("includes memory.md content when file exists", () => {
    writeFileAt(workspace, WORKSPACE_FILES.memory, "User prefers dark mode");
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
    writeFileAt(workspace, WORKSPACE_FILES.memory, "   \n  ");
    const result = buildMemoryContext(workspace);
    assert.ok(result.includes("helps/index.md"));
    // The empty content is trimmed, so it won't appear
    assert.ok(!result.includes("   "));
  });
});

describe("buildWikiContext", () => {
  it("returns path hint when wiki/index.md does not exist", () => {
    const result = buildWikiContext(workspace);
    assert.ok(result !== null);
    assert.ok(result.includes("data/wiki/"));
    assert.ok(result.includes("No wiki exists yet"));
  });

  it("returns layout description when index exists but no summary", () => {
    writeFileAt(workspace, WORKSPACE_FILES.wikiIndex, "# Index\n- page1");
    const result = buildWikiContext(workspace);
    assert.ok(result !== null);
    assert.ok(result.includes("data/wiki/index.md"));
    assert.ok(result.includes("data/wiki/pages/"));
  });

  it("includes summary when summary.md exists", () => {
    writeFileAt(workspace, WORKSPACE_FILES.wikiIndex, "# Index");
    writeFileAt(workspace, WORKSPACE_FILES.wikiSummary, "Key topics: AI, cooking");
    const result = buildWikiContext(workspace);
    assert.ok(result !== null);
    assert.ok(result.includes("Key topics: AI, cooking"));
    assert.ok(result.includes('<reference type="wiki-summary">'));
  });

  it("includes schema hint when SCHEMA.md exists", () => {
    writeFileAt(workspace, WORKSPACE_FILES.wikiIndex, "# Index");
    writeFileAt(workspace, WORKSPACE_FILES.wikiSchema, "# Schema");
    const result = buildWikiContext(workspace);
    assert.ok(result !== null);
    assert.ok(result.includes("data/wiki/SCHEMA.md"));
  });

  it("falls back to layout hint when summary.md is empty", () => {
    writeFileAt(workspace, WORKSPACE_FILES.wikiIndex, "# Index");
    writeFileAt(workspace, WORKSPACE_FILES.wikiSummary, "  ");
    const result = buildWikiContext(workspace);
    assert.ok(result !== null);
    assert.ok(!result.includes('<reference type="wiki-summary">'));
    assert.ok(result.includes("data/wiki/index.md"));
    assert.ok(result.includes("data/wiki/pages/"));
  });
});

describe("buildSystemPrompt", () => {
  it("contains the base SYSTEM_PROMPT", () => {
    const role = makeRole();
    const result = buildSystemPrompt({
      role,
      workspacePath: workspace,
      useDocker: false,
    });
    assert.ok(result.includes("You are MulmoClaude"));
  });

  it("contains role prompt", () => {
    const role = makeRole({ prompt: "You are a chef." });
    const result = buildSystemPrompt({
      role,
      workspacePath: workspace,
      useDocker: false,
    });
    assert.ok(result.includes("You are a chef."));
  });

  it("contains workspace path", () => {
    const role = makeRole();
    const result = buildSystemPrompt({
      role,
      workspacePath: workspace,
      useDocker: false,
    });
    assert.ok(result.includes(`Workspace directory: ${workspace}`));
  });

  it("contains today's date", () => {
    const role = makeRole();
    const result = buildSystemPrompt({
      role,
      workspacePath: workspace,
      useDocker: false,
    });
    const today = new Date().toISOString().split("T")[0];
    assert.ok(result.includes(`Today's date: ${today}`));
  });

  it("contains memory context", () => {
    writeFileAt(workspace, WORKSPACE_FILES.memory, "Remember this");
    const role = makeRole();
    const result = buildSystemPrompt({
      role,
      workspacePath: workspace,
      useDocker: false,
    });
    assert.ok(result.includes("Remember this"));
  });

  it("includes wiki context when wiki exists", () => {
    writeFileAt(workspace, WORKSPACE_FILES.wikiIndex, "# Index");
    const role = makeRole();
    const result = buildSystemPrompt({
      role,
      workspacePath: workspace,
      useDocker: false,
    });
    assert.ok(result.includes("data/wiki/index.md"));
  });

  it("includes wiki path hint even when wiki does not exist", () => {
    const role = makeRole();
    const result = buildSystemPrompt({
      role,
      workspacePath: workspace,
      useDocker: false,
    });
    assert.ok(result.includes("No wiki exists yet"));
    assert.ok(result.includes("data/wiki/"));
  });

  it("includes plugin prompt sections from ToolDefinition.prompt", () => {
    // manageTodoList has a prompt in its definition.ts — it should
    // appear in the system prompt when included in availablePlugins.
    const role = makeRole({ availablePlugins: ["manageTodoList"] });
    const result = buildSystemPrompt({
      role,
      workspacePath: workspace,
      useDocker: false,
    });
    assert.ok(result.includes("## Plugin Instructions"));
    assert.ok(result.includes("### manageTodoList"));
    assert.ok(result.includes("todo list"));
  });

  it("emits the Sandbox Tools hint when useDocker is true", () => {
    const role = makeRole();
    const result = buildSystemPrompt({
      role,
      workspacePath: workspace,
      useDocker: true,
    });
    assert.ok(result.includes("## Sandbox Tools"));
    // A few key tool mentions so we notice if the list drifts.
    assert.ok(result.includes("pandas"));
    assert.ok(result.includes("pandoc"));
    assert.ok(result.includes("ripgrep"));
  });

  it("omits the Sandbox Tools hint when useDocker is false", () => {
    const role = makeRole();
    const result = buildSystemPrompt({
      role,
      workspacePath: workspace,
      useDocker: false,
    });
    assert.ok(!result.includes("## Sandbox Tools"));
  });

  it("omits plugin section when no prompts", () => {
    const role = makeRole();
    const result = buildSystemPrompt({
      role,
      workspacePath: workspace,
      useDocker: false,
    });
    assert.ok(!result.includes("## Plugin Instructions"));
  });
});

describe("prependJournalPointer", () => {
  function writeJournalIndex(): void {
    writeFileAt(workspace, WORKSPACE_FILES.summariesIndex, "# Workspace Journal\n\n- refactoring\n- video-generation\n");
  }

  it("returns the original message unchanged when _index.md is absent", () => {
    const result = prependJournalPointer("hello world", workspace);
    assert.equal(result, "hello world");
  });

  it("prepends a journal-context block when _index.md exists", () => {
    writeJournalIndex();
    const result = prependJournalPointer("hello world", workspace);
    assert.ok(result.includes("<journal-context>"));
    assert.ok(result.includes("</journal-context>"));
    assert.notEqual(result, "hello world");
  });

  it("mentions all three path types in the pointer", () => {
    writeJournalIndex();
    const result = prependJournalPointer("anything", workspace);
    assert.ok(result.includes("summaries/_index.md"));
    assert.ok(result.includes("summaries/topics/"));
    assert.ok(result.includes("summaries/daily/"));
  });

  it("preserves the original user message verbatim at the end", () => {
    writeJournalIndex();
    const message = "What did I do last week with the video plugin?";
    const result = prependJournalPointer(message, workspace);
    assert.ok(result.endsWith(`\n${message}`), "decorated message should end with the original message on its own line");
  });

  it("preserves a trailing newline in the original message", () => {
    writeJournalIndex();
    const message = "What did I do last week with the video plugin?\n";
    const result = prependJournalPointer(message, workspace);
    assert.ok(result.endsWith(`\n${message}`), "decorated message should preserve a trailing newline in the original message");
  });

  it("handles an empty message without crashing", () => {
    writeJournalIndex();
    const result = prependJournalPointer("", workspace);
    assert.ok(result.includes("<journal-context>"));
    assert.ok(result.endsWith("\n"));
  });

  it("explicitly permits skipping when the question is self-contained", () => {
    // The pointer wording is load-bearing for the feature — it
    // tells the LLM that opt-out is allowed. Pin this so accidental
    // rewording doesn't turn the pointer into a mandatory Read.
    writeJournalIndex();
    const result = prependJournalPointer("hi", workspace);
    assert.ok(result.toLowerCase().includes("skip"), "pointer should tell the model it can skip when not needed");
  });
});
