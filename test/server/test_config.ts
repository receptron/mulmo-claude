import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

// The config module reads workspacePath at the time of each call,
// so we swap HOME to a temp dir BEFORE importing it. Inline dynamic
// import keeps the module under test pinned to this suite's HOME.
let tmpRoot: string;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;

type ConfigModule = typeof import("../../server/system/config.js");
let mod: ConfigModule;

before(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), "mulmo-config-test-"));
  originalHome = process.env.HOME;
  originalUserProfile = process.env.USERPROFILE;
  // homedir() uses HOME on POSIX and USERPROFILE on Windows; set both
  // so the test's temp workspace is picked up regardless of platform.
  process.env.HOME = tmpRoot;
  process.env.USERPROFILE = tmpRoot;
  // Pre-create the workspace root that workspace.ts expects.
  mkdirSync(path.join(tmpRoot, "mulmoclaude"), { recursive: true });
  mod = await import("../../server/system/config.js");
});

after(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  await rm(tmpRoot, { recursive: true, force: true });
});

describe("isAppSettings", () => {
  it("accepts a well-formed settings object", () => {
    assert.ok(
      mod.isAppSettings({
        extraAllowedTools: ["mcp__claude_ai_Gmail"],
      }),
    );
    assert.ok(mod.isAppSettings({ extraAllowedTools: [] }));
  });

  it("rejects non-objects", () => {
    assert.equal(mod.isAppSettings(null), false);
    assert.equal(mod.isAppSettings(undefined), false);
    assert.equal(mod.isAppSettings("hello"), false);
    assert.equal(mod.isAppSettings(42), false);
    assert.equal(mod.isAppSettings([]), false);
  });

  it("rejects missing or non-array extraAllowedTools", () => {
    assert.equal(mod.isAppSettings({}), false);
    assert.equal(mod.isAppSettings({ extraAllowedTools: "nope" }), false);
    assert.equal(mod.isAppSettings({ extraAllowedTools: null }), false);
  });

  it("rejects arrays containing non-strings", () => {
    assert.equal(mod.isAppSettings({ extraAllowedTools: ["ok", 42] }), false);
    assert.equal(mod.isAppSettings({ extraAllowedTools: [null] }), false);
  });
});

describe("loadSettings", () => {
  afterEach(() => {
    // Always start each test with a clean configs dir.
    rmSync(mod.configsDir(), { recursive: true, force: true });
  });

  it("returns defaults when the file is missing", () => {
    const cfg = mod.loadSettings();
    assert.deepEqual(cfg, { extraAllowedTools: [] });
  });

  it("reads a well-formed file", () => {
    mod.saveSettings({ extraAllowedTools: ["a", "b"] });
    assert.deepEqual(mod.loadSettings(), { extraAllowedTools: ["a", "b"] });
  });

  it("returns defaults and warns on malformed JSON", () => {
    mod.ensureConfigsDir();
    writeFileSync(mod.settingsPath(), "not json");
    const cfg = mod.loadSettings();
    assert.deepEqual(cfg, { extraAllowedTools: [] });
  });

  it("returns defaults when shape does not match", () => {
    mod.ensureConfigsDir();
    writeFileSync(mod.settingsPath(), JSON.stringify({ extraAllowedTools: [1, 2, 3] }));
    assert.deepEqual(mod.loadSettings(), { extraAllowedTools: [] });
  });

  it("returns a defensive copy — mutating the result does not affect disk", () => {
    mod.saveSettings({ extraAllowedTools: ["x"] });
    const first = mod.loadSettings();
    first.extraAllowedTools.push("y");
    const second = mod.loadSettings();
    assert.deepEqual(second.extraAllowedTools, ["x"]);
  });
});

describe("isMcpServerSpec", () => {
  it("accepts valid http specs", () => {
    assert.ok(mod.isMcpServerSpec({ type: "http", url: "https://example.com/mcp" }));
    assert.ok(
      mod.isMcpServerSpec({
        type: "http",
        url: "http://localhost:9000",
        headers: { Authorization: "Bearer x" },
        enabled: false,
      }),
    );
  });

  it("rejects http specs with a missing or empty url", () => {
    assert.equal(mod.isMcpServerSpec({ type: "http", url: "" }), false);
    assert.equal(mod.isMcpServerSpec({ type: "http" }), false);
  });

  it("accepts stdio specs using the command allowlist", () => {
    assert.ok(mod.isMcpServerSpec({ type: "stdio", command: "npx", args: ["-y"] }));
    assert.ok(mod.isMcpServerSpec({ type: "stdio", command: "node" }));
    assert.ok(mod.isMcpServerSpec({ type: "stdio", command: "tsx" }));
  });

  it("rejects stdio specs with a disallowed command", () => {
    assert.equal(mod.isMcpServerSpec({ type: "stdio", command: "bash" }), false);
    assert.equal(mod.isMcpServerSpec({ type: "stdio", command: "python3" }), false);
    assert.equal(mod.isMcpServerSpec({ type: "stdio", command: "/usr/bin/node" }), false);
  });

  it("rejects stdio specs with non-string args or env values", () => {
    assert.equal(
      mod.isMcpServerSpec({
        type: "stdio",
        command: "npx",
        args: [1, 2],
      }),
      false,
    );
    assert.equal(
      mod.isMcpServerSpec({
        type: "stdio",
        command: "npx",
        env: { K: 42 },
      }),
      false,
    );
  });

  it("rejects unknown type", () => {
    assert.equal(mod.isMcpServerSpec({ type: "unix", path: "/x" }), false);
  });
});

