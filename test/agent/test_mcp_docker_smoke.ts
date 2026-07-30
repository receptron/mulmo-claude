// Container-runtime smoke test for the MCP server subprocess.
//
// Verifies that the MCP server can start inside the sandbox
// container and respond to initialize + tools/list. This catches:
//   - Missing Docker volume mounts (e.g. packages/ not mounted)
//   - package.json exports issues (e.g. missing "require" condition)
//   - Module resolution failures in the container's Node.js version
//
// The container command, args and env come from the SHIPPED
// `buildMulmoclaudeServer()`, and the junction-fallback mounts from the
// SHIPPED `workspaceModuleMounts()`. Do not hand-copy them here again.
// This file used to hardcode both, so it silently kept reproducing the
// pre-#1974 layout: no `/app/pkg_modules` mounts, `NODE_PATH` without
// the fallback root, and no `--import` bootstrap. Two fixes shipped that
// the smoke test could not see, and a Windows user re-reported the old
// error as if nothing had changed (#2052). A test that cannot see the
// fix cannot verify the fix.
//
// NOT run in CI (Docker unavailable). Run locally after:
//   - Adding/changing workspace package exports
//   - Modifying Docker volume mounts in server/agent/config.ts
//   - Upgrading Node.js version in the sandbox Dockerfile
//
// Usage: npx tsx --test test/agent/test_mcp_docker_smoke.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";

import { buildMulmoclaudeServer, workspaceModuleMounts, type Platform } from "../../server/agent/config.ts";
import { ONE_SECOND_MS } from "../../server/utils/time.ts";
import { detectLiveSandboxRuntime, sandboxRuntimeCommand, type SandboxRuntime } from "../../server/system/docker.ts";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../..");

function isSandboxImageAvailable(runtime: SandboxRuntime): boolean {
  try {
    execFileSync(sandboxRuntimeCommand(runtime), ["image", "inspect", "mulmoclaude-sandbox"], {
      stdio: "ignore",
      timeout: 5 * ONE_SECOND_MS,
    });
    return true;
  } catch {
    return false;
  }
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: {
    serverInfo?: { name: string };
    tools?: { name: string }[];
  };
}

const ACTIVE_PLUGINS = ["manageSkills", "presentMulmoScript"];

// `process.platform` is NodeJS.Platform; the repo's `Platform` union lists the
// same members. Narrow through the union rather than casting.
function hostPlatform(): Platform {
  const platforms: Platform[] = ["aix", "android", "darwin", "freebsd", "haiku", "linux", "openbsd", "sunos", "win32", "cygwin", "netbsd"];
  const found = platforms.find((candidate) => candidate === process.platform);
  if (!found) throw new Error(`unrecognised platform: ${process.platform}`);
  return found;
}

const sandboxRuntime = await detectLiveSandboxRuntime();
const canRunContainer = sandboxRuntime !== null && isSandboxImageAvailable(sandboxRuntime);

describe("MCP server container smoke test", { skip: !canRunContainer }, () => {
  it("responds to initialize + tools/list inside the sandbox container", async () => {
    assert.ok(sandboxRuntime);
    const toDockerPath = (filePath: string): string => filePath.replace(/\\/g, "/");

    // The exact spec Claude Code would spawn: `tsx --import <bootstrap>
    // /app/server/agent/mcp-server.ts` with NODE_PATH carrying the
    // `/app/pkg_modules` fallback root.
    const server = buildMulmoclaudeServer({
      chatSessionId: "docker-smoke-test",
      port: 9999,
      activePlugins: ACTIVE_PLUGINS,
      useDocker: true,
    });

    const dockerArgs = [
      "run",
      "--rm",
      "-i",
      "-v",
      `${toDockerPath(PROJECT_ROOT)}/node_modules:/app/node_modules:ro`,
      "-v",
      `${toDockerPath(PROJECT_ROOT)}/packages:/app/packages:ro`,
      "-v",
      `${toDockerPath(PROJECT_ROOT)}/server:/app/server:ro`,
      "-v",
      `${toDockerPath(PROJECT_ROOT)}/src:/app/src:ro`,
      // Windows-only junction fallback (#1974). Empty elsewhere.
      ...workspaceModuleMounts(PROJECT_ROOT, hostPlatform(), toDockerPath),
      ...Object.entries(server.env).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
      "mulmoclaude-sandbox",
      server.command,
      ...server.args,
    ];

    const responses = await new Promise<JsonRpcResponse[]>((resolve, reject) => {
      const child = spawn(sandboxRuntimeCommand(sandboxRuntime), dockerArgs, {
        cwd: PROJECT_ROOT,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      const lines = [
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "docker-test", version: "0.0.0" },
          },
        }),
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {},
        }),
      ];

      for (const line of lines) {
        child.stdin.write(`${line}\n`);
      }
      child.stdin.end();

      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`${sandboxRuntime} MCP server timed out. stderr: ${stderr}`));
      }, 30 * ONE_SECOND_MS);

      child.on("close", (code) => {
        clearTimeout(timer);
        const parsed: JsonRpcResponse[] = stdout
          .split("\n")
          .filter((line) => line.trim())
          .map((line) => {
            try {
              return JSON.parse(line) as JsonRpcResponse;
            } catch {
              return null;
            }
          })
          .filter((resp): resp is JsonRpcResponse => resp !== null);

        if (parsed.length === 0 && code !== 0) {
          reject(new Error(`${sandboxRuntime} MCP server exited ${code}. stderr:\n${stderr.slice(0, 1000)}`));
          return;
        }
        resolve(parsed);
      });
    });

    const initResp = responses.find((resp) => resp.id === 1);
    assert.ok(initResp?.result, "Missing initialize response");
    assert.equal(initResp.result.serverInfo?.name, "mulmoclaude");

    const toolsResp = responses.find((resp) => resp.id === 2);
    assert.ok(toolsResp?.result?.tools, "Missing tools/list response");

    const toolNames = toolsResp.result.tools.map((tool) => tool.name);
    assert.ok(toolNames.includes("presentMulmoScript"), `presentMulmoScript not in tools: ${toolNames.join(", ")}`);
    assert.ok(toolNames.includes("manageSkills"), `manageSkills not in tools: ${toolNames.join(", ")}`);
  });
});
