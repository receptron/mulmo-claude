// Unit tests for the pure request-body builder extracted from
// `src/App.vue#sendMessage`. See plans/refactor-vue-cognitive-complexity.md
// and issue #175.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildPluginPromptsMap,
  buildAgentRequestBody,
} from "../../../src/utils/agent/request.js";
import type { Role } from "../../../src/config/roles.js";

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: "test-role",
    name: "Test Role",
    icon: "bolt",
    prompt: "",
    availablePlugins: [],
    ...overrides,
  };
}

describe("buildPluginPromptsMap", () => {
  it("returns {} for empty availablePlugins", () => {
    assert.deepEqual(
      buildPluginPromptsMap([], () => "anything"),
      {},
    );
  });

  it("maps plugins whose lookup returns a non-empty string", () => {
    const prompts: Record<string, string> = {
      alpha: "prompt for alpha",
      beta: "prompt for beta",
    };
    const out = buildPluginPromptsMap(
      ["alpha", "beta"],
      (name) => prompts[name],
    );
    assert.deepEqual(out, prompts);
  });

  it("skips plugins whose lookup returns undefined", () => {
    const out = buildPluginPromptsMap(["alpha", "unknown", "beta"], (name) =>
      name === "alpha" ? "P-alpha" : undefined,
    );
    assert.deepEqual(out, { alpha: "P-alpha" });
  });

  it("skips plugins whose lookup returns an empty string", () => {
    // Empty string carries no meaningful prompt content and would
    // only clutter the LLM's system section.
    const out = buildPluginPromptsMap(["alpha"], () => "");
    assert.deepEqual(out, {});
  });

  it("preserves first-occurrence order of availablePlugins", () => {
    const out = buildPluginPromptsMap(["c", "a", "b"], (name) => `P-${name}`);
    assert.deepEqual(Object.keys(out), ["c", "a", "b"]);
  });

  it("handles a plugin name that appears twice (second wins via object assignment)", () => {
    // Object keys are unique — the second entry overwrites the
    // first. We document current behaviour here so a future
    // dedup refactor doesn't silently change the outcome.
    let count = 0;
    const out = buildPluginPromptsMap(["alpha", "alpha"], () => `P-${++count}`);
    assert.deepEqual(out, { alpha: "P-2" });
  });

  it("tolerates a lookup that throws (no wrapping — throws escape)", () => {
    // Document current contract: the helper does not shield
    // callers from a broken lookup. If this ever changes (e.g.
    // add a try/catch + skip), update the test and the docs.
    const role = makeRole({ availablePlugins: ["bad"] });
    assert.throws(() =>
      buildPluginPromptsMap(role.availablePlugins, () => {
        throw new Error("boom");
      }),
    );
  });
});

describe("buildAgentRequestBody — happy path", () => {
  it("assembles every field in the shape the server expects", () => {
    const role = makeRole({
      id: "coder",
      availablePlugins: ["todo", "wiki"],
    });
    const body = buildAgentRequestBody({
      message: "hello",
      role,
      chatSessionId: "sess-1",
      systemPrompt: "SYS",
      selectedImageData: "data:image/png;base64,AAA",
      getPluginSystemPrompt: (name) =>
        name === "todo" ? "todo-prompt" : undefined,
    });
    assert.deepEqual(body, {
      message: "hello",
      roleId: "coder",
      chatSessionId: "sess-1",
      selectedImageData: "data:image/png;base64,AAA",
      systemPrompt: "SYS",
      pluginPrompts: { todo: "todo-prompt" },
    });
  });

  it("leaves selectedImageData as undefined when not provided", () => {
    const body = buildAgentRequestBody({
      message: "hi",
      role: makeRole(),
      chatSessionId: "s",
      systemPrompt: "",
      getPluginSystemPrompt: () => undefined,
    });
    assert.equal(body.selectedImageData, undefined);
  });

  it("returns an empty pluginPrompts object when the role has no plugins", () => {
    const body = buildAgentRequestBody({
      message: "hi",
      role: makeRole({ availablePlugins: [] }),
      chatSessionId: "s",
      systemPrompt: "",
      getPluginSystemPrompt: () => "ignored",
    });
    assert.deepEqual(body.pluginPrompts, {});
  });
});

describe("buildAgentRequestBody — edge cases", () => {
  it("accepts an empty message (sendMessage guards upstream; this helper doesn't)", () => {
    const body = buildAgentRequestBody({
      message: "",
      role: makeRole(),
      chatSessionId: "s",
      systemPrompt: "",
      getPluginSystemPrompt: () => undefined,
    });
    assert.equal(body.message, "");
  });

  it("passes the role's id through regardless of role name/icon", () => {
    const role = makeRole({ id: "abc-123", name: "Name", icon: "bolt" });
    const body = buildAgentRequestBody({
      message: "m",
      role,
      chatSessionId: "s",
      systemPrompt: "",
      getPluginSystemPrompt: () => undefined,
    });
    assert.equal(body.roleId, "abc-123");
  });

  it("passes systemPrompt verbatim (does not trim or modify)", () => {
    const body = buildAgentRequestBody({
      message: "m",
      role: makeRole(),
      chatSessionId: "s",
      systemPrompt: "  leading whitespace intentional  ",
      getPluginSystemPrompt: () => undefined,
    });
    assert.equal(body.systemPrompt, "  leading whitespace intentional  ");
  });
});
