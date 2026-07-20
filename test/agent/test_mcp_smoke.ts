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

import { ONE_SECOND_MS } from "../../server/utils/time.ts";
import { TOOL_NAMES } from "../../src/config/toolNames.ts";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../..");
const MCP_SERVER = path.join(PROJECT_ROOT, "server/agent/mcp-server.ts");
// Use npx tsx so the shell resolves .cmd wrappers on Windows.
const TSX = path.join(PROJECT_ROOT, "node_modules", ".bin", "tsx");

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: {
    protocolVersion?: string;
    capabilities?: { tools?: { listChanged?: boolean } };
    serverInfo?: { name: string };
    tools?: { name: string; description: string }[];
    content?: { type: string; text?: string }[];
    isError?: boolean;
  };
  error?: { code: number; message: string };
}

function sendAndReceive(lines: string[], env: Record<string, string>): Promise<JsonRpcResponse[]> {
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
      child.stdin.write(`${line}\n`);
    }
    child.stdin.end();

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`MCP server timed out. stderr: ${stderr}`));
    }, 15 * ONE_SECOND_MS);

    child.on("close", (code) => {
      clearTimeout(timer);
      const responses: JsonRpcResponse[] = stdout
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

      if (code !== 0) {
        reject(new Error(`MCP server exited with code ${code}. stderr: ${stderr.slice(0, 500)}`));
        return;
      }
      if (responses.length === 0) {
        reject(new Error(`MCP server produced no valid JSON-RPC responses. stdout: ${stdout.slice(0, 500)}`));
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
      PLUGIN_NAMES: [TOOL_NAMES.manageSkills, TOOL_NAMES.presentMulmoScript].join(","),
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
    assert.ok(responses.length >= 2, `Expected >= 2 responses, got ${responses.length}: ${JSON.stringify(responses)}`);

    // Initialize response
    const initResp = responses.find((resp) => resp.id === 1);
    assert.ok(initResp, "Missing initialize response");
    assert.ok(initResp.result, "Initialize response has no result");
    assert.equal(initResp.result.serverInfo?.name, "mulmoclaude");

    // Must advertise tools/list_changed so the client re-fetches once
    // runtime plugins finish loading (#1698 — the static tools/list now
    // returns immediately rather than waiting for that load).
    assert.equal(initResp.result.capabilities?.tools?.listChanged, true, "initialize must advertise capabilities.tools.listChanged");

    // tools/list response
    const toolsResp = responses.find((resp) => resp.id === 2);
    assert.ok(toolsResp, "Missing tools/list response");
    assert.ok(toolsResp.result?.tools, "tools/list has no tools array");
    assert.ok(Array.isArray(toolsResp.result.tools), "tools is not an array");

    // The tools we requested via PLUGIN_NAMES should be present.
    const toolNames = toolsResp.result.tools.map((tool: { name: string }) => tool.name);
    assert.ok(toolNames.includes(TOOL_NAMES.manageSkills), `${TOOL_NAMES.manageSkills} not in tools: ${toolNames.join(", ")}`);
    assert.ok(toolNames.includes(TOOL_NAMES.presentMulmoScript), `${TOOL_NAMES.presentMulmoScript} not in tools: ${toolNames.join(", ")}`);

    // manageWiki is intentionally absent (#963 Stage 3b) — the MCP
    // tool definition was removed; the plugin record stays for
    // canvas dispatch only, not for LLM-side calls.
    assert.ok(!toolNames.includes(TOOL_NAMES.manageWiki), `${TOOL_NAMES.manageWiki} should not be exposed via MCP: ${toolNames.join(", ")}`);

    // The always-on permission-prompt tool MUST appear in the very first
    // tools/list, so an ask-mode permission check at session start never
    // hits "MCP tool mcp__mulmoclaude__handlePermission ... not found" (#1698).
    assert.ok(toolNames.includes("handlePermission"), `handlePermission not in tools: ${toolNames.join(", ")}`);
  });

  // `name` comes from the model, so it can be any JSON type. It used to be read
  // as `String(args.name ?? "")`, which turns an object into the literal
  // "[object Object]" — POSTed to /api/skills as a skill name and read back to
  // the user as one. The guard must reject it before any of that.
  //
  // Driven through the subprocess because mcp-server.ts is an stdio entry point
  // with no exports; there is no unit-level seam to reach the guard.
  it("rejects a non-string skill name instead of acting on [object Object]", async () => {
    const env: Record<string, string> = {
      SESSION_ID: "test-smoke-bad-name",
      PORT: "0",
      PLUGIN_NAMES: TOOL_NAMES.manageSkills,
    };

    const responses = await sendAndReceive(
      [
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0.0.0" } },
        }),
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: TOOL_NAMES.manageSkills,
            arguments: { action: "save", name: { nested: "oops" }, description: "d", body: "b" },
          },
        }),
      ],
      env,
    );

    const call = responses.find((response) => response.id === 2);
    assert.ok(call, `no response for tools/call: ${JSON.stringify(responses)}`);

    const text = JSON.stringify(call);
    // The guard's message, not an HTTP failure from the unreachable PORT=0 —
    // proving it fired before the request was attempted.
    assert.match(text, /name.{0,40}must be a non-empty string/i, `expected the name guard to fire, got: ${text.slice(0, 400)}`);
    assert.doesNotMatch(text, /\[object Object\]/, `the object name reached the API path: ${text.slice(0, 400)}`);
  });
});
