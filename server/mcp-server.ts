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

// All bridge calls go to the same backend on the same session, so
// every fetch was duplicating the same headers, method, and
// stringify boilerplate. `postJson` captures BASE_URL + SESSION_ID
// once and lets handleToolCall focus on what it's calling, not how.
//
// `path` is the absolute server path (e.g. /api/internal/tool-result)
// — the session query string is appended automatically.
//
// Both network errors and HTTP failures (4xx/5xx) are converted into
// a descriptive Error by default, so the outer catch in handleToolCall
// reports them as the failed tool call instead of a silent success.
// Pass `allowHttpError: true` for callers that want to inspect the
// response themselves (e.g. /api/mcp-tools/* which has its own
// status-aware result handling).
interface PostJsonOpts {
  allowHttpError?: boolean;
}

async function postJson(
  path: string,
  body: unknown,
  opts: PostJsonOpts = {},
): Promise<Response> {
  // SESSION_ID comes from the parent process env so it's effectively
  // trusted, but encode it anyway — defense in depth against future
  // callers passing unexpected characters (`&`, `#`, newlines, etc.).
  // The path arg is used as-is because all current call sites pass
  // hardcoded literals.
  let res: Response;
  try {
    res = await fetch(
      `${BASE_URL}${path}?session=${encodeURIComponent(SESSION_ID)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Network error calling ${path}: ${message}`);
  }
  if (!opts.allowHttpError && !res.ok) {
    const text = await res.text().catch(() => "");
    const detail = text ? `: ${text.slice(0, 500)}` : "";
    throw new Error(`HTTP ${res.status} calling ${path}${detail}`);
  }
  return res;
}

// Bridge for the manageSkills tool. Routes by `action`:
//   - "list" (default): GET /api/skills, push the list as a ToolResult
//   - "save"          : POST /api/skills with { name, description, body }
//   - "delete"        : DELETE /api/skills/:name
// In every case, after a successful mutation we re-fetch the list and
// push it so the canvas reflects the new state immediately.
async function handleManageSkills(
  args: Record<string, unknown>,
): Promise<string> {
  const action = typeof args.action === "string" ? args.action : "list";
  if (action === "save") return handleManageSkillsSave(args);
  if (action === "delete") return handleManageSkillsDelete(args);
  return handleManageSkillsList();
}

async function fetchSkillsList(): Promise<{ name: string }[]> {
  const url = `${BASE_URL}/api/skills?session=${encodeURIComponent(SESSION_ID)}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(
      `Network error calling /api/skills: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} calling /api/skills: ${text}`);
  }
  const body: { skills: { name: string }[] } = await res.json();
  return body.skills;
}

async function pushSkillsListResult(message: string): Promise<void> {
  const skills = await fetchSkillsList();
  await postJson("/api/internal/tool-result", {
    toolName: "manageSkills",
    uuid: crypto.randomUUID(),
    title: "Skills",
    message,
    data: { skills },
  });
}

async function handleManageSkillsList(): Promise<string> {
  const skills = await fetchSkillsList();
  const suffix = skills.length === 1 ? "" : "s";
  await postJson("/api/internal/tool-result", {
    toolName: "manageSkills",
    uuid: crypto.randomUUID(),
    title: "Skills",
    message: `Found ${skills.length} skill${suffix}.`,
    data: { skills },
  });
  return `Listed ${skills.length} skill${suffix}`;
}

async function handleManageSkillsSave(
  args: Record<string, unknown>,
): Promise<string> {
  // Normalize name once up front so log / result messages below never
  // interpolate an accidental object / number into `/${name}`.
  const name = String(args.name ?? "");
  const res = await postJson(
    "/api/skills",
    {
      name,
      description: args.description,
      body: args.body,
    },
    { allowHttpError: true },
  );
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    const detail = errBody.error ?? "HTTP " + res.status;
    return "Error: " + detail;
  }
  await pushSkillsListResult(`Saved skill "${name}".`);
  return `Saved skill ${name}. Run with /${name}.`;
}

async function handleManageSkillsDelete(
  args: Record<string, unknown>,
): Promise<string> {
  const name = String(args.name ?? "");
  const url = `/api/skills/${encodeURIComponent(name)}?session=${encodeURIComponent(SESSION_ID)}`;
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${url}`, { method: "DELETE" });
  } catch (err) {
    throw new Error(
      `Network error calling DELETE ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    const detail = errBody.error ?? "HTTP " + res.status;
    return "Error: " + detail;
  }
  await pushSkillsListResult(`Deleted skill "${name}".`);
  return `Deleted skill ${name}.`;
}

async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (name === "switchRole") {
    await postJson("/api/internal/switch-role", { roleId: args.roleId });
    return `Switching to ${args.roleId} role`;
  }

  if (name === "manageRoles") {
    const res = await postJson("/api/roles/manage", args);
    const result = await res.json();

    // For the list action, push a visual canvas result so the viewer renders
    if (args.action === "list" && result.success) {
      await postJson("/api/internal/tool-result", {
        toolName: "manageRoles",
        uuid: crypto.randomUUID(),
        ...result,
      });
    }

    return result.message ?? (result.error ? `Error: ${result.error}` : "Done");
  }

  if (name === "manageSkills") return handleManageSkills(args);

  // Pure MCP tools — call via /api/mcp-tools/:tool, return text directly
  // (no frontend push). Opt out of postJson's HTTP error throw because
  // we want to surface the JSON error body to the caller as a string.
  const mcpTool = mcpTools.find((t) => t.definition.name === name);
  if (mcpTool) {
    const res = await postJson(`/api/mcp-tools/${name}`, args, {
      allowHttpError: true,
    });
    const json = await res.json();
    if (!res.ok) return `Error: ${json.error ?? res.status}`;
    return typeof json.result === "string"
      ? json.result
      : JSON.stringify(json.result);
  }

  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);

  const res = await postJson(tool.endpoint!, args);
  const result = await res.json();

  // Push visual ToolResult to the frontend via the session
  await postJson("/api/internal/tool-result", {
    toolName: name,
    uuid: crypto.randomUUID(),
    ...result,
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
