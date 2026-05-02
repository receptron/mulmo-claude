// Unit tests for `getActiveToolDescriptors` — the single source of
// truth that drives `getActivePlugins(role)` (config.ts) and
// `buildPluginPromptSections(role)` (prompt.ts). Verifies the two
// invariants that broke during runtime-plugin rollout:
//
//   1. Static GUI / MCP tools are gated by role.availablePlugins.
//   2. Runtime plugins (#1043 C-2) are auto-included regardless.
//
// Plus collision behaviour and the precomputed full-name field that
// the prompt's MCP-prefix hint depends on.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Role } from "../../src/config/roles.ts";
import type { ToolDefinition } from "gui-chat-protocol";
import { getActiveToolDescriptors, MCP_SERVER_ID } from "../../server/agent/activeTools.ts";
import { registerRuntimePlugins, _resetRuntimeRegistryForTest } from "../../server/plugins/runtime-registry.ts";
import type { RuntimePlugin } from "../../server/plugins/runtime-loader.ts";

const fakeDef = (name: string, description = `tool ${name}`, prompt?: string): ToolDefinition => ({
  type: "function",
  name,
  description,
  ...(prompt ? { prompt } : {}),
  parameters: { type: "object", properties: {}, required: [] },
});

const fakeRuntimePlugin = (pkg: string, toolName: string, prompt?: string): RuntimePlugin => ({
  name: pkg,
  version: "1.0.0",
  cachePath: `/tmp/cache/${pkg}/1.0.0`,
  definition: fakeDef(toolName, `runtime tool ${toolName}`, prompt),
  execute: () => null,
});

const fakeRole = (availablePlugins: string[]): Role =>
  ({
    id: "test",
    name: "Test",
    icon: "star",
    prompt: "",
    availablePlugins,
  }) as unknown as Role;

beforeEach(() => _resetRuntimeRegistryForTest());
afterEach(() => _resetRuntimeRegistryForTest());

describe("getActiveToolDescriptors — single source of truth", () => {
  it("returns at least the static GUI plugins gated by role.availablePlugins", () => {
    // The role lists `manageTodoList` (a real PLUGIN_DEFS entry); the
    // descriptor for that plugin must surface with source=static-gui.
    const role = fakeRole(["manageTodoList"]);
    const descriptors = getActiveToolDescriptors(role);
    const todoEntry = descriptors.find((descriptor) => descriptor.name === "manageTodoList");
    assert.ok(todoEntry, "manageTodoList should appear in active descriptors when role allows it");
    assert.equal(todoEntry?.source, "static-gui");
    assert.ok(todoEntry?.endpoint, "static GUI plugins carry their HTTP endpoint");
  });

  it("does NOT surface a static plugin the role does not allow", () => {
    const role = fakeRole([]);
    const descriptors = getActiveToolDescriptors(role);
    assert.equal(
      descriptors.find((descriptor) => descriptor.name === "manageTodoList"),
      undefined,
    );
  });

  it("auto-includes runtime plugins regardless of role.availablePlugins", () => {
    registerRuntimePlugins(new Set(), [fakeRuntimePlugin("@x/weather", "fetchWeather")]);
    const role = fakeRole([]); // empty role — no static plugins allowed
    const descriptors = getActiveToolDescriptors(role);
    const weather = descriptors.find((descriptor) => descriptor.name === "fetchWeather");
    assert.ok(weather, "runtime plugins should be active even when the role doesn't list them");
    assert.equal(weather?.source, "runtime");
    assert.ok(weather?.endpoint?.includes("/api/plugins/runtime/"), "runtime plugins use the generic dispatch route");
  });

  it("precomputes the fully-qualified mcp__<server>__<name> id", () => {
    registerRuntimePlugins(new Set(), [fakeRuntimePlugin("@x/weather", "fetchWeather")]);
    const role = fakeRole([]);
    const descriptors = getActiveToolDescriptors(role);
    const weather = descriptors.find((descriptor) => descriptor.name === "fetchWeather");
    assert.equal(weather?.fullName, `mcp__${MCP_SERVER_ID}__fetchWeather`);
  });

  it("surfaces the plugin's prompt when set, falls back to description otherwise", () => {
    registerRuntimePlugins(new Set(), [fakeRuntimePlugin("@x/with-prompt", "withPrompt", "Use this for X.")]);
    registerRuntimePlugins(new Set(), [fakeRuntimePlugin("@x/no-prompt", "noPrompt")]);
    // The second registerRuntimePlugins call resets the registry, so
    // only `noPrompt` is registered. Re-register both together to
    // exercise both shapes in one descriptor list.
    _resetRuntimeRegistryForTest();
    registerRuntimePlugins(new Set(), [fakeRuntimePlugin("@x/with-prompt", "withPrompt", "Use this for X."), fakeRuntimePlugin("@x/no-prompt", "noPrompt")]);
    const role = fakeRole([]);
    const descriptors = getActiveToolDescriptors(role);
    assert.equal(descriptors.find((descriptor) => descriptor.name === "withPrompt")?.prompt, "Use this for X.");
    assert.equal(descriptors.find((descriptor) => descriptor.name === "noPrompt")?.prompt, undefined);
    assert.equal(descriptors.find((descriptor) => descriptor.name === "noPrompt")?.description, "runtime tool noPrompt");
  });

  it("dedupes when a runtime plugin shares a name with a static plugin (defensive — registry should already filter)", () => {
    // The runtime registry's collision policy normally rejects
    // names already in MCP_PLUGIN_NAMES, so this state shouldn't
    // happen in production. The descriptor builder still has its
    // own `seen` guard to keep the contract robust if the policy
    // is ever loosened.
    registerRuntimePlugins(new Set(), [fakeRuntimePlugin("@x/clash", "manageTodoList")]);
    const role = fakeRole(["manageTodoList"]);
    const descriptors = getActiveToolDescriptors(role);
    const matches = descriptors.filter((descriptor) => descriptor.name === "manageTodoList");
    assert.equal(matches.length, 1, "name should appear once even with a runtime collision");
    assert.equal(matches[0].source, "static-gui", "static wins over runtime in the unified list");
  });

  it("does not include runtime plugins when the registry is empty", () => {
    const role = fakeRole(["manageTodoList"]);
    const descriptors = getActiveToolDescriptors(role);
    assert.equal(descriptors.filter((descriptor) => descriptor.source === "runtime").length, 0);
  });

  it("returned list is the union with no duplicates across all sources", () => {
    registerRuntimePlugins(new Set(), [fakeRuntimePlugin("@x/r1", "r1Tool"), fakeRuntimePlugin("@x/r2", "r2Tool")]);
    const role = fakeRole(["manageTodoList", "presentMulmoScript"]);
    const descriptors = getActiveToolDescriptors(role);
    const names = descriptors.map((descriptor) => descriptor.name);
    assert.equal(new Set(names).size, names.length, "no duplicate tool names");
    assert.ok(names.includes("r1Tool"));
    assert.ok(names.includes("r2Tool"));
    assert.ok(names.includes("manageTodoList"));
  });
});
