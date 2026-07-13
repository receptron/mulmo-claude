import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cliArgsForInput } from "../../server/agent/backend/claude-code.js";
import type { AgentInput } from "../../server/agent/backend/types.js";
import { ROLES, type Role } from "../../src/config/roles.js";

function requireRole(roleId: string): Role {
  const role = ROLES.find((candidate) => candidate.id === roleId);
  if (!role) throw new Error(`test setup: role '${roleId}' not found`);
  return role;
}

function makeInput(overrides: Partial<AgentInput> = {}): AgentInput {
  return {
    systemPrompt: "sys",
    message: "hi",
    role: requireRole("general"),
    workspacePath: "/tmp/does-not-matter",
    sessionId: `test-${randomUUID()}`,
    port: 0,
    activePlugins: [],
    extraAllowedTools: [],
    useDocker: false,
    ...overrides,
  };
}

const PROMPT_PATH = "/tmp/system-prompt.md";

describe("cliArgsForInput", () => {
  it("maps sessionToken onto claudeSessionId (the --resume id)", () => {
    const params = cliArgsForInput(makeInput({ sessionToken: "resume-123" }), PROMPT_PATH);
    assert.equal(params.claudeSessionId, "resume-123");
  });

  it("carries the system-prompt file path, not the prompt text", () => {
    // The prompt itself travels via --system-prompt-file (Windows
    // command lines cap at ~32k chars — inline text ENAMETOOLONGs).
    const params = cliArgsForInput(makeInput({ systemPrompt: "SP" }), PROMPT_PATH);
    assert.equal(params.systemPromptPath, PROMPT_PATH);
    assert.ok(!("systemPrompt" in params));
  });

  it("forwards the pass-through fields verbatim", () => {
    const params = cliArgsForInput(
      makeInput({
        activePlugins: ["a", "b"],
        mcpConfigPath: "/cfg.json",
        extraAllowedTools: ["Bash"],
        effortLevel: "high",
      }),
      PROMPT_PATH,
    );
    assert.deepEqual(params.activePlugins, ["a", "b"]);
    assert.equal(params.mcpConfigPath, "/cfg.json");
    assert.deepEqual(params.extraAllowedTools, ["Bash"]);
    assert.equal(params.effortLevel, "high");
  });

  it("leaves optional fields undefined when the input omits them", () => {
    const params = cliArgsForInput(makeInput(), PROMPT_PATH);
    assert.equal(params.claudeSessionId, undefined);
    assert.equal(params.mcpConfigPath, undefined);
    assert.equal(params.effortLevel, undefined);
  });

  it("does not carry over non-CLI fields (message, workspacePath, port)", () => {
    const params = cliArgsForInput(makeInput({ message: "secret", port: 9999 }), PROMPT_PATH);
    assert.ok(!("message" in params));
    assert.ok(!("workspacePath" in params));
    assert.ok(!("port" in params));
  });
});
