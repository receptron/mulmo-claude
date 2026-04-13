import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildCliArgs,
  buildDockerSpawnArgs,
  buildMcpConfig,
  CONTAINER_WORKSPACE_PATH,
  type Platform,
  resolveMcpConfigPaths,
} from "../../server/agent/config.js";

describe("buildMcpConfig", () => {
  it("returns correct structure", () => {
    const config = buildMcpConfig({
      chatSessionId: "s1",
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
      chatSessionId: "s2",
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
    assert.ok(allowedIdx >= 0, "--allowedTools flag must exist");
    const allowedStr = args[allowedIdx + 1];
    assert.equal(typeof allowedStr, "string");
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

describe("resolveMcpConfigPaths", () => {
  it("uses tmpdir for native runs (no docker)", () => {
    const paths = resolveMcpConfigPaths({
      workspacePath: "/ws",
      sessionId: "abc",
      useDocker: false,
    });
    assert.equal(paths.hostPath, join(tmpdir(), "mulmoclaude-mcp-abc.json"));
    assert.equal(paths.argPath, paths.hostPath);
  });

  it("uses workspace .mulmoclaude dir for docker runs", () => {
    const paths = resolveMcpConfigPaths({
      workspacePath: "/ws",
      sessionId: "abc",
      useDocker: true,
    });
    assert.equal(paths.hostPath, join("/ws", ".mulmoclaude", "mcp-abc.json"));
    assert.equal(
      paths.argPath,
      `${CONTAINER_WORKSPACE_PATH}/.mulmoclaude/mcp-abc.json`,
    );
  });

  it("docker hostPath and argPath differ", () => {
    const paths = resolveMcpConfigPaths({
      workspacePath: "/ws",
      sessionId: "s",
      useDocker: true,
    });
    assert.notEqual(paths.hostPath, paths.argPath);
  });
});

describe("buildDockerSpawnArgs", () => {
  function baseParams() {
    return {
      workspacePath: "/ws",
      cliArgs: ["-p", "hi"],
      uid: 1000,
      gid: 1000,
      platform: "darwin" as Platform,
      projectRoot: "/proj",
      homeDir: "/home/user",
    };
  }

  it("starts with `run --rm` and ends with `claude` plus the cli args", () => {
    const args = buildDockerSpawnArgs(baseParams());
    assert.equal(args[0], "run");
    assert.equal(args[1], "--rm");
    const claudeIdx = args.indexOf("claude");
    assert.ok(claudeIdx > 0);
    assert.equal(args[claudeIdx + 1], "-p");
    assert.equal(args[claudeIdx + 2], "hi");
  });

  it("drops all capabilities", () => {
    const args = buildDockerSpawnArgs(baseParams());
    const idx = args.indexOf("--cap-drop");
    assert.ok(idx >= 0);
    assert.equal(args[idx + 1], "ALL");
  });

  it("passes uid:gid via --user", () => {
    const args = buildDockerSpawnArgs({ ...baseParams(), uid: 501, gid: 20 });
    const idx = args.indexOf("--user");
    assert.equal(args[idx + 1], "501:20");
  });

  it("mounts the workspace at the container path", () => {
    const args = buildDockerSpawnArgs(baseParams());
    assert.ok(args.includes(`/ws:${CONTAINER_WORKSPACE_PATH}`));
  });

  it("mounts node_modules / server / src read-only from the project root", () => {
    const args = buildDockerSpawnArgs(baseParams());
    assert.ok(args.includes("/proj/node_modules:/app/node_modules:ro"));
    assert.ok(args.includes("/proj/server:/app/server:ro"));
    assert.ok(args.includes("/proj/src:/app/src:ro"));
  });

  it("mounts the .claude credentials from the home dir", () => {
    const args = buildDockerSpawnArgs(baseParams());
    assert.ok(args.includes("/home/user/.claude:/home/node/.claude"));
    assert.ok(args.includes("/home/user/.claude.json:/home/node/.claude.json"));
  });

  it("adds host.docker.internal mapping on linux", () => {
    const args = buildDockerSpawnArgs({
      ...baseParams(),
      platform: "linux" as Platform,
    });
    const idx = args.indexOf("--add-host");
    assert.ok(idx >= 0);
    assert.equal(args[idx + 1], "host.docker.internal:host-gateway");
  });

  it("does not add host mapping on darwin", () => {
    const args = buildDockerSpawnArgs({
      ...baseParams(),
      platform: "darwin" as Platform,
    });
    assert.ok(!args.includes("--add-host"));
  });

  it("normalizes Windows backslash paths to forward slashes", () => {
    const args = buildDockerSpawnArgs({
      ...baseParams(),
      workspacePath: "C:\\Users\\me\\ws",
    });
    assert.ok(
      args.some((a) => a.startsWith("C:/Users/me/ws:")),
      "expected forward-slash conversion",
    );
  });

  it("targets the mulmoclaude-sandbox image", () => {
    const args = buildDockerSpawnArgs(baseParams());
    assert.ok(args.includes("mulmoclaude-sandbox"));
  });
});
