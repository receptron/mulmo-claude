import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  __resetForTests as resetTokenState,
  generateAndWriteToken,
} from "../../server/api/auth/token.js";
import {
  buildCliArgs,
  buildDockerSpawnArgs,
  buildMcpConfig,
  buildUserMessageLine,
  CONTAINER_WORKSPACE_PATH,
  type Platform,
  prepareUserServers,
  resolveMcpConfigPaths,
  rewriteLocalhostForDocker,
  userServerAllowedToolNames,
} from "../../server/agent/config.js";
import type { McpServerSpec } from "../../server/system/config.js";

describe("buildMcpConfig", () => {
  it("returns correct structure", async () => {
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

  it("handles empty plugins and roles", async () => {
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
  it("includes required flags", async () => {
    const args = buildCliArgs({
      systemPrompt: "You are helpful",
      activePlugins: [],
    });

    assert.ok(args.includes("--output-format"));
    assert.ok(args.includes("--input-format"));
    // stream-json is used for both input and output formats.
    assert.equal(
      args.filter((a) => a === "stream-json").length,
      2,
      "stream-json should appear twice (input + output format)",
    );
    assert.ok(args.includes("--verbose"));
    assert.ok(args.includes("--system-prompt"));
    assert.ok(args.includes("You are helpful"));
    assert.ok(args.includes("-p"));
    assert.ok(args.includes("--allowedTools"));
  });

  it("does NOT pass the user message as a CLI argument", async () => {
    // Regression: the message must arrive via stdin in stream-json
    // input mode. Passing it as `-p <text>` (the old mode) bypasses
    // slash-command resolution for Claude Code skills.
    const args = buildCliArgs({
      systemPrompt: "You are helpful",
      activePlugins: [],
    });
    const pIdx = args.indexOf("-p");
    // `-p` is followed by either another flag or end-of-args, never
    // by a plain text message.
    const afterP = args[pIdx + 1];
    assert.ok(afterP === undefined || afterP.startsWith("--"));
  });

  it("includes MCP tool names in allowedTools", async () => {
    const args = buildCliArgs({
      systemPrompt: "test",
      activePlugins: ["manageTodoList"],
    });

    const allowedIdx = args.indexOf("--allowedTools");
    assert.ok(allowedIdx >= 0, "--allowedTools flag must exist");
    const allowedStr = args[allowedIdx + 1];
    assert.equal(typeof allowedStr, "string");
    assert.ok(allowedStr.includes("mcp__mulmoclaude__manageTodoList"));
    assert.ok(allowedStr.includes("Bash"));
  });

  it("includes --resume when claudeSessionId provided", async () => {
    const args = buildCliArgs({
      systemPrompt: "test",
      activePlugins: [],
      claudeSessionId: "sess_123",
    });

    const resumeIdx = args.indexOf("--resume");
    assert.ok(resumeIdx >= 0);
    assert.equal(args[resumeIdx + 1], "sess_123");
  });

  it("omits --resume when no claudeSessionId", async () => {
    const args = buildCliArgs({
      systemPrompt: "test",
      activePlugins: [],
    });

    assert.ok(!args.includes("--resume"));
  });

  it("includes --mcp-config when path provided", async () => {
    const args = buildCliArgs({
      systemPrompt: "test",
      activePlugins: ["foo"],
      mcpConfigPath: "/tmp/mcp.json",
    });

    const mcpIdx = args.indexOf("--mcp-config");
    assert.ok(mcpIdx >= 0);
    assert.equal(args[mcpIdx + 1], "/tmp/mcp.json");
  });

  it("omits --mcp-config when no path", async () => {
    const args = buildCliArgs({
      systemPrompt: "test",
      activePlugins: [],
    });

    assert.ok(!args.includes("--mcp-config"));
  });
});

describe("resolveMcpConfigPaths", () => {
  it("uses tmpdir for native runs (no docker)", async () => {
    const paths = resolveMcpConfigPaths({
      workspacePath: "/ws",
      sessionId: "abc",
      useDocker: false,
    });
    assert.equal(paths.hostPath, join(tmpdir(), "mulmoclaude-mcp-abc.json"));
    assert.equal(paths.argPath, paths.hostPath);
  });

  it("uses workspace .mulmoclaude dir for docker runs", async () => {
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

  it("docker hostPath and argPath differ", async () => {
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

  it("starts with `run --rm` and ends with `claude` plus the cli args", async () => {
    const args = buildDockerSpawnArgs(baseParams());
    assert.equal(args[0], "run");
    assert.equal(args[1], "--rm");
    const claudeIdx = args.indexOf("claude");
    assert.ok(claudeIdx > 0);
    assert.equal(args[claudeIdx + 1], "-p");
    assert.equal(args[claudeIdx + 2], "hi");
  });

  it("drops all capabilities", async () => {
    const args = buildDockerSpawnArgs(baseParams());
    const idx = args.indexOf("--cap-drop");
    assert.ok(idx >= 0);
    assert.equal(args[idx + 1], "ALL");
  });

  it("uses --user when SSH agent forward is off (default)", async () => {
    const args = buildDockerSpawnArgs({ ...baseParams(), uid: 501, gid: 20 });
    const idx = args.indexOf("--user");
    assert.ok(idx >= 0);
    assert.equal(args[idx + 1], "501:20");
    assert.ok(!args.includes("HOST_UID=501"));
    assert.ok(!args.includes("CHOWN"));
  });

  it("uses HOST_UID/HOST_GID + cap-adds when SSH agent forward is on", async () => {
    const args = buildDockerSpawnArgs({
      ...baseParams(),
      uid: 501,
      gid: 20,
      sshAgentForward: true,
    });
    assert.equal(args.indexOf("--user"), -1);
    assert.ok(args.includes("HOST_UID=501"));
    assert.ok(args.includes("HOST_GID=20"));
    assert.ok(args.includes("CHOWN"));
    assert.ok(args.includes("SETUID"));
  });

  it("mounts the workspace at the container path", async () => {
    const args = buildDockerSpawnArgs(baseParams());
    assert.ok(args.includes(`/ws:${CONTAINER_WORKSPACE_PATH}`));
  });

  it("mounts node_modules / server / src read-only from the project root", async () => {
    const args = buildDockerSpawnArgs(baseParams());
    assert.ok(args.includes("/proj/node_modules:/app/node_modules:ro"));
    assert.ok(args.includes("/proj/server:/app/server:ro"));
    assert.ok(args.includes("/proj/src:/app/src:ro"));
  });

  it("mounts the .claude credentials from the home dir", async () => {
    const args = buildDockerSpawnArgs(baseParams());
    assert.ok(args.includes("/home/user/.claude:/home/node/.claude"));
    assert.ok(args.includes("/home/user/.claude.json:/home/node/.claude.json"));
  });

  it("adds host.docker.internal mapping on linux", async () => {
    const args = buildDockerSpawnArgs({
      ...baseParams(),
      platform: "linux" as Platform,
    });
    const idx = args.indexOf("--add-host");
    assert.ok(idx >= 0);
    assert.equal(args[idx + 1], "host.docker.internal:host-gateway");
  });

  it("does not add host mapping on darwin", async () => {
    const args = buildDockerSpawnArgs({
      ...baseParams(),
      platform: "darwin" as Platform,
    });
    assert.ok(!args.includes("--add-host"));
  });

  it("normalizes Windows backslash paths to forward slashes", async () => {
    const args = buildDockerSpawnArgs({
      ...baseParams(),
      workspacePath: "C:\\Users\\me\\ws",
    });
    assert.ok(
      args.some((a) => a.startsWith("C:/Users/me/ws:")),
      "expected forward-slash conversion",
    );
  });

  it("targets the mulmoclaude-sandbox image", async () => {
    const args = buildDockerSpawnArgs(baseParams());
    assert.ok(args.includes("mulmoclaude-sandbox"));
  });

  it("splices sandboxAuthArgs in before the image name (#259)", async () => {
    const args = buildDockerSpawnArgs({
      ...baseParams(),
      sandboxAuthArgs: ["-v", "/host/.config/gh:/home/node/.config/gh:ro"],
    });
    const authIdx = args.indexOf("/host/.config/gh:/home/node/.config/gh:ro");
    const imageIdx = args.indexOf("mulmoclaude-sandbox");
    assert.ok(authIdx >= 0, "expected sandboxAuthArgs to be present");
    assert.ok(authIdx < imageIdx, "auth mounts must land before image name");
  });

  it("defaults to no sandbox auth args when omitted", async () => {
    const args = buildDockerSpawnArgs(baseParams());
    assert.ok(!args.some((a) => a.includes(".config/gh")));
    assert.ok(!args.some((a) => a.includes("SSH_AUTH_SOCK")));
  });
});

describe("rewriteLocalhostForDocker", () => {
  it("leaves urls untouched when docker mode is off", async () => {
    assert.equal(
      rewriteLocalhostForDocker("http://localhost:9000/foo", false),
      "http://localhost:9000/foo",
    );
  });

  it("rewrites localhost and 127.0.0.1 under docker", async () => {
    assert.equal(
      rewriteLocalhostForDocker("http://localhost:9000", true),
      "http://host.docker.internal:9000",
    );
    assert.equal(
      rewriteLocalhostForDocker("https://127.0.0.1:443/mcp", true),
      "https://host.docker.internal:443/mcp",
    );
  });

  it("leaves non-loopback urls alone", async () => {
    assert.equal(
      rewriteLocalhostForDocker("https://example.com/mcp", true),
      "https://example.com/mcp",
    );
  });

  it("does not match mid-url substrings", async () => {
    // `localhost.example.com` must not trigger; the boundary check is
    // critical so we don't break legitimate domains.
    assert.equal(
      rewriteLocalhostForDocker("https://localhost.example.com", true),
      "https://localhost.example.com",
    );
  });
});

describe("prepareUserServers", () => {
  const hostWs = "/Users/me/ws";

  it("drops disabled entries", async () => {
    const servers: Record<string, McpServerSpec> = {
      on: { type: "http", url: "https://a.example/mcp" },
      off: {
        type: "http",
        url: "https://b.example/mcp",
        enabled: false,
      },
    };
    const out = prepareUserServers(servers, false, hostWs);
    assert.deepEqual(Object.keys(out), ["on"]);
  });

  it("rewrites localhost for http servers in docker mode", async () => {
    const servers: Record<string, McpServerSpec> = {
      api: { type: "http", url: "http://localhost:8080/mcp" },
    };
    const out = prepareUserServers(servers, true, hostWs);
    const api = out.api;
    assert.ok(api && api.type === "http");
    assert.equal(api.url, "http://host.docker.internal:8080/mcp");
  });

  it("rewrites workspace-scoped args for stdio servers in docker mode", async () => {
    const servers: Record<string, McpServerSpec> = {
      fs: {
        type: "stdio",
        command: "npx",
        args: [
          "-y",
          "@modelcontextprotocol/server-filesystem",
          `${hostWs}/docs`,
        ],
      },
    };
    const out = prepareUserServers(servers, true, hostWs);
    const fs = out.fs;
    assert.ok(fs && fs.type === "stdio");
    assert.deepEqual(fs.args, [
      "-y",
      "@modelcontextprotocol/server-filesystem",
      `${CONTAINER_WORKSPACE_PATH}/docs`,
    ]);
  });

  it("leaves non-workspace stdio args untouched (caller warns in UI)", async () => {
    const servers: Record<string, McpServerSpec> = {
      bad: {
        type: "stdio",
        command: "node",
        args: ["/etc/hosts"],
      },
    };
    const out = prepareUserServers(servers, true, hostWs);
    const bad = out.bad;
    assert.ok(bad && bad.type === "stdio");
    assert.deepEqual(bad.args, ["/etc/hosts"]);
  });
});

describe("userServerAllowedToolNames", () => {
  const hostWs = "/Users/me/ws";

  it("emits mcp__<id> wildcards for enabled http servers", async () => {
    const servers: Record<string, McpServerSpec> = {
      gmail: { type: "http", url: "https://gmail.mcp.claude.com/mcp" },
      disabled: {
        type: "http",
        url: "https://x",
        enabled: false,
      },
    };
    const prepared = prepareUserServers(servers, false, hostWs);
    assert.deepEqual(userServerAllowedToolNames(prepared, false), [
      "mcp__gmail",
    ]);
  });

  it("emits mcp__<id> for stdio servers when not in docker mode", async () => {
    const servers: Record<string, McpServerSpec> = {
      fs: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", hostWs],
      },
    };
    const prepared = prepareUserServers(servers, false, hostWs);
    assert.deepEqual(userServerAllowedToolNames(prepared, false), ["mcp__fs"]);
  });

  it("drops stdio servers in docker mode (sandbox image is minimal)", async () => {
    const servers: Record<string, McpServerSpec> = {
      gmail: { type: "http", url: "https://gmail.mcp.claude.com/mcp" },
      fs: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", hostWs],
      },
    };
    const prepared = prepareUserServers(servers, true, hostWs);
    assert.deepEqual(userServerAllowedToolNames(prepared, true), [
      "mcp__gmail",
    ]);
  });
});

describe("buildMcpConfig — user servers", () => {
  it("merges user-defined servers alongside mulmoclaude", async () => {
    const cfg = buildMcpConfig({
      chatSessionId: "s1",
      port: 3001,
      activePlugins: ["manageTodoList"],
      roleIds: ["assistant"],
      userServers: {
        gmail: {
          type: "http",
          url: "https://gmail.mcp.claude.com/mcp",
        },
      },
    }) as Record<string, unknown>;
    const servers = cfg.mcpServers as Record<string, unknown>;
    assert.ok(servers.mulmoclaude);
    assert.ok(servers.gmail);
  });

  it("refuses to let a user server override the reserved 'mulmoclaude' id", async () => {
    const cfg = buildMcpConfig({
      chatSessionId: "s1",
      port: 3001,
      activePlugins: ["manageTodoList"],
      roleIds: ["assistant"],
      userServers: {
        mulmoclaude: {
          type: "http",
          url: "https://evil.example/mcp",
        },
      },
    }) as Record<string, unknown>;
    const servers = cfg.mcpServers as Record<string, unknown>;
    const builtIn = servers.mulmoclaude as { command?: string; url?: string };
    // The internal bridge always wins — we keep the `command` shape,
    // never the user-provided `url`.
    assert.ok(typeof builtIn.command === "string");
    assert.equal(builtIn.url, undefined);
  });
});

describe("buildUserMessageLine", () => {
  it("produces a newline-terminated JSON object with role user", async () => {
    const line = await buildUserMessageLine("hello");
    assert.ok(line.endsWith("\n"));
    const parsed = JSON.parse(line.trimEnd());
    assert.deepEqual(parsed, {
      type: "user",
      message: { role: "user", content: "hello" },
    });
  });

  it("escapes special characters in the message content", async () => {
    const line = await buildUserMessageLine('line1\n"quoted"\tX');
    const parsed = JSON.parse(line.trimEnd());
    assert.equal(parsed.message.content, 'line1\n"quoted"\tX');
  });

  it("preserves slash-command invocations verbatim", async () => {
    // This is why the whole stream-json input path exists — slash
    // commands must reach Claude untouched so they resolve against
    // ~/.claude/skills/<name>/SKILL.md.
    const line = await buildUserMessageLine("/shiritori");
    const parsed = JSON.parse(line.trimEnd());
    assert.equal(parsed.message.content, "/shiritori");
  });

  it("sends plain string content when no attachments", async () => {
    const line = await buildUserMessageLine("describe this");
    const parsed = JSON.parse(line.trimEnd());
    assert.equal(typeof parsed.message.content, "string");
  });

  it("sends content blocks when image attachments are provided", async () => {
    const line = await buildUserMessageLine("what is this?", [
      { mimeType: "image/png", data: "iVBORw0KGgo=" },
    ]);
    const parsed = JSON.parse(line.trimEnd());
    assert.ok(Array.isArray(parsed.message.content));
    const blocks = parsed.message.content;
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].type, "image");
    assert.equal(blocks[0].source.type, "base64");
    assert.equal(blocks[0].source.media_type, "image/png");
    assert.equal(blocks[0].source.data, "iVBORw0KGgo=");
    assert.equal(blocks[1].type, "text");
    assert.equal(blocks[1].text, "what is this?");
  });

  it("supports multiple image attachments", async () => {
    const line = await buildUserMessageLine("compare these", [
      { mimeType: "image/png", data: "AAA" },
      { mimeType: "image/jpeg", data: "BBB" },
    ]);
    const parsed = JSON.parse(line.trimEnd());
    const blocks = parsed.message.content;
    assert.equal(blocks.length, 3);
    assert.equal(blocks[0].source.media_type, "image/png");
    assert.equal(blocks[1].source.media_type, "image/jpeg");
    assert.equal(blocks[2].type, "text");
  });

  it("falls back to plain string for empty attachments array", async () => {
    const line = await buildUserMessageLine("hello", []);
    const parsed = JSON.parse(line.trimEnd());
    assert.equal(typeof parsed.message.content, "string");
  });

  it("falls back to plain string when attachments is undefined", async () => {
    const line = await buildUserMessageLine("hello", undefined);
    const parsed = JSON.parse(line.trimEnd());
    assert.equal(typeof parsed.message.content, "string");
  });

  it("sends PDF as a document content block", async () => {
    const line = await buildUserMessageLine("read this", [
      { mimeType: "application/pdf", data: "JVBERi0x" },
    ]);
    const parsed = JSON.parse(line.trimEnd());
    const blocks = parsed.message.content;
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].type, "document");
    assert.equal(blocks[0].source.media_type, "application/pdf");
    assert.equal(blocks[0].source.data, "JVBERi0x");
    assert.equal(blocks[1].type, "text");
    assert.equal(blocks[1].text, "read this");
  });

  it("includes image and PDF attachments, skips unsupported types", async () => {
    const line = await buildUserMessageLine("analyze", [
      { mimeType: "image/jpeg", data: "/9j/4AAQ" },
      { mimeType: "application/pdf", data: "JVBERi0x" },
      {
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        data: "UEs=",
      },
    ]);
    const parsed = JSON.parse(line.trimEnd());
    const blocks = parsed.message.content;
    // image + document (PDF) + text; docx skipped
    assert.equal(blocks.length, 3);
    assert.equal(blocks[0].type, "image");
    assert.equal(blocks[0].source.media_type, "image/jpeg");
    assert.equal(blocks[1].type, "document");
    assert.equal(blocks[1].source.media_type, "application/pdf");
    assert.equal(blocks[2].type, "text");
  });
});

describe("buildCliArgs — extraAllowedTools", () => {
  it("merges extraAllowedTools into --allowedTools", async () => {
    const args = buildCliArgs({
      systemPrompt: "s",
      activePlugins: [],
      extraAllowedTools: [
        "mcp__claude_ai_Gmail",
        "mcp__claude_ai_Google_Calendar",
      ],
    });
    const idx = args.indexOf("--allowedTools");
    const list = args[idx + 1];
    assert.ok(list.includes("mcp__claude_ai_Gmail"));
    assert.ok(list.includes("mcp__claude_ai_Google_Calendar"));
  });
});

// ── Bearer token propagation to MCP subprocess (#325) ─────────

describe("buildMcpConfig — bearer token env (#325)", () => {
  let tmpTokenPath: string;

  afterEach(() => {
    resetTokenState();
    try {
      unlinkSync(tmpTokenPath);
    } catch {
      /* cleanup */
    }
  });

  it("passes MULMOCLAUDE_AUTH_TOKEN to the MCP server env when a token exists", async () => {
    tmpTokenPath = join(tmpdir(), `mulmo-tok-test-${Date.now()}`);
    const token = await generateAndWriteToken(tmpTokenPath);
    const config = buildMcpConfig({
      chatSessionId: "s1",
      port: 3001,
      activePlugins: [],
      roleIds: [],
    }) as Record<string, unknown>;

    const servers = config.mcpServers as Record<string, unknown>;
    const server = servers.mulmoclaude as Record<string, unknown>;
    const env = server.env as Record<string, string>;
    assert.equal(env.MULMOCLAUDE_AUTH_TOKEN, token);
  });

  it("omits MULMOCLAUDE_AUTH_TOKEN when no token is configured", async () => {
    // resetTokenState ensures getCurrentToken() returns null
    const config = buildMcpConfig({
      chatSessionId: "s1",
      port: 3001,
      activePlugins: [],
      roleIds: [],
    }) as Record<string, unknown>;

    const servers = config.mcpServers as Record<string, unknown>;
    const server = servers.mulmoclaude as Record<string, unknown>;
    const env = server.env as Record<string, string>;
    assert.equal(env.MULMOCLAUDE_AUTH_TOKEN, undefined);
  });
});
