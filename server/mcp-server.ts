/**
 * Standalone MCP stdio server — spawned by the Claude CLI via --mcp-config.
 * Bridges Claude's tool calls to our server endpoints and pushes ToolResults
 * back to the active frontend SSE stream via the session registry.
 */

import type { ToolDefinition } from "gui-chat-protocol";
import { mcpTools, isMcpToolEnabled } from "./mcp-tools/index.js";
import { TOOL_ENDPOINTS, PLUGIN_DEFS } from "./plugin-names.js";

type JsonRpcId = string | number | null;

interface ToolCallParams {
  name: string;
  arguments?: Record<string, unknown>;
}

interface JsonRpcMessage {
  jsonrpc: string;
  id?: JsonRpcId;
  method: string;
  params?: ToolCallParams;
}

const isJsonRpcMessage = (v: unknown): v is JsonRpcMessage =>
  typeof v === "object" && v !== null && !Array.isArray(v) && "method" in v;

const SESSION_ID = process.env.SESSION_ID ?? "";
const PORT = process.env.PORT ?? "3001";
const PLUGIN_NAMES = (process.env.PLUGIN_NAMES ?? "")
  .split(",")
  .filter(Boolean);
const ROLE_IDS = (process.env.ROLE_IDS ?? "").split(",").filter(Boolean);
const MCP_HOST = process.env.MCP_HOST ?? "localhost";
const BASE_URL = `http://${MCP_HOST}:${PORT}`;

interface ToolDef {
  name: string;
  description: string;
  inputSchema: object;
  endpoint?: string; // absent for tools handled specially (e.g. switchRole)
}

function fromPackage(def: ToolDefinition, endpoint: string): ToolDef {
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.parameters ?? {},
    endpoint,
  };
}

// Pure MCP tools (no GUI) — auto-registered from server/mcp-tools/
const mcpToolDefs: Record<string, ToolDef> = Object.fromEntries(
  mcpTools.filter(isMcpToolEnabled).map((t) => [
    t.definition.name,
    {
      name: t.definition.name,
      description: t.definition.description,
      inputSchema: t.definition.inputSchema,
    },
  ]),
);

const ALL_TOOLS: Record<string, ToolDef> = {
  ...mcpToolDefs,
  ...Object.fromEntries(
    PLUGIN_DEFS.map((def) => [
      def.name,
      fromPackage(def, TOOL_ENDPOINTS[def.name]),
    ]),
  ),
  switchRole: {
    name: "switchRole",
    description:
      "Switch to a different AI role, resetting the conversation context. Use when the user's request is better served by another role.",
    inputSchema: {
      type: "object",
      properties: {
        roleId: {
          type: "string",
          enum: ROLE_IDS,
          description: "The ID of the role to switch to.",
        },
      },
      required: ["roleId"],
    },
  },
};

const tools = PLUGIN_NAMES.map((name) => ALL_TOOLS[name]).filter(Boolean);

function respond(msg: unknown): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (name === "switchRole") {
    await fetch(`${BASE_URL}/api/internal/switch-role?session=${SESSION_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleId: args.roleId }),
    });
    return `Switching to ${args.roleId} role`;
  }

  if (name === "manageRoles") {
    const res = await fetch(
      `${BASE_URL}/api/roles/manage?session=${SESSION_ID}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      },
    );
    const result = await res.json();

    // For the list action, push a visual canvas result so the viewer renders
    if (args.action === "list" && result.success) {
      await fetch(
        `${BASE_URL}/api/internal/tool-result?session=${SESSION_ID}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            toolName: "manageRoles",
            uuid: crypto.randomUUID(),
            ...result,
          }),
        },
      );
    }

    return result.message ?? (result.error ? `Error: ${result.error}` : "Done");
  }

  // Pure MCP tools — call via /api/mcp-tools/:tool, return text directly (no frontend push)
  const mcpTool = mcpTools.find((t) => t.definition.name === name);
  if (mcpTool) {
    const res = await fetch(
      `${BASE_URL}/api/mcp-tools/${name}?session=${SESSION_ID}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      },
    );
    const json = await res.json();
    if (!res.ok) return `Error: ${json.error ?? res.status}`;
    return typeof json.result === "string"
      ? json.result
      : JSON.stringify(json.result);
  }

  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);

  const res = await fetch(`${BASE_URL}${tool.endpoint}?session=${SESSION_ID}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const result = await res.json();

  // Push visual ToolResult to the frontend via the session
  const toolResult = {
    toolName: name,
    uuid: crypto.randomUUID(),
    ...result,
  };
  await fetch(`${BASE_URL}/api/internal/tool-result?session=${SESSION_ID}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toolResult),
  });

  const parts = [result.message, result.instructions].filter(Boolean);
  return parts.length > 0 ? parts.join("\n") : "Done";
}

let buffer = "";

process.stdin.on("data", (chunk: Buffer) => {
  buffer += chunk.toString();
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";

  for (const line of lines) {
    if (!line.trim()) continue;
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isJsonRpcMessage(msg)) continue;

    const { id, method, params } = msg;

    if (method === "initialize") {
      respond({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "mulmoclaude", version: "1.0.0" },
        },
      });
    } else if (method === "tools/list") {
      respond({
        jsonrpc: "2.0",
        id,
        result: {
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        },
      });
    } else if (method === "tools/call") {
      if (!params?.name) {
        respond({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32602,
            message: "Invalid params: tools/call requires params.name",
          },
        });
        continue;
      }
      const toolArgs = params.arguments ?? {};
      handleToolCall(params.name, toolArgs)
        .then((text) => {
          respond({
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text }] },
          });
        })
        .catch((err: unknown) => {
          respond({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: String(err) }],
              isError: true,
            },
          });
        });
    } else if (method === "ping") {
      respond({ jsonrpc: "2.0", id, result: {} });
    }
    // notifications/initialized and other notifications: no response needed
  }
});

process.stdin.on("end", () => process.exit(0));
