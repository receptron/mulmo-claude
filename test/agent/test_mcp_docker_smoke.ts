// Docker smoke test for the MCP server subprocess.
//
// Verifies that the MCP server can start inside the Docker sandbox
// container and respond to initialize + tools/list. This catches:
//   - Missing Docker volume mounts (e.g. packages/ not mounted)
//   - package.json exports issues (e.g. missing "require" condition)
//   - Module resolution failures in the container's Node.js version
//
// NOT run in CI (Docker unavailable). Run locally after:
//   - Adding/changing workspace package exports
//   - Modifying Docker volume mounts in server/agent/config.ts
//   - Upgrading Node.js version in the sandbox Dockerfile
//
// Usage: npx tsx --test test/agent/test_mcp_docker_smoke.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execSync, spawn } from "node:child_process";
import path from "node:path";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../..");

function isDockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function isSandboxImageAvailable(): boolean {
  try {
    const out = execSync("docker images -q mulmoclaude-sandbox", {
      encoding: "utf-8",
      timeout: 5000,
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: {
    serverInfo?: { name: string };
    tools?: Array<{ name: string }>;
  };
}

const canRunDocker = isDockerAvailable() && isSandboxImageAvailable();

describe("MCP server Docker smoke test", { skip: !canRunDocker }, () => {
  it("responds to initialize + tools/list inside Docker container", async () => {
    const toDockerPath = (p: string): string => p.replace(/\\/g, "/");

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
      "-e",
      "NODE_PATH=/app/node_modules",
      "-e",
      "SESSION_ID=docker-smoke-test",
      "-e",
      "PORT=9999",
      "-e",
      "PLUGIN_NAMES=manageTodoList,presentMulmoScript,manageWiki,switchRole",
      "-e",
      "ROLE_IDS=general",
      "mulmoclaude-sandbox",
      "tsx",
      "/app/server/agent/mcp-server.ts",
    ];

    const responses = await new Promise<JsonRpcResponse[]>((resolve, reject) => {
      const child = spawn("docker", dockerArgs, {
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
        child.stdin.write(line + "\n");
      }
      child.stdin.end();

      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`Docker MCP server timed out. stderr: ${stderr}`));
      }, 30_000);

      child.on("close", (code) => {
        clearTimeout(timer);
        const parsed: JsonRpcResponse[] = stdout
          .split("\n")
          .filter((l) => l.trim())
          .map((l) => {
            try {
              return JSON.parse(l) as JsonRpcResponse;
            } catch {
              return null;
            }
          })
          .filter((r): r is JsonRpcResponse => r !== null);

        if (parsed.length === 0 && code !== 0) {
          reject(new Error(`Docker MCP server exited ${code}. stderr:\n${stderr.slice(0, 1000)}`));
          return;
        }
        resolve(parsed);
      });
    });

    const initResp = responses.find((r) => r.id === 1);
    assert.ok(initResp?.result, "Missing initialize response");
    assert.equal(initResp.result.serverInfo?.name, "mulmoclaude");

    const toolsResp = responses.find((r) => r.id === 2);
    assert.ok(toolsResp?.result?.tools, "Missing tools/list response");

    const toolNames = toolsResp.result.tools.map((t) => t.name);
    assert.ok(toolNames.includes("presentMulmoScript"), `presentMulmoScript not in tools: ${toolNames.join(", ")}`);
    assert.ok(toolNames.includes("manageTodoList"), `manageTodoList not in tools: ${toolNames.join(", ")}`);
  });
});
