import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, unlinkSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { __resetForTests as resetTokenState, generateAndWriteToken } from "../../server/api/auth/token.js";
import {
  buildCliArgs,
  buildDockerSpawnArgs,
  buildMulmoclaudeServer,
  dockerUserCapArgs,
  dockerBindMountArgs,
  buildMcpConfig,
  buildUserMessageLine,
  CONTAINER_WORKSPACE_PATH,
  type Platform,
  prepareUserServers,
  resolveMcpConfigPaths,
  resolveSystemPromptPaths,
  rewriteLocalhostForDocker,
  userServerAllowedToolNames,
  workspaceModuleMounts,
} from "../../server/agent/config.js";
import type { McpServerSpec } from "../../server/system/config.js";

describe("buildMcpConfig", () => {
  it("returns correct structure", async () => {
    const config = buildMcpConfig({
      chatSessionId: "s1",
      port: 3001,
      activePlugins: ["manageBookmarks", "presentDocument"],
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
    assert.equal(env.PLUGIN_NAMES, "manageBookmarks,presentDocument");
  });

  // Connect at session start instead of lazily, so a resumed turn doesn't race
  // the broker's cold boot. Inert without the raised connect ceiling — the two
  // only work as a pair (#2234).
  it("marks the mulmoclaude server alwaysLoad so a resumed turn doesn't race cold boot", async () => {
    const config = buildMcpConfig({ chatSessionId: "s1", port: 3001, activePlugins: [] }) as Record<string, unknown>;
    const servers = config.mcpServers as Record<string, unknown>;
    const server = servers.mulmoclaude as Record<string, unknown>;
    assert.equal(server.alwaysLoad, true);
    // Still a stdio spawn — alwaysLoad must not have displaced the type field,
    // whose absence makes the CLI skip the entry silently.
    assert.equal(server.type, "stdio");
  });

  it("handles empty plugins", async () => {
    const config = buildMcpConfig({
      chatSessionId: "s2",
      port: 4000,
      activePlugins: [],
    }) as Record<string, unknown>;

    const servers = config.mcpServers as Record<string, unknown>;
    const server = servers.mulmoclaude as Record<string, unknown>;
    const env = server.env as Record<string, string>;
    assert.equal(env.PLUGIN_NAMES, "");
  });

  function dockerServerEnv(): Record<string, string> {
    const config = buildMcpConfig({ chatSessionId: "s", port: 3001, activePlugins: [], useDocker: true }) as Record<string, unknown>;
    const server = (config.mcpServers as Record<string, unknown>).mulmoclaude as Record<string, unknown>;
    return server.env as Record<string, string>;
  }

  it("docker NODE_PATH includes the junction-free workspace-modules fallback root (#1946)", async () => {
    assert.equal(dockerServerEnv().NODE_PATH, "/app/node_modules:/app/pkg_modules");
  });

  it("native (non-docker) server carries no NODE_PATH", async () => {
    const config = buildMcpConfig({ chatSessionId: "s", port: 3001, activePlugins: [], useDocker: false }) as Record<string, unknown>;
    const server = (config.mcpServers as Record<string, unknown>).mulmoclaude as Record<string, unknown>;
    assert.equal((server.env as Record<string, string>).NODE_PATH, undefined);
  });

  it("docker server registers the ESM resolver hook via a bootstrap that calls register() (#1982)", async () => {
    const config = buildMcpConfig({ chatSessionId: "s", port: 3001, activePlugins: [], useDocker: true }) as Record<string, unknown>;
    const server = (config.mcpServers as Record<string, unknown>).mulmoclaude as Record<string, unknown>;
    const args = server.args as string[];
    const importIdx = args.indexOf("--import");
    assert.ok(importIdx !== -1, "--import flag must be present so the ESM loader hook is registered");
    // Points at the bootstrap — NOT the loader directly. `--import
    // <loader>` only evaluates the module's top level; a bootstrap
    // that calls `register()` is what actually wires the resolve
    // hook into Node's loader chain (Codex review).
    assert.equal(args[importIdx + 1], "file:///app/server/agent/mcp-esm-bootstrap.mjs");
    // The mcp-server script must still be the LAST arg so tsx treats it
    // as the entry point rather than a flag operand.
    assert.equal(args[args.length - 1], "/app/server/agent/mcp-server.ts");
  });

  it("native (non-docker) server does NOT include --import (loader hook is a Docker-only fix)", async () => {
    const config = buildMcpConfig({ chatSessionId: "s", port: 3001, activePlugins: [], useDocker: false }) as Record<string, unknown>;
    const server = (config.mcpServers as Record<string, unknown>).mulmoclaude as Record<string, unknown>;
    const args = server.args as string[];
    assert.ok(!args.includes("--import"), "--import must not leak into native mode where the loader isn't relevant");
  });
});

describe("buildCliArgs", () => {
  it("includes required flags", async () => {
    const args = buildCliArgs({
      systemPromptPath: "/tmp/system-prompt.md",
      activePlugins: [],
    });

    assert.ok(args.includes("--output-format"));
    assert.ok(args.includes("--input-format"));
    // stream-json is used for both input and output formats.
    assert.equal(args.filter((arg) => arg === "stream-json").length, 2, "stream-json should appear twice (input + output format)");
    assert.ok(args.includes("--verbose"));
    assert.ok(args.includes("--system-prompt-file"));
    assert.ok(args.includes("/tmp/system-prompt.md"));
    assert.ok(args.includes("-p"));
    assert.ok(args.includes("--allowedTools"));
  });

  it("passes the system prompt as a file path, never inline (#2078 Windows ENAMETOOLONG)", async () => {
    // Regression: an inline `--system-prompt <text>` puts the whole
    // prompt on the command line. On Windows CreateProcess caps the
    // command line at ~32k chars, so a workspace with a rich role +
    // plugins + memory pushed the prompt past the cap and every spawn
    // failed with ENAMETOOLONG before the CLI even started.
    const args = buildCliArgs({
      systemPromptPath: "/tmp/system-prompt.md",
      activePlugins: [],
    });
    const fileIdx = args.indexOf("--system-prompt-file");
    assert.ok(fileIdx >= 0, "must pass --system-prompt-file");
    assert.equal(args[fileIdx + 1], "/tmp/system-prompt.md");
    assert.ok(!args.includes("--system-prompt"), "inline --system-prompt must never be emitted (Windows ENAMETOOLONG)");
  });

  it("does NOT pass the user message as a CLI argument", async () => {
    // Regression: the message must arrive via stdin in stream-json
    // input mode. Passing it as `-p <text>` (the old mode) bypasses
    // slash-command resolution for Claude Code skills.
    const args = buildCliArgs({
      systemPromptPath: "/tmp/system-prompt.md",
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
      systemPromptPath: "/tmp/sp.md",
      activePlugins: ["manageBookmarks"],
    });

    const allowedIdx = args.indexOf("--allowedTools");
    assert.ok(allowedIdx >= 0, "--allowedTools flag must exist");
    const allowedStr = args[allowedIdx + 1];
    assert.equal(typeof allowedStr, "string");
    assert.ok(allowedStr.includes("mcp__mulmoclaude__manageBookmarks"));
    assert.ok(allowedStr.includes("Bash"));
  });

  it("permits the Skill tool so .claude/skills/ skills are invokable", async () => {
    // Regression guard: a strict --allowedTools that omits `Skill`
    // permission-denies every Skill({skill:"…"}) call (Execute skill
    // error + Glob fallback). See plans/done/fix-skill-tool-allowlist.md.
    const args = buildCliArgs({ systemPromptPath: "/tmp/sp.md", activePlugins: [] });
    const allowedStr = args[args.indexOf("--allowedTools") + 1];
    const tools = allowedStr.split(",");
    assert.ok(tools.includes("Skill"), `--allowedTools must list "Skill" (got: ${allowedStr})`);
  });

  it("includes --resume when claudeSessionId provided", async () => {
    const args = buildCliArgs({
      systemPromptPath: "/tmp/sp.md",
      activePlugins: [],
      claudeSessionId: "sess_123",
    });

    const resumeIdx = args.indexOf("--resume");
    assert.ok(resumeIdx >= 0);
    assert.equal(args[resumeIdx + 1], "sess_123");
  });

  it("omits --resume when no claudeSessionId", async () => {
    const args = buildCliArgs({
      systemPromptPath: "/tmp/sp.md",
      activePlugins: [],
    });

    assert.ok(!args.includes("--resume"));
  });

  it("includes --mcp-config when path provided", async () => {
    const args = buildCliArgs({
      systemPromptPath: "/tmp/sp.md",
      activePlugins: ["foo"],
      mcpConfigPath: "/tmp/mcp.json",
    });

    const mcpIdx = args.indexOf("--mcp-config");
    assert.ok(mcpIdx >= 0);
    assert.equal(args[mcpIdx + 1], "/tmp/mcp.json");
  });

  it("omits --mcp-config when no path", async () => {
    const args = buildCliArgs({
      systemPromptPath: "/tmp/sp.md",
      activePlugins: [],
    });

    assert.ok(!args.includes("--mcp-config"));
  });

  it("includes --permission-prompt-tool only when MCP is wired (#1499 / #1560)", async () => {
    // The handler tool lives inside our MCP server. With no
    // --mcp-config the CLI can't resolve it and refuses to start;
    // gate the flag together with --mcp-config.
    const withMcp = buildCliArgs({ systemPromptPath: "/tmp/sp.md", activePlugins: ["foo"], mcpConfigPath: "/tmp/mcp.json" });
    const withMcpIdx = withMcp.indexOf("--permission-prompt-tool");
    assert.ok(withMcpIdx >= 0, "must pass --permission-prompt-tool when MCP is configured");
    assert.equal(withMcp[withMcpIdx + 1], "mcp__mulmoclaude__handlePermission");

    const withoutMcp = buildCliArgs({ systemPromptPath: "/tmp/sp.md", activePlugins: [] });
    assert.ok(!withoutMcp.includes("--permission-prompt-tool"), "must NOT pass --permission-prompt-tool in no-MCP sessions");
  });

  it("includes --effort when effortLevel is set", async () => {
    const args = buildCliArgs({
      systemPromptPath: "/tmp/sp.md",
      activePlugins: [],
      effortLevel: "high",
    });

    const effortIdx = args.indexOf("--effort");
    assert.ok(effortIdx >= 0, "--effort flag must exist");
    assert.equal(args[effortIdx + 1], "high");
  });

  it("omits --effort when effortLevel is unset", async () => {
    const args = buildCliArgs({
      systemPromptPath: "/tmp/sp.md",
      activePlugins: [],
    });

    assert.ok(!args.includes("--effort"));
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
    assert.equal(paths.argPath, `${CONTAINER_WORKSPACE_PATH}/.mulmoclaude/mcp-abc.json`);
  });

  it("docker hostPath and argPath differ", async () => {
    const paths = resolveMcpConfigPaths({
      workspacePath: "/ws",
      sessionId: "s",
      useDocker: true,
    });
    assert.notEqual(paths.hostPath, paths.argPath);
  });

  it("sanitizes path-injecting sessionId (CodeQL js/path-injection)", async () => {
    const evil = "../../etc/pwn";
    for (const useDocker of [true, false]) {
      const paths = resolveMcpConfigPaths({ workspacePath: "/ws", sessionId: evil, useDocker });
      // basename collapses the traversal to "pwn"; nothing of the
      // crafted prefix survives into either derived path.
      for (const derivedPath of [paths.hostPath, paths.argPath]) {
        assert.ok(!derivedPath.includes(".."), `traversal leaked into ${derivedPath}`);
        assert.ok(!derivedPath.includes("etc"), `path component leaked into ${derivedPath}`);
        assert.ok(derivedPath.includes("mcp-pwn.json"), `expected sanitized segment, got ${derivedPath}`);
      }
    }
  });
});

describe("resolveSystemPromptPaths", () => {
  it("uses tmpdir for native runs (no docker)", async () => {
    const paths = resolveSystemPromptPaths({
      workspacePath: "/ws",
      sessionId: "abc",
      useDocker: false,
    });
    assert.equal(paths.hostPath, join(tmpdir(), "mulmoclaude-system-prompt-abc.md"));
    assert.equal(paths.argPath, paths.hostPath);
  });

  it("uses workspace .mulmoclaude dir for docker runs so the container can read it", async () => {
    const paths = resolveSystemPromptPaths({
      workspacePath: "/ws",
      sessionId: "abc",
      useDocker: true,
    });
    assert.equal(paths.hostPath, join("/ws", ".mulmoclaude", "system-prompt-abc.md"));
    assert.equal(paths.argPath, `${CONTAINER_WORKSPACE_PATH}/.mulmoclaude/system-prompt-abc.md`);
  });

  it("docker hostPath and argPath differ", async () => {
    const paths = resolveSystemPromptPaths({
      workspacePath: "/ws",
      sessionId: "s",
      useDocker: true,
    });
    assert.notEqual(paths.hostPath, paths.argPath);
  });

  it("sanitizes path-injecting sessionId (CodeQL js/path-injection)", async () => {
    const evil = "../../etc/pwn";
    for (const useDocker of [true, false]) {
      const paths = resolveSystemPromptPaths({ workspacePath: "/ws", sessionId: evil, useDocker });
      // basename collapses the traversal to "pwn"; nothing of the
      // crafted prefix survives into either derived path.
      for (const derivedPath of [paths.hostPath, paths.argPath]) {
        assert.ok(!derivedPath.includes(".."), `traversal leaked into ${derivedPath}`);
        assert.ok(!derivedPath.includes("etc"), `path component leaked into ${derivedPath}`);
        assert.ok(derivedPath.includes("system-prompt-pwn.md"), `expected sanitized segment, got ${derivedPath}`);
      }
    }
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
      // In dev (which this test fixture mirrors) packageRoot equals
      // projectRoot — both are the repo root. The distinction only
      // matters in npx packaged installs (#1770 Docker-side gap):
      // there packageRoot=<consumer>/node_modules/mulmoclaude/ while
      // projectRoot=<consumer>/. The dedicated "packageRoot in npx
      // layout" test below covers that case.
      packageRoot: "/proj",
      homeDir: "/home/user",
      chatSessionId: "chat-test-session",
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

  // The CLI runs INSIDE the container, so only vars listed in this argv reach
  // it — a host-side MCP_CONNECT_TIMEOUT_MS never arrived, leaving the knob
  // unreachable in the one environment that needs it (#2234).
  it("passes the MCP connect-wait ceiling into the container", async () => {
    const args = buildDockerSpawnArgs(baseParams());
    const value = args.find((arg) => arg.startsWith("MCP_CONNECT_TIMEOUT_MS="));
    assert.ok(value, `expected an MCP_CONNECT_TIMEOUT_MS -e arg, got: ${args.join(" ")}`);
    const timeoutMs = Number(value.split("=")[1]);
    assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0, `expected a positive ms value, got: ${value}`);
    // Must clear the CLI's ~5s default, which is the whole point.
    assert.ok(timeoutMs >= 30_000, `ceiling must comfortably exceed the CLI default, got ${timeoutMs}ms`);
    assert.equal(args[args.indexOf(value) - 1], "-e", "value must be preceded by its -e flag");
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

  // Regression for the Docker-side gap in #1770 (@ystknsh's manual
  // smoke caught this). In packaged installs npm hoists deps to
  // <consumer>/node_modules/ while the mulmoclaude package itself
  // lives at <consumer>/node_modules/mulmoclaude/ — `node_modules`
  // mount stays on projectRoot but `server`/`src` MUST come from
  // packageRoot or the container ends up with an empty /app/server
  // and the broker fails to spawn.
  it("uses packageRoot for server/src mounts when it differs from projectRoot (npx layout)", async () => {
    const args = buildDockerSpawnArgs({
      ...baseParams(),
      projectRoot: "/consumer",
      packageRoot: "/consumer/node_modules/mulmoclaude",
    });
    // node_modules: hoisted next to consumer's package.json
    assert.ok(args.includes("/consumer/node_modules:/app/node_modules:ro"));
    // server + src: inside the mulmoclaude package directory
    assert.ok(args.includes("/consumer/node_modules/mulmoclaude/server:/app/server:ro"));
    assert.ok(args.includes("/consumer/node_modules/mulmoclaude/src:/app/src:ro"));
    // Old (broken) shape must NOT appear
    assert.ok(!args.includes("/consumer/server:/app/server:ro"));
    assert.ok(!args.includes("/consumer/src:/app/src:ro"));
  });

  it("skips the /app/packages mount when packageRoot has no `packages/` dir (npx published shape)", async () => {
    // The published mulmoclaude package's `files` whitelist excludes
    // `packages/` — internal @mulmoclaude/* workspaces are installed
    // as `node_modules/@mulmoclaude/*` after publish. Use a packageRoot
    // pointing at a dir that genuinely has no `packages/` subdir so
    // the existsSync gate fires.
    const args = buildDockerSpawnArgs({
      ...baseParams(),
      projectRoot: "/consumer",
      packageRoot: "/consumer/node_modules/mulmoclaude",
    });
    // No mount line referring to /app/packages should appear.
    assert.ok(!args.some((token) => token.includes(":/app/packages:")));
  });

  // #1946: Windows yarn-workspace junctions dangle inside the Linux
  // container, so on win32 source builds each @mulmoclaude/* package is
  // also bind-mounted at a junction-free /app/pkg_modules/@mulmoclaude/<name>
  // that NODE_PATH falls through to.
  function seedWorkspacePackages(root: string): void {
    mkdirSync(join(root, "packages", "core"), { recursive: true });
    writeFileSync(join(root, "packages", "core", "package.json"), JSON.stringify({ name: "@mulmoclaude/core" }));
    mkdirSync(join(root, "packages", "plugins", "x-plugin"), { recursive: true });
    writeFileSync(join(root, "packages", "plugins", "x-plugin", "package.json"), JSON.stringify({ name: "@mulmoclaude/x-plugin" }));
    // A non-@mulmoclaude leaf lib in the same tree must NOT be mounted.
    mkdirSync(join(root, "packages", "plugins", "leaf-lib"), { recursive: true });
    writeFileSync(join(root, "packages", "plugins", "leaf-lib", "package.json"), JSON.stringify({ name: "some-leaf" }));
  }

  it("win32 source build mounts each @mulmoclaude/* at /app/pkg_modules, skipping non-scoped packages (#1946)", async () => {
    const root = mkdtempSync(join(tmpdir(), "mc-pkgroot-"));
    try {
      seedWorkspacePackages(root);
      const args = buildDockerSpawnArgs({ ...baseParams(), platform: "win32" as Platform, packageRoot: root });
      const toDocker = (hostPath: string): string => hostPath.replace(/\\/g, "/");
      assert.ok(args.includes(`${toDocker(join(root, "packages", "core"))}:/app/pkg_modules/@mulmoclaude/core:ro`));
      assert.ok(args.includes(`${toDocker(join(root, "packages", "plugins", "x-plugin"))}:/app/pkg_modules/@mulmoclaude/x-plugin:ro`));
      assert.ok(!args.some((token) => token.includes("/app/pkg_modules/some-leaf")));
      assert.ok(!args.some((token) => token.includes("leaf-lib:/app/pkg_modules")));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does NOT add /app/pkg_modules mounts on non-Windows platforms", async () => {
    const root = mkdtempSync(join(tmpdir(), "mc-pkgroot-"));
    try {
      seedWorkspacePackages(root);
      const args = buildDockerSpawnArgs({ ...baseParams(), platform: "darwin" as Platform, packageRoot: root });
      assert.ok(!args.some((token) => token.includes(":/app/pkg_modules/")));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("win32 npx install (no packages/ dir) adds no /app/pkg_modules mounts", async () => {
    const root = mkdtempSync(join(tmpdir(), "mc-pkgroot-"));
    try {
      const args = buildDockerSpawnArgs({ ...baseParams(), platform: "win32" as Platform, packageRoot: root });
      assert.ok(!args.some((token) => token.includes(":/app/pkg_modules/")));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // #2056: npx can nest deps in `<packageRoot>/node_modules` instead of
  // hoisting them to `<projectRoot>/node_modules` (version conflict, or a
  // half-deduped npx cache). Only projectRoot's node_modules is mounted to
  // /app/node_modules, so those nested deps are invisible and the broker dies
  // at load. Mount the nested tree onto /app/pkg_modules (on NODE_PATH + the
  // ESM hook path). Platform-agnostic — the npx nesting happens on macOS too.
  it("mounts nested packageRoot/node_modules at /app/pkg_modules in the npx layout (#2056)", async () => {
    const root = mkdtempSync(join(tmpdir(), "mc-npxroot-"));
    try {
      mkdirSync(join(root, "node_modules", "@mulmoclaude", "chart-plugin"), { recursive: true });
      const args = buildDockerSpawnArgs({ ...baseParams(), projectRoot: "/consumer", packageRoot: root });
      const toDocker = (hostPath: string): string => hostPath.replace(/\\/g, "/");
      assert.ok(args.includes(`${toDocker(join(root, "node_modules"))}:/app/pkg_modules:ro`));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("adds no nested-node_modules mount in the dev layout where packageRoot === projectRoot (#2056)", async () => {
    const root = mkdtempSync(join(tmpdir(), "mc-devroot-"));
    try {
      mkdirSync(join(root, "node_modules", "express"), { recursive: true });
      const args = buildDockerSpawnArgs({ ...baseParams(), projectRoot: root, packageRoot: root });
      assert.ok(!args.some((token) => token.endsWith(":/app/pkg_modules:ro")));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // The nested-tree mount (whole dir at /app/pkg_modules) and the per-package
  // mounts (/app/pkg_modules/@scope/name) would collide — a child bind mount
  // into a read-only parent fails `docker run`. They must stay exclusive. An
  // install-from-source / `npm link` on Windows has BOTH a `packages/` tree AND
  // a distinct packageRoot with a nested node_modules; the per-package mounts
  // own /app/pkg_modules there, so the whole-tree mount must NOT be added.
  it("skips the nested mount when a packages/ tree is present, avoiding a /app/pkg_modules collision (#2056)", async () => {
    const root = mkdtempSync(join(tmpdir(), "mc-srcinstall-"));
    try {
      seedWorkspacePackages(root); // creates packages/…
      mkdirSync(join(root, "node_modules", "@mulmoclaude", "chart-plugin"), { recursive: true });
      const args = buildDockerSpawnArgs({ ...baseParams(), platform: "win32" as Platform, projectRoot: "/consumer", packageRoot: root });
      // Per-package mounts present (workspaceModuleMounts owns /app/pkg_modules)…
      assert.ok(args.some((token) => token.includes("/app/pkg_modules/@mulmoclaude/core:ro")));
      // …and the whole-tree nested mount is NOT added (no collision).
      assert.ok(!args.some((token) => token.endsWith(":/app/pkg_modules:ro")));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // The package bin script (`npx mulmoclaude` / `node packages/mulmoclaude/bin/...`)
  // sets cwd to the package dir, where yarn-workspace dev installs leave an
  // empty `node_modules/`. If the default falls back to `process.cwd()` the
  // sandbox's `/app/node_modules` mount is empty and every MCP child crashes
  // with "Cannot find module 'express'" — silently, before the `initialize`
  // handshake. The default must instead resolve through an installed dep so
  // it lands on the populated `node_modules/`.
  it("default projectRoot resolves to a populated node_modules even when cwd is a yarn-workspace package", async () => {
    const original = process.cwd();
    const packageDir = join(original, "packages/mulmoclaude");
    if (!existsSync(packageDir)) return; // not a workspace checkout — skip
    try {
      process.chdir(packageDir);
      const args = buildDockerSpawnArgs({
        workspacePath: "/ws",
        cliArgs: [],
        uid: 1000,
        gid: 1000,
        platform: "darwin" as Platform,
        chatSessionId: "test",
      });
      const nmMount = args.find((arg) => typeof arg === "string" && arg.endsWith(":/app/node_modules:ro"));
      assert.ok(nmMount, "expected a node_modules mount");
      const hostPath = nmMount.replace(":/app/node_modules:ro", "");
      assert.ok(existsSync(join(hostPath, "express")), `node_modules mount must point to a populated dir (got ${hostPath})`);
    } finally {
      process.chdir(original);
    }
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

  it("forwards MULMOCLAUDE_CHAT_SESSION_ID into the container for the wiki-history hook (#963)", async () => {
    const args = buildDockerSpawnArgs({ ...baseParams(), chatSessionId: "chat-abc-123" });
    // -e flag arg pairs: `["-e", "KEY=value", ...]`
    const envIdx = args.findIndex((arg, idx) => arg === "-e" && args[idx + 1] === "MULMOCLAUDE_CHAT_SESSION_ID=chat-abc-123");
    assert.ok(envIdx >= 0, "expected MULMOCLAUDE_CHAT_SESSION_ID to be forwarded");
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
      args.some((arg) => arg.startsWith("C:/Users/me/ws:")),
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
    assert.ok(!args.some((arg) => arg.includes(".config/gh")));
    assert.ok(!args.some((arg) => arg.includes("SSH_AUTH_SOCK")));
  });
});

describe("rewriteLocalhostForDocker", () => {
  it("leaves urls untouched when docker mode is off", async () => {
    assert.equal(rewriteLocalhostForDocker("http://localhost:9000/foo", false), "http://localhost:9000/foo");
  });

  it("rewrites localhost and 127.0.0.1 under docker", async () => {
    assert.equal(rewriteLocalhostForDocker("http://localhost:9000", true), "http://host.docker.internal:9000");
    assert.equal(rewriteLocalhostForDocker("https://127.0.0.1:443/mcp", true), "https://host.docker.internal:443/mcp");
  });

  it("leaves non-loopback urls alone", async () => {
    assert.equal(rewriteLocalhostForDocker("https://example.com/mcp", true), "https://example.com/mcp");
  });

  it("does not match mid-url substrings", async () => {
    // `localhost.example.com` must not trigger; the boundary check is
    // critical so we don't break legitimate domains.
    assert.equal(rewriteLocalhostForDocker("https://localhost.example.com", true), "https://localhost.example.com");
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
    const { servers: out } = await prepareUserServers(servers, false, hostWs);
    assert.deepEqual(Object.keys(out), ["on"]);
  });

  it("rewrites localhost for http servers in docker mode", async () => {
    const servers: Record<string, McpServerSpec> = {
      api: { type: "http", url: "http://localhost:8080/mcp" },
    };
    const { servers: out } = await prepareUserServers(servers, true, hostWs);
    const { api } = out;
    assert.ok(api && api.type === "http");
    assert.equal(api.url, "http://host.docker.internal:8080/mcp");
  });

  it("rewrites workspace-scoped args for stdio servers when NOT in docker mode", async () => {
    // Outside the sandbox, stdio entries pass through with their
    // workspace-scoped args normalised. (Docker-mode drops stdio
    // entirely — see the next test.)
    const servers: Record<string, McpServerSpec> = {
      fs: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", `${hostWs}/docs`],
      },
    };
    const { servers: out } = await prepareUserServers(servers, false, hostWs);
    const fsSpec = out.fs;
    assert.ok(fsSpec && fsSpec.type === "stdio");
    // Non-docker mode doesn't rewrite the workspace prefix — the
    // host path is the right path.
    assert.deepEqual(fsSpec.args, ["-y", "@modelcontextprotocol/server-filesystem", `${hostWs}/docs`]);
  });

  it("drops stdio servers entirely in docker mode (#1334)", async () => {
    // Symmetric with `userServerAllowedToolNames`: stdio entries
    // can't run inside the sandbox image, and Claude CLI 2.1.x
    // silently exits 1 when a stdio MCP fails to spawn. Drop them
    // before writing the per-session MCP config so the CLI never
    // tries. See docs/mcp-sandbox.md for the full rationale.
    const servers: Record<string, McpServerSpec> = {
      api: { type: "http", url: "https://api.example/mcp" },
      fs: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", `${hostWs}/docs`],
      },
      mem: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-memory"],
      },
    };
    const { servers: out } = await prepareUserServers(servers, true, hostWs);
    assert.deepEqual(Object.keys(out), ["api"]);
  });

  it("docker-mode drop applies even when no http entries are present", async () => {
    // Boundary: a config with ONLY stdio entries yields an empty
    // server map under docker. Nothing should crash, no entries
    // should leak through.
    const servers: Record<string, McpServerSpec> = {
      fs: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem"],
      },
    };
    const { servers: out } = await prepareUserServers(servers, true, hostWs);
    assert.deepEqual(out, {});
  });

  it("stdio with hostExecInDocker !== true is still dropped in docker (safe default unchanged, #1421 Phase B)", async () => {
    // The opt-in escape hatch must be explicit. An entry without
    // the flag — or with it explicitly false — keeps the pre-#1421
    // behavior: dropped under Docker, no host process spawned.
    const servers: Record<string, McpServerSpec> = {
      api: { type: "http", url: "https://api.example/mcp" },
      memOff: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-memory"],
        hostExecInDocker: false,
      },
      memUnset: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-memory"],
      },
    };
    const { servers: out, shims } = await prepareUserServers(servers, true, hostWs);
    assert.deepEqual(Object.keys(out), ["api"], "only the http server survives; both stdio entries dropped");
    assert.equal(shims.length, 0, "no host-exec shim spawned without an explicit opt-in");
  });

  it("disabled stdio entries are dropped before the docker filter even sees them", async () => {
    // The disabled-check fires first, so a disabled stdio entry
    // never reaches the docker filter. Verify both modes agree
    // for disabled entries.
    const servers: Record<string, McpServerSpec> = {
      off: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-memory"],
        enabled: false,
      },
    };
    assert.deepEqual((await prepareUserServers(servers, false, hostWs)).servers, {});
    assert.deepEqual((await prepareUserServers(servers, true, hostWs)).servers, {});
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
    const { servers: prepared } = await prepareUserServers(servers, false, hostWs);
    assert.deepEqual(userServerAllowedToolNames(prepared, false), ["mcp__gmail"]);
  });

  it("emits mcp__<id> for stdio servers when not in docker mode", async () => {
    const servers: Record<string, McpServerSpec> = {
      fs: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", hostWs],
      },
    };
    const { servers: prepared } = await prepareUserServers(servers, false, hostWs);
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
    const { servers: prepared } = await prepareUserServers(servers, true, hostWs);
    assert.deepEqual(userServerAllowedToolNames(prepared, true), ["mcp__gmail"]);
  });
});

describe("buildMcpConfig — user servers", () => {
  it("merges user-defined servers alongside mulmoclaude", async () => {
    const cfg = buildMcpConfig({
      chatSessionId: "s1",
      port: 3001,
      activePlugins: ["manageBookmarks"],
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
      activePlugins: ["manageBookmarks"],
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
    const line = await buildUserMessageLine("what is this?", [{ mimeType: "image/png", data: "iVBORw0KGgo=" }]);
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
    const line = await buildUserMessageLine("read this", [{ mimeType: "application/pdf", data: "JVBERi0x" }]);
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
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
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
      systemPromptPath: "/tmp/sp.md",
      activePlugins: [],
      extraAllowedTools: ["mcp__claude_ai_Gmail", "mcp__claude_ai_Google_Calendar"],
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
    }) as Record<string, unknown>;

    const servers = config.mcpServers as Record<string, unknown>;
    const server = servers.mulmoclaude as Record<string, unknown>;
    const env = server.env as Record<string, string>;
    assert.equal(env.MULMOCLAUDE_AUTH_TOKEN, undefined);
  });
});

describe("dockerUserCapArgs", () => {
  it("runs the container as the host user (zero caps) when SSH forward is off", () => {
    assert.deepEqual(dockerUserCapArgs(false, 501, 20), ["--user", "501:20"]);
  });

  it("adds the 5 minimum caps + HOST_UID/GID (no --user) when SSH forward is on", () => {
    const args = dockerUserCapArgs(true, 501, 20);
    assert.ok(!args.includes("--user"), "must not also pass --user");
    for (const cap of ["CHOWN", "FOWNER", "DAC_OVERRIDE", "SETUID", "SETGID"]) {
      assert.ok(args.includes(cap), `missing cap ${cap}`);
    }
    assert.ok(args.includes("HOST_UID=501"));
    assert.ok(args.includes("HOST_GID=20"));
  });
});

describe("dockerBindMountArgs", () => {
  const opts = {
    projectRoot: "/proj",
    packageRoot: "/pkg",
    workspacePath: "/ws",
    homeDir: "/home/u",
    packagesMount: ["-v", "/pkg/packages:/app/packages:ro"],
    platform: "linux" as Platform,
  };

  it("mounts node_modules from projectRoot and server/src from packageRoot, read-only", () => {
    const args = dockerBindMountArgs(opts);
    assert.ok(args.includes("/proj/node_modules:/app/node_modules:ro"));
    assert.ok(args.includes("/pkg/server:/app/server:ro"));
    assert.ok(args.includes("/pkg/src:/app/src:ro"));
  });

  it("splices in the caller's packagesMount and mounts the workspace + .claude config", () => {
    const args = dockerBindMountArgs(opts);
    assert.ok(args.includes("/pkg/packages:/app/packages:ro"), "packagesMount not spliced in");
    assert.ok(
      args.some((arg) => arg.startsWith("/ws:")),
      "workspace mount missing",
    );
    assert.ok(args.some((arg) => arg.endsWith(":/home/node/.claude")));
    assert.ok(args.some((arg) => arg.endsWith(":/home/node/.claude.json")));
  });

  it("converts Windows backslash host paths to forward slashes for -v", () => {
    const args = dockerBindMountArgs({ ...opts, projectRoot: "C:\\Users\\me\\proj" });
    assert.ok(args.includes("C:/Users/me/proj/node_modules:/app/node_modules:ro"));
  });
});

// #2052: `test/agent/test_mcp_docker_smoke.ts` used to hardcode its `docker run`
// argv, so PR #1974 (the /app/pkg_modules fallback) and PR #1995 (the --import
// bootstrap) shipped without the smoke test ever seeing them. It kept
// reproducing the pre-#1974 layout, and a Windows user re-reported the old
// error as proof the fixes hadn't landed. The smoke test now derives its argv
// from the shipped builders; these assertions pin that wiring on every PR,
// where the Docker-dependent smoke test cannot run.
describe("MCP child wiring (regression guard for #2052)", () => {
  const REPO_ROOT = join(import.meta.dirname, "../..");
  const identity = (hostPath: string): string => hostPath;

  it("gives the Docker child the /app/pkg_modules fallback on NODE_PATH", () => {
    const spec = buildMulmoclaudeServer({ chatSessionId: "s", port: 1, activePlugins: [], useDocker: true });
    assert.equal(spec.env.NODE_PATH, "/app/node_modules:/app/pkg_modules");
  });

  it("registers the ESM resolver bootstrap via --import on the Docker child", () => {
    const spec = buildMulmoclaudeServer({ chatSessionId: "s", port: 1, activePlugins: [], useDocker: true });
    assert.equal(spec.command, "tsx");
    assert.deepEqual(spec.args.slice(0, 2), ["--import", "file:///app/server/agent/mcp-esm-bootstrap.mjs"]);
    assert.equal(spec.args.at(-1), "/app/server/agent/mcp-server.ts");
  });

  it("leaves the native child alone: no NODE_PATH, no --import", () => {
    const spec = buildMulmoclaudeServer({ chatSessionId: "s", port: 1, activePlugins: [], useDocker: false });
    assert.equal(spec.env.NODE_PATH, undefined);
    assert.equal(spec.args.includes("--import"), false);
  });

  it("mounts every workspace package under /app/pkg_modules on win32 only", () => {
    const win = workspaceModuleMounts(REPO_ROOT, "win32", identity);
    assert.ok(
      win.some((arg) => arg.endsWith(":/app/pkg_modules/@mulmoclaude/x-plugin:ro")),
      `x-plugin fallback mount missing from: ${win.join(" ")}`,
    );
    assert.ok(
      win.some((arg) => arg.endsWith(":/app/pkg_modules/@mulmoclaude/core:ro")),
      `core fallback mount missing from: ${win.join(" ")}`,
    );
    assert.deepEqual(workspaceModuleMounts(REPO_ROOT, "linux", identity), []);
  });

  // The actual #2052 production bug: the fallback only covered `@mulmoclaude/*`,
  // but yarn junctions EVERY workspace package. `@mulmobridge/protocol` (reached
  // via src/types/events.ts) and `@mulmobridge/client` dangled inside the Linux
  // container on a Windows host, so the MCP child died at load with
  // MODULE_NOT_FOUND and every tool — `handlePermission` included — disappeared.
  it("covers non-@mulmoclaude workspace scopes the MCP child imports", () => {
    const win = workspaceModuleMounts(REPO_ROOT, "win32", identity);
    for (const pkg of ["@mulmobridge/protocol", "@mulmobridge/client"]) {
      assert.ok(
        win.some((arg) => arg.endsWith(`:/app/pkg_modules/${pkg}:ro`)),
        `${pkg} fallback mount missing — the MCP child cannot load without it`,
      );
    }
  });

  it("skips the unscoped launcher package", () => {
    const win = workspaceModuleMounts(REPO_ROOT, "win32", identity);
    assert.ok(!win.some((arg) => arg.endsWith(":/app/pkg_modules/mulmoclaude:ro")));
  });
});
