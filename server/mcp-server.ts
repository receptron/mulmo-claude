/**
 * Standalone MCP stdio server — spawned by the Claude CLI via --mcp-config.
 * Bridges Claude's tool calls to our server endpoints and pushes ToolResults
 * back to the active frontend SSE stream via the session registry.
 */

import { TOOL_DEFINITION as MarkdownDef } from "@gui-chat-plugin/markdown";
import { TOOL_DEFINITION as SpreadsheetDef } from "@gui-chat-plugin/spreadsheet";
import { TOOL_DEFINITION as MindMapDef } from "@gui-chat-plugin/mindmap";
import { TOOL_DEFINITION as GenerateImageDef } from "@mulmochat-plugin/generate-image";
import { TOOL_DEFINITION as QuizDef } from "@mulmochat-plugin/quiz";
import { TOOL_DEFINITION as FormDef } from "@mulmochat-plugin/form";
import { TOOL_DEFINITION as CanvasDef } from "@gui-chat-plugin/canvas";
import { TOOL_DEFINITION as GenerateHtmlDef } from "@gui-chat-plugin/generate-html";
import { TOOL_DEFINITION as EditHtmlDef } from "@gui-chat-plugin/edit-html";
import { TOOL_DEFINITION as EditImageDef } from "@gui-chat-plugin/edit-image";
import { TOOL_DEFINITION as Present3DDef } from "@gui-chat-plugin/present3d";
import { TOOL_DEFINITION as OthelloDef } from "@gui-chat-plugin/othello";
import { TOOL_DEFINITION as MusicDef } from "@gui-chat-plugin/music";
import TodoDef from "../src/plugins/todo/definition.js";
import SchedulerDef from "../src/plugins/scheduler/definition.js";
import PresentMulmoScriptDef from "../src/plugins/presentMulmoScript/definition.js";
import { toolDefinition as ManageRolesDef } from "../src/plugins/manageRoles/definition.js";
import type { ToolDefinition } from "gui-chat-protocol";

const SESSION_ID = process.env.SESSION_ID ?? "";
const PORT = process.env.PORT ?? "3001";
const PLUGIN_NAMES = (process.env.PLUGIN_NAMES ?? "")
  .split(",")
  .filter(Boolean);
const ROLE_IDS = (process.env.ROLE_IDS ?? "").split(",").filter(Boolean);
const BASE_URL = `http://localhost:${PORT}`;

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
    inputSchema: def.parameters as object,
    endpoint,
  };
}

// Endpoint map — the only MulmoChat-specific part per tool
const TOOL_ENDPOINTS: Record<string, string> = {
  [TodoDef.name]: "/api/todos",
  [SchedulerDef.name]: "/api/scheduler",
  [MarkdownDef.name]: "/api/present-document",
  [SpreadsheetDef.name]: "/api/present-spreadsheet",
  [MindMapDef.name]: "/api/mindmap",
  [GenerateImageDef.name]: "/api/generate-image",
  [QuizDef.name]: "/api/quiz",
  [FormDef.name]: "/api/form",
  [CanvasDef.name]: "/api/canvas",
  [GenerateHtmlDef.name]: "/api/generate-html",
  [EditHtmlDef.name]: "/api/edit-html",
  [EditImageDef.name]: "/api/edit-image",
  [Present3DDef.name]: "/api/present3d",
  [OthelloDef.name]: "/api/othello",
  [MusicDef.name]: "/api/music",
  [ManageRolesDef.name]: "/api/roles/manage",
  [PresentMulmoScriptDef.name]: "/api/mulmo-script",
};

const ALL_TOOLS: Record<string, ToolDef> = {
  ...Object.fromEntries(
    [
      TodoDef,
      SchedulerDef,
      PresentMulmoScriptDef,
      MarkdownDef,
      SpreadsheetDef,
      MindMapDef,
      GenerateImageDef,
      QuizDef,
      FormDef,
      CanvasDef,
      GenerateHtmlDef,
      EditHtmlDef,
      EditImageDef,
      Present3DDef,
      OthelloDef,
      MusicDef,
    ].map((def) => [def.name, fromPackage(def, TOOL_ENDPOINTS[def.name])]),
  ),
  [ManageRolesDef.name]: {
    name: ManageRolesDef.name,
    description: ManageRolesDef.description,
    inputSchema: ManageRolesDef.inputSchema,
    endpoint: TOOL_ENDPOINTS[ManageRolesDef.name],
  },
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
            uuid: `${SESSION_ID}-manageRoles`,
            ...result,
          }),
        },
      );
    }

    return result.message ?? (result.error ? `Error: ${result.error}` : "Done");
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
    uuid: `${SESSION_ID}-${name}`,
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
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }

    const { id, method, params } = msg as {
      id?: unknown;
      method: string;
      params?: Record<string, unknown>;
    };

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
      const { name, arguments: toolArgs } = (params ?? {}) as {
        name: string;
        arguments: Record<string, unknown>;
      };
      handleToolCall(name, toolArgs ?? {})
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
