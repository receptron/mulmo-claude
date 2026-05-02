import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { ToolDefinition } from "gui-chat-protocol";
import {
  registerRuntimePlugins,
  getRuntimePlugins,
  getRuntimePluginByToolName,
  getRuntimeToolDefinitions,
  _resetRuntimeRegistryForTest,
} from "../../server/plugins/runtime-registry.js";
import type { RuntimePlugin } from "../../server/plugins/runtime-loader.js";

const fakeDef = (name: string): ToolDefinition => ({
  type: "function",
  name,
  description: `tool ${name}`,
  parameters: { type: "object", properties: {}, required: [] },
});

const fakePlugin = (pkg: string, version: string, toolName: string): RuntimePlugin => ({
  name: pkg,
  version,
  cachePath: `/tmp/cache/${pkg}/${version}`,
  definition: fakeDef(toolName),
  execute: null,
});

describe("runtime-registry", () => {
  beforeEach(() => _resetRuntimeRegistryForTest());

  it("registers plugins whose tool names don't collide", () => {
    const result = registerRuntimePlugins(new Set(["staticOne"]), [fakePlugin("@x/a", "1.0.0", "alpha"), fakePlugin("@x/b", "1.0.0", "beta")]);
    assert.equal(result.registered.length, 2);
    assert.equal(result.collisions.length, 0);
    assert.equal(getRuntimePlugins().length, 2);
  });

  it("static tool names always win — runtime collisions skipped with reason=static", () => {
    const result = registerRuntimePlugins(new Set(["builtin"]), [fakePlugin("@x/a", "1.0.0", "builtin")]);
    assert.equal(result.registered.length, 0);
    assert.equal(result.collisions.length, 1);
    assert.equal(result.collisions[0].reason, "static");
    assert.equal(result.collisions[0].existingTool, "builtin");
  });

  it("static set must include MCP tool names too — `notify` collision skipped", () => {
    // Mirrors how mcp-server.ts now passes both PLUGIN_DEFS names and
    // mcpToolDefs keys (notify / readXPost / searchX). Without this
    // combined set, a runtime plugin named `notify` would shadow the
    // built-in.
    const staticSet = new Set(["manageTodoList", "presentForm", "notify", "readXPost", "searchX"]);
    const result = registerRuntimePlugins(staticSet, [fakePlugin("@x/notify-clone", "1.0.0", "notify")]);
    assert.equal(result.registered.length, 0);
    assert.equal(result.collisions.length, 1);
    assert.equal(result.collisions[0].reason, "static");
    assert.equal(result.collisions[0].existingTool, "notify");
  });

  it("runtime-vs-runtime collision: first-loaded wins, second skipped with reason=runtime", () => {
    const first = fakePlugin("@x/a", "1.0.0", "shared");
    const second = fakePlugin("@y/b", "1.0.0", "shared");
    const result = registerRuntimePlugins(new Set(), [first, second]);
    assert.equal(result.registered.length, 1);
    assert.equal(result.registered[0].name, "@x/a");
    assert.equal(result.collisions.length, 1);
    assert.equal(result.collisions[0].reason, "runtime");
    assert.equal(result.collisions[0].plugin.name, "@y/b");
  });

  it("getRuntimePluginByToolName resolves registered tool names", () => {
    registerRuntimePlugins(new Set(), [fakePlugin("@x/weather", "0.1.0", "fetchWeather")]);
    const found = getRuntimePluginByToolName("fetchWeather");
    assert.ok(found);
    assert.equal(found?.name, "@x/weather");
  });

  it("getRuntimePluginByToolName returns null for unknown tool", () => {
    registerRuntimePlugins(new Set(), [fakePlugin("@x/a", "1.0.0", "alpha")]);
    assert.equal(getRuntimePluginByToolName("missing"), null);
  });

  it("getRuntimeToolDefinitions returns the ToolDefinition list", () => {
    registerRuntimePlugins(new Set(), [fakePlugin("@x/a", "1.0.0", "alpha"), fakePlugin("@x/b", "1.0.0", "beta")]);
    const defs = getRuntimeToolDefinitions();
    assert.equal(defs.length, 2);
    assert.deepEqual(
      defs.map((def) => def.name),
      ["alpha", "beta"],
    );
  });

  it("re-registration replaces the previous set", () => {
    registerRuntimePlugins(new Set(), [fakePlugin("@x/a", "1.0.0", "alpha")]);
    assert.equal(getRuntimePlugins().length, 1);
    registerRuntimePlugins(new Set(), [fakePlugin("@x/b", "1.0.0", "beta"), fakePlugin("@x/c", "1.0.0", "gamma")]);
    const current = getRuntimePlugins();
    assert.equal(current.length, 2);
    assert.equal(getRuntimePluginByToolName("alpha"), null);
    assert.ok(getRuntimePluginByToolName("beta"));
  });

  it("empty input clears the registry", () => {
    registerRuntimePlugins(new Set(), [fakePlugin("@x/a", "1.0.0", "alpha")]);
    assert.equal(getRuntimePlugins().length, 1);
    registerRuntimePlugins(new Set(), []);
    assert.equal(getRuntimePlugins().length, 0);
  });
});
