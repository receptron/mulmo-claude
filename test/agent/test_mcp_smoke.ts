// Smoke test: spawn the MCP server as a real subprocess (the same way
// Claude CLI does) and verify it can initialize + list tools.
//
// This catches import-resolution failures that typecheck and unit
// tests miss because they run in the main process context. The MCP
// server is a standalone tsx subprocess — if any import path is
// broken, it crashes on startup before responding to JSON-RPC.
//
// See PR #424 for the bug this test prevents from recurring.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../..");
const MCP_SERVER = path.join(PROJECT_ROOT, "server/agent/mcp-server.ts");
// Use npx tsx so the shell resolves .cmd wrappers on Windows.
const TSX = path.join(PROJECT_ROOT, "node_modules", ".bin", "tsx");

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: {
    protocolVersion?: string;
    capabilities?: object;
    serverInfo?: { name: string };
    tools?: Array<{ name: string; description: string }>;
  };
  error?: { code: number; message: string };
}

function sendAndReceive(
  lines: string[],
  env: Record<string, string>,
): Promise<JsonRpcResponse[]> {
  return new Promise((resolve, reject) => {
    // shell: true so Windows resolves .cmd wrappers in node_modules/.bin/.
    // Pass args as a single command string to avoid DEP0190 warning.
    const child = spawn(`"${TSX}" "${MCP_SERVER}"`, {
      cwd: PROJECT_ROOT,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    // Send all lines, then close stdin to signal EOF.
    for (const line of lines) {
      child.stdin.write(line + "\n");
    }
    child.stdin.end();

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`MCP server timed out. stderr: ${stderr}`));
    }, 15_000);

    child.on("close", (code) => {
      clearTimeout(timer);
      const responses: JsonRpcResponse[] = stdout
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

      if (code !== 0) {
        reject(
          new Error(
            `MCP server exited with code ${code}. stderr: ${stderr.slice(0, 500)}`,
          ),
        );
        return;
      }
      if (responses.length === 0) {
        reject(
          new Error(
            `MCP server produced no valid JSON-RPC responses. stdout: ${stdout.slice(0, 500)}`,
          ),
        );
        return;
      }
      resolve(responses);
    });
  });
}

describe("MCP server subprocess smoke test", () => {
  it("responds to initialize + tools/list with registered tools", async () => {
    const env: Record<string, string> = {
      SESSION_ID: "test-smoke",
      PORT: "0",
      PLUGIN_NAMES: "manageTodoList,presentMulmoScript,manageWiki,switchRole",
      ROLE_IDS: "general",
    };

    const responses = await sendAndReceive(
      [
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "test", version: "0.0.0" },
          },
        }),
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {},
        }),
      ],
      env,
    );

    // Should get exactly 2 responses (initialize + tools/list).
    assert.ok(
      responses.length >= 2,
      `Expected >= 2 responses, got ${responses.length}: ${JSON.stringify(responses)}`,
    );

    // Initialize response
    const initResp = responses.find((r) => r.id === 1);
    assert.ok(initResp, "Missing initialize response");
    assert.ok(initResp.result, "Initialize response has no result");
    assert.equal(initResp.result.serverInfo?.name, "mulmoclaude");

    // tools/list response
    const toolsResp = responses.find((r) => r.id === 2);
    assert.ok(toolsResp, "Missing tools/list response");
    assert.ok(toolsResp.result?.tools, "tools/list has no tools array");
    assert.ok(Array.isArray(toolsResp.result.tools), "tools is not an array");

    // The tools we requested via PLUGIN_NAMES should be present.
    const toolNames = toolsResp.result.tools.map(
      (t: { name: string }) => t.name,
    );
    assert.ok(
      toolNames.includes("manageTodoList"),
      `manageTodoList not in tools: ${toolNames.join(", ")}`,
    );
    assert.ok(
      toolNames.includes("presentMulmoScript"),
      `presentMulmoScript not in tools: ${toolNames.join(", ")}`,
    );
    assert.ok(
      toolNames.includes("manageWiki"),
      `manageWiki not in tools: ${toolNames.join(", ")}`,
    );

    // switchRole should always be included.
    assert.ok(
      toolNames.includes("switchRole"),
      `switchRole not in tools: ${toolNames.join(", ")}`,
    );
  });
});