describe("isMcpServerId", () => {
  it("accepts slug-shaped ids", () => {
    assert.ok(mod.isMcpServerId("gmail"));
    assert.ok(mod.isMcpServerId("my-server"));
    assert.ok(mod.isMcpServerId("a1_b2-c3"));
  });

  it("rejects ids starting with non-letter or containing uppercase", () => {
    assert.equal(mod.isMcpServerId(""), false);
    assert.equal(mod.isMcpServerId("1foo"), false);
    assert.equal(mod.isMcpServerId("-foo"), false);
    assert.equal(mod.isMcpServerId("Foo"), false);
    assert.equal(mod.isMcpServerId("has space"), false);
  });
});

describe("loadMcpConfig / saveMcpConfig", () => {
  beforeEach(() => {
    rmSync(mod.configsDir(), { recursive: true, force: true });
  });

  it("returns empty mcpServers when missing", () => {
    assert.deepEqual(mod.loadMcpConfig(), { mcpServers: {} });
  });

  it("round-trips a typical config file", () => {
    const cfg: import("../../server/system/config.js").McpConfigFile = {
      mcpServers: {
        gmail: {
          type: "http",
          url: "https://gmail.mcp.claude.com/mcp",
          enabled: true,
        },
        files: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem"],
        },
      },
    };
    mod.saveMcpConfig(cfg);
    assert.deepEqual(mod.loadMcpConfig(), cfg);
  });

  it("returns defaults on malformed JSON", () => {
    mod.ensureConfigsDir();
    writeFileSync(mod.mcpConfigPath(), "{broken");
    assert.deepEqual(mod.loadMcpConfig(), { mcpServers: {} });
  });

  it("returns defaults when schema does not match", () => {
    mod.ensureConfigsDir();
    writeFileSync(mod.mcpConfigPath(), JSON.stringify({ mcpServers: { BAD: { type: "http", url: "x" } } }));
    assert.deepEqual(mod.loadMcpConfig(), { mcpServers: {} });
  });

  it("saveMcpConfig rejects malformed input without touching disk", () => {
    assert.throws(() =>
      mod.saveMcpConfig({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mcpServers: { ok: { type: "nope" } as any },
      }),
    );
    assert.equal(existsSync(mod.mcpConfigPath()), false);
  });
});

describe("toMcpEntries / fromMcpEntries", () => {
  it("flattens and re-inflates without loss", () => {
    const cfg: import("../../server/system/config.js").McpConfigFile = {
      mcpServers: {
        a: { type: "http", url: "https://a.example/mcp" },
        b: { type: "http", url: "https://b.example/mcp" },
      },
    };
    const entries = mod.toMcpEntries(cfg);
    assert.equal(entries.length, 2);
    const restored = mod.fromMcpEntries(entries);
    assert.deepEqual(restored, cfg);
  });

  it("throws on duplicate ids", () => {
    assert.throws(() =>
      mod.fromMcpEntries([
        { id: "dup", spec: { type: "http", url: "https://x" } },
        { id: "dup", spec: { type: "http", url: "https://y" } },
      ]),
    );
  });

  it("throws on invalid id shape", () => {
    assert.throws(() => mod.fromMcpEntries([{ id: "BAD", spec: { type: "http", url: "https://x" } }]));
  });
});

describe("saveSettings", () => {
  beforeEach(() => {
    rmSync(mod.configsDir(), { recursive: true, force: true });
  });

  it("creates config/ if missing and writes JSON", () => {
    mod.saveSettings({ extraAllowedTools: ["mcp__claude_ai_Gmail"] });
    const raw = readFileSync(mod.settingsPath(), "utf-8");
    assert.deepEqual(JSON.parse(raw), {
      extraAllowedTools: ["mcp__claude_ai_Gmail"],
    });
  });

  it("writes trailing newline and restrictive permissions", () => {
    mod.saveSettings({ extraAllowedTools: [] });
    const raw = readFileSync(mod.settingsPath(), "utf-8");
    assert.ok(raw.endsWith("\n"));
    if (process.platform !== "win32") {
      const stat = statSync(mod.settingsPath());
      // Low 9 bits = owner/group/other perms; expect 0o600.
      assert.equal(stat.mode & 0o777, 0o600);
    }
  });

  it("rejects invalid shapes", () => {
    assert.throws(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mod.saveSettings({ extraAllowedTools: 42 } as any);
    });
  });

  it("replaces existing file atomically (no .tmp leftover)", () => {
    mod.saveSettings({ extraAllowedTools: ["first"] });
    mod.saveSettings({ extraAllowedTools: ["second"] });
    const entries = readdirSync(mod.configsDir());
    const leftover = entries.filter((entry) => entry.endsWith(".tmp"));
    assert.deepEqual(leftover, []);
    assert.deepEqual(mod.loadSettings(), { extraAllowedTools: ["second"] });
  });
});
