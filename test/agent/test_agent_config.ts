import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildMcpConfig, buildCliArgs } from "../../server/agent/config.js";

describe("buildMcpConfig", () => {
  it("returns correct structure", () => {
    const config = buildMcpConfig({
      sessionId: "s1",
      port: 3001,
      activePlugins: ["manageTodoList", "presentDocument"],
      roleIds: ["assistant", "cook"],
    }) as Record<string, unknown>;

    assert.ok(config.mcpServers);
    const servers = config.mcpServers as Record<string, unknown>;
    assert.ok(servers.mulmoclaude);

    const server = servers.mulmoclaude as Record<string, unknown>;
    assert.ok(typeof server.command === "string");
    assert.ok(Array.isArray(server.args));

    const env = server.env as Record<string, string>;
    assert.equal(env.SESSION_ID, "s1");
    assert.equal(env.PORT, "3001");
    assert.equal(env.PLUGIN_NAMES, "manageTodoList,presentDocument");
    assert.equal(env.ROLE_IDS, "assistant,cook");
  });

  it("handles empty plugins and roles", () => {
    const config = buildMcpConfig({
      sessionId: "s2",
      port: 4000,
      activePlugins: [],
      roleIds: [],
    }) as Record<string, unknown>;

    const servers = config.mcpServers as Record<string, unknown>;
    const server = servers.mulmoclaude as Record<string, unknown>;
    const env = server.env as Record<string, string>;
    assert.equal(env.PLUGIN_NAMES, "");
    assert.equal(env.ROLE_IDS, "");
  });
});

describe("buildCliArgs", () => {
  it("includes required flags", () => {
    const args = buildCliArgs({
      systemPrompt: "You are helpful",
      activePlugins: [],
      message: "hello",
    });

    assert.ok(args.includes("--output-format"));
    assert.ok(args.includes("stream-json"));
    assert.ok(args.includes("--verbose"));
    assert.ok(args.includes("--system-prompt"));
    assert.ok(args.includes("You are helpful"));
    assert.ok(args.includes("-p"));
    assert.ok(args.includes("hello"));
    assert.ok(args.includes("--allowedTools"));
  });

  it("includes MCP tool names in allowedTools", () => {
    const args = buildCliArgs({
      systemPrompt: "test",
      activePlugins: ["manageTodoList"],
      message: "hi",
    });

    const allowedIdx = args.indexOf("--allowedTools");
    const allowedStr = args[allowedIdx + 1];
    assert.ok(allowedStr.includes("mcp__mulmoclaude__manageTodoList"));
    assert.ok(allowedStr.includes("Bash"));
  });

  it("includes --resume when claudeSessionId provided", () => {
    const args = buildCliArgs({
      systemPrompt: "test",
      activePlugins: [],
      message: "hi",
      claudeSessionId: "sess_123",
    });

    const resumeIdx = args.indexOf("--resume");
    assert.ok(resumeIdx >= 0);
    assert.equal(args[resumeIdx + 1], "sess_123");
  });

  it("omits --resume when no claudeSessionId", () => {
    const args = buildCliArgs({
      systemPrompt: "test",
      activePlugins: [],
      message: "hi",
    });

    assert.ok(!args.includes("--resume"));
  });

  it("includes --mcp-config when path provided", () => {
    const args = buildCliArgs({
      systemPrompt: "test",
      activePlugins: ["foo"],
      message: "hi",
      mcpConfigPath: "/tmp/mcp.json",
    });

    const mcpIdx = args.indexOf("--mcp-config");
    assert.ok(mcpIdx >= 0);
    assert.equal(args[mcpIdx + 1], "/tmp/mcp.json");
  });

  it("omits --mcp-config when no path", () => {
    const args = buildCliArgs({
      systemPrompt: "test",
      activePlugins: [],
      message: "hi",
    });

    assert.ok(!args.includes("--mcp-config"));
  });
});
