/**
 * Standalone MCP stdio server — spawned by the Claude CLI via --mcp-config.
 * Bridges Claude's tool calls to our server endpoints and pushes ToolResults
 * back to the active frontend SSE stream via the session registry.
 */

import type { ToolDefinition } from "gui-chat-protocol";
import { mcpTools, isMcpToolEnabled } from "./mcp-tools/index.js";
import { TOOL_ENDPOINTS, PLUGIN_DEFS } from "./plugin-names.js";
import { errorMessage } from "../utils/errors.js";
import { isNonEmptyString, isRecord } from "../utils/types.js";
import { API_ROUTES } from "../../src/config/apiRoutes.js";
import { env } from "../system/env.js";
import { extractFetchError, fetchWithTimeout } from "../utils/fetch.js";
import { ONE_MINUTE_MS, ONE_SECOND_MS } from "../utils/time.js";
import { safeResponseText } from "../utils/http.js";
import { readTextSafeSync } from "../utils/files/safe.js";
import { WORKSPACE_PATHS } from "../workspace/paths.js";
import { makeUuid } from "../utils/id.js";

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

const isJsonRpcMessage = (value: unknown): value is JsonRpcMessage => isRecord(value) && "method" in value;

const SESSION_ID = env.mcpSessionId;
const PORT = env.port;
const PLUGIN_NAMES = env.mcpPluginNames;
const MCP_HOST = env.mcpHost;
const BASE_URL = `http://${MCP_HOST}:${PORT}`;

// Bearer token for /api/* calls back to the parent server (#272).
// The parent writes it to <workspace>/.session-token at startup; we
// read once at module load — the token is immutable for the server's
// lifetime. Same resolution order as bridges/cli/token.ts.
function readSessionToken(): string {
  const fromEnv = process.env.MULMOCLAUDE_AUTH_TOKEN;
  if (isNonEmptyString(fromEnv)) return fromEnv;
  return readTextSafeSync(WORKSPACE_PATHS.sessionToken)?.trim() ?? "";
}
const SESSION_TOKEN = readSessionToken();
const AUTH_HEADER: Record<string, string> = SESSION_TOKEN ? { Authorization: `Bearer ${SESSION_TOKEN}` } : {};

interface ToolDef {
  name: string;
  description: string;
  inputSchema: object;
  endpoint?: string;
}

// Combine `description` (one-liner) and `prompt` (detailed usage
// instructions) into the MCP tool description so Claude CLI sees
// both. The MCP protocol only has `description` — there's no
// `prompt` field — so the prompt content must ride along in the
// description string. The gui-chat-protocol ToolDefinition carries
// `prompt` separately because the Vue client uses it for different
// purposes, but the CLI needs it in-band.
function fromPackage(def: ToolDefinition, endpoint: string): ToolDef {
  const parts = [def.description];
  if (typeof def.prompt === "string" && def.prompt.length > 0) {
    parts.push(def.prompt);
  }
  return {
    name: def.name,
    description: parts.join("\n\n"),
    inputSchema: def.parameters ?? {},
    endpoint,
  };
}

// Pure MCP tools (no GUI) — auto-registered from server/mcp-tools/
const mcpToolDefs: Record<string, ToolDef> = Object.fromEntries(
  mcpTools.filter(isMcpToolEnabled).map((toolDef) => [
    toolDef.definition.name,
    {
      name: toolDef.definition.name,
      description: toolDef.definition.description,
      inputSchema: toolDef.definition.inputSchema,
    },
  ]),
);

const ALL_TOOLS: Record<string, ToolDef> = {
  ...mcpToolDefs,
  ...Object.fromEntries(PLUGIN_DEFS.map((def) => [def.name, fromPackage(def, TOOL_ENDPOINTS[def.name])])),
};

const tools = PLUGIN_NAMES.map((name) => ALL_TOOLS[name]).filter(Boolean);

// MCP tools (e.g. readXPost, searchX) call external APIs through their
// own handlers. The bridge timeout must exceed those inner timeouts
// plus a small buffer for JSON parsing / HTTP round-trip, otherwise the
// bridge aborts before the handler can return a formatted error.
// Currently the slowest inner timeout is the X API (20 s); 30 s gives
// 10 s of headroom and still lands well inside the MCP client's own
// 30-60 s tool-call window.
const MCP_TOOL_BRIDGE_TIMEOUT_MS = 30 * ONE_SECOND_MS;

// Plugin tools (e.g. presentDocument, openCanvas) may invoke generative
// AI — image generation routinely takes 10–30 s per call, video can run
// for several minutes, and a single tool invocation can fan out to
// multiple parallel generations. The bridge MUST stay out of the way:
// set a ceiling far above any realistic completion time so the limiting
// factor is the agent SDK's own tool-call window, never this fetch.
// Pick 20 minutes — long enough for batch image gen + future video gen,
// short enough that a truly wedged Express handler still surfaces.
const PLUGIN_BRIDGE_TIMEOUT_MS = 20 * ONE_MINUTE_MS;

function respond(msg: unknown): void {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
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
//
// =====================================================================
// TIMEOUT POLICY — read this before adding a new bridge call
// =====================================================================
// The default `timeoutMs` from `fetchWithTimeout` is 10 s, sized for
// healthy localhost round-trips. THAT IS TOO SHORT for any handler
// that fans out to generative AI (image / video / model calls) or
// hits a slow external API. Whenever the downstream handler can
// legitimately take longer than ~5 s, the caller MUST pass an
// explicit `timeoutMs` that comfortably exceeds the worst realistic
// completion time:
//
//   - Generative AI plugins (presentDocument, openCanvas, …)
//     → use `PLUGIN_BRIDGE_TIMEOUT_MS` (20 min). Image batches and
//       future video generation MUST NOT be limited by the bridge.
//   - External-API MCP tools (readXPost, searchX, …)
//     → use `MCP_TOOL_BRIDGE_TIMEOUT_MS` (30 s) or a custom value
//       larger than the inner API's own timeout.
//   - Pure server-state RPCs (toolResult push, role switch, …)
//     → default 10 s is fine; these are local JSON round-trips.
//
// On EVERY failure (timeout, abort, connection reset, HTTP 5xx) this
// function MUST emit an error log to stderr. Silent timeouts are the
// exact failure mode that hid the original bug — the server kept
// generating images, the bridge gave up at 10 s, and the user saw
// "tool failed" with no trace in the logs. If you change the catch
// block below, keep the log emission.
// =====================================================================
interface PostJsonOpts {
  allowHttpError?: boolean;
  // Override the default bridge-call timeout. Needed when the
  // downstream handler itself does slow work (e.g. /api/mcp-tools/*
  // that hits an external API): the bridge must wait long enough for
  // the handler's own timeout to fire, otherwise the outer abort
  // preempts a formatted error.
  timeoutMs?: number;
}

async function postJson(path: string, body: unknown, opts: PostJsonOpts = {}): Promise<Response> {
  // SESSION_ID comes from the parent process env so it's effectively
  // trusted, but encode it anyway — defense in depth against future
  // callers passing unexpected characters (`&`, `#`, newlines, etc.).
  // The path arg is used as-is because all current call sites pass
  // hardcoded literals.
  let res: Response;
  const startedAt = Date.now();
  try {
    res = await fetchWithTimeout(`${BASE_URL}${path}?session=${encodeURIComponent(SESSION_ID)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH_HEADER },
      body: JSON.stringify(body),
      timeoutMs: opts.timeoutMs,
    });
  } catch (err) {
    // `fetchWithTimeout` throws a DOMException("TimeoutError") when
    // the timer fires; surface that case explicitly so the operator
    // can tell "timeout vs. connection error" at a glance.
    const elapsedMs = Date.now() - startedAt;
    const isTimeout = err instanceof DOMException && err.name === "TimeoutError";
    const kind = isTimeout ? "TIMEOUT" : "NETWORK";
    console.error(`[mcp-bridge] ${kind} ${path} after ${elapsedMs}ms (timeoutMs=${opts.timeoutMs ?? "default"}): ${errorMessage(err)}`);
    throw new Error(`Network error calling ${path}: ${errorMessage(err)}`);
  }
  if (!opts.allowHttpError && !res.ok) {
    const errBody = await safeResponseText(res, 500);
    const detail = errBody ? `: ${errBody}` : "";
    // Mirror the network/timeout error path above — log to stderr so
    // an HTTP 4xx/5xx from the server never hides from the bridge
    // operator. Without this, the thrown Error propagates silently
    // to the MCP caller and the log stream shows nothing.
    const elapsedMs = Date.now() - startedAt;
    console.error(`[mcp-bridge] HTTP ${res.status} ${path} after ${elapsedMs}ms${detail}`);
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
async function handleManageSkills(args: Record<string, unknown>): Promise<string> {
  const action = typeof args.action === "string" ? args.action : "list";
  if (action === "save") return handleManageSkillsSave(args);
  if (action === "update") return handleManageSkillsUpdate(args);
  if (action === "delete") return handleManageSkillsDelete(args);
  return handleManageSkillsList();
}

async function fetchSkillsList(): Promise<{ name: string }[]> {
  const url = `${BASE_URL}/api/skills?session=${encodeURIComponent(SESSION_ID)}`;
  let res: Response;
  try {
    res = await fetchWithTimeout(url, { headers: AUTH_HEADER });
  } catch (err) {
    throw new Error(`Network error calling /api/skills: ${errorMessage(err)}`);
  }
  if (!res.ok) {
    const body = await safeResponseText(res);
    throw new Error(`HTTP ${res.status} calling /api/skills: ${body}`);
  }
  const body: { skills: { name: string }[] } = await res.json();
  return body.skills;
}

async function pushSkillsListResult(message: string): Promise<void> {
  const skills = await fetchSkillsList();
  await postJson(API_ROUTES.agent.internal.toolResult, {
    toolName: "manageSkills",
    uuid: makeUuid(),
    title: "Skills",
    message,
    data: { skills },
  });
}

async function handleManageSkillsList(): Promise<string> {
  const skills = await fetchSkillsList();
  const suffix = skills.length === 1 ? "" : "s";
  await postJson(API_ROUTES.agent.internal.toolResult, {
    toolName: "manageSkills",
    uuid: makeUuid(),
    title: "Skills",
    message: `Found ${skills.length} skill${suffix}.`,
    data: { skills },
  });
  return `Listed ${skills.length} skill${suffix}`;
}

async function handleManageSkillsSave(args: Record<string, unknown>): Promise<string> {
  // Normalize name once up front so log / result messages below never
  // interpolate an accidental object / number into `/${name}`.
  const name = String(args.name ?? "");
  const res = await postJson(
    API_ROUTES.skills.create,
    {
      name,
      description: args.description,
      body: args.body,
    },
    { allowHttpError: true },
  );
  if (!res.ok) {
    return `Error: ${await extractFetchError(res)}`;
  }
  await pushSkillsListResult(`Saved skill "${name}".`);
  return `Saved skill ${name}. Run with /${name}.`;
}

async function handleManageSkillsUpdate(args: Record<string, unknown>): Promise<string> {
  const name = String(args.name ?? "");
  const url = `${BASE_URL}/api/skills/${encodeURIComponent(name)}?session=${encodeURIComponent(SESSION_ID)}`;
  let res: Response;
  try {
    res = await fetchWithTimeout(url, {
      method: "PUT",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify({
        description: args.description,
        body: args.body,
      }),
    });
  } catch (err) {
    throw new Error(`Network error calling PUT /api/skills/${name}: ${errorMessage(err)}`);
  }
  if (!res.ok) {
    return `Error: ${await extractFetchError(res)}`;
  }
  await pushSkillsListResult(`Updated skill "${name}".`);
  return `Updated skill ${name}. The changes take effect in new sessions.`;
}

async function handleManageSkillsDelete(args: Record<string, unknown>): Promise<string> {
  const name = String(args.name ?? "");
  const url = `/api/skills/${encodeURIComponent(name)}?session=${encodeURIComponent(SESSION_ID)}`;
  let res: Response;
  try {
    res = await fetchWithTimeout(`${BASE_URL}${url}`, {
      method: "DELETE",
      headers: AUTH_HEADER,
    });
  } catch (err) {
    throw new Error(`Network error calling DELETE ${url}: ${errorMessage(err)}`);
  }
  if (!res.ok) {
    return `Error: ${await extractFetchError(res)}`;
  }
  await pushSkillsListResult(`Deleted skill "${name}".`);
  return `Deleted skill ${name}.`;
}

async function handleToolCall(name: string, args: Record<string, unknown>): Promise<string> {
  if (name === "manageSkills") return handleManageSkills(args);

  // Pure MCP tools — call via /api/mcp-tools/:tool, return text directly
  // (no frontend push). Opt out of postJson's HTTP error throw because
  // we want to surface the JSON error body to the caller as a string.
  // The tool handler may hit a slow external API (e.g. X), so pass a
  // longer bridge timeout than the default 10 s used for localhost
  // roundtrips — see MCP_TOOL_BRIDGE_TIMEOUT_MS.
  const mcpTool = mcpTools.find((toolDef) => toolDef.definition.name === name);
  if (mcpTool) {
    const res = await postJson(`/api/mcp-tools/${name}`, args, {
      allowHttpError: true,
      timeoutMs: MCP_TOOL_BRIDGE_TIMEOUT_MS,
    });
    const json = await res.json();
    if (!res.ok) return `Error: ${json.error ?? res.status}`;
    return typeof json.result === "string" ? json.result : JSON.stringify(json.result);
  }

  const tool = tools.find((toolDef) => toolDef.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  if (!tool.endpoint) throw new Error(`Tool has no endpoint: ${name}`);

  // Plugin handlers can fan out to generative AI (image batches via
  // presentDocument, future video). The bridge MUST wait long enough
  // for the slowest realistic completion — see PLUGIN_BRIDGE_TIMEOUT_MS
  // and the timeout-policy comment on `postJson`.
  const res = await postJson(tool.endpoint, args, { timeoutMs: PLUGIN_BRIDGE_TIMEOUT_MS });
  const result = await res.json();

  // Push visual ToolResult to the frontend via the session
  await postJson(API_ROUTES.agent.internal.toolResult, {
    toolName: name,
    uuid: makeUuid(),
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

    const { id: requestId, method, params } = msg;

    if (method === "initialize") {
      respond({
        jsonrpc: "2.0",
        id: requestId,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "mulmoclaude", version: "1.0.0" },
        },
      });
    } else if (method === "tools/list") {
      respond({
        jsonrpc: "2.0",
        id: requestId,
        result: {
          tools: tools.map((toolDef) => ({
            name: toolDef.name,
            description: toolDef.description,
            inputSchema: toolDef.inputSchema,
          })),
        },
      });
    } else if (method === "tools/call") {
      if (!params?.name) {
        respond({
          jsonrpc: "2.0",
          id: requestId,
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
            id: requestId,
            result: { content: [{ type: "text", text }] },
          });
        })
        .catch((err: unknown) => {
          respond({
            jsonrpc: "2.0",
            id: requestId,
            result: {
              content: [{ type: "text", text: String(err) }],
              isError: true,
            },
          });
        });
    } else if (method === "ping") {
      respond({ jsonrpc: "2.0", id: requestId, result: {} });
    }
    // notifications/initialized and other notifications: no response needed
  }
});

process.stdin.on("end", () => process.exit(0));
