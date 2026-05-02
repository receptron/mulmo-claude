// Single source of truth for "what tools is the agent allowed to use
// in this session?" (#1043 C-2 follow-up).
//
// Three consumer sites used to maintain their own copy of this logic
// and each had to be patched separately when runtime plugins (#1043
// C-2) joined the picture:
//
//   - server/agent/config.ts  (`getActivePlugins(role)` → ENV
//                              PLUGIN_NAMES + `--allowedTools`)
//   - server/agent/prompt.ts  (`buildPluginPromptSections(role)` →
//                              `### <name>` blocks in system prompt)
//   - server/agent/mcp-server.ts (`tools` array → MCP tools/list)
//
// They went out of sync more than once during runtime-plugin rollout:
// e.g. config.ts gated by role.availablePlugins while prompt.ts did
// the same with a different filter; runtime plugins ended up in
// PLUGIN_NAMES but missing from the system prompt, etc.
//
// `getActiveToolDescriptors(role)` produces a single list of
// `ActiveToolDescriptor` rows and the three call sites read whichever
// fields they need (name only / name + prompt / name + endpoint).
// Runtime plugins are auto-included regardless of role; static plugins
// are still gated by `role.availablePlugins`. The MCP-prefixed full
// name is precomputed once so callers don't have to re-derive it.

import type { Role } from "../../src/config/roles.js";
import type { ToolDefinition } from "gui-chat-protocol";
import { mcpTools, isMcpToolEnabled } from "./mcp-tools/index.js";
import { PLUGIN_DEFS, TOOL_ENDPOINTS } from "./plugin-names.js";
import { getRuntimePlugins } from "../plugins/runtime-registry.js";

/** The MCP server id the parent registers via `--mcp-config` (see
 *  `buildMulmoclaudeServer` in `config.ts`). The Claude Agent SDK
 *  exposes every tool the server publishes under
 *  `mcp__<serverId>__<toolName>` — we precompute the full id so the
 *  prompt section can give the LLM the exact name to call (a short
 *  name alone leads the LLM to hallucinate the server prefix from
 *  the tool's package name; observed during manual test of the
 *  weather preset). */
export const MCP_SERVER_ID = "mulmoclaude";

export type ToolSource = "static-gui" | "static-mcp" | "runtime";

export interface ActiveToolDescriptor {
  /** Bare tool name (TOOL_DEFINITION.name). Matches what the MCP
   *  server's `tools/list` reports and what the LLM uses on
   *  `tools/call`. */
  name: string;
  /** Fully-qualified Claude Agent SDK form, e.g.
   *  `mcp__mulmoclaude__fetchWeather`. Used by the system prompt
   *  hint and by the `--allowedTools` builder. */
  fullName: string;
  /** One-line description from the tool definition. Always present. */
  description: string;
  /** Optional richer prompt the plugin author wrote for the system
   *  prompt. Falls back to `description` when missing. */
  prompt?: string;
  /** HTTP endpoint the MCP child posts to when the tool is called.
   *  Static GUI plugins look this up via `TOOL_ENDPOINTS`; runtime
   *  plugins always go through the generic dispatch route; pure
   *  MCP tools handle the call internally and have no endpoint. */
  endpoint?: string;
  /** Where the descriptor came from. Useful for telemetry / debug
   *  logging; not consumed by the production tool-call path. */
  source: ToolSource;
}

const FULL_PREFIX = `mcp__${MCP_SERVER_ID}__`;
const fullNameFor = (toolName: string): string => `${FULL_PREFIX}${toolName}`;
const promptFor = (def: ToolDefinition): string | undefined => {
  if ("prompt" in def && typeof (def as { prompt?: unknown }).prompt === "string") {
    return (def as { prompt: string }).prompt;
  }
  return undefined;
};

export function getActiveToolDescriptors(role: Role): ActiveToolDescriptor[] {
  const allowed = new Set<string>(role.availablePlugins);
  const seen = new Set<string>();
  const out: ActiveToolDescriptor[] = [];

  for (const def of PLUGIN_DEFS) {
    if (!allowed.has(def.name) || seen.has(def.name)) continue;
    out.push({
      name: def.name,
      fullName: fullNameFor(def.name),
      description: def.description,
      prompt: promptFor(def),
      endpoint: TOOL_ENDPOINTS[def.name],
      source: "static-gui",
    });
    seen.add(def.name);
  }

  for (const tool of mcpTools) {
    const toolName = tool.definition.name;
    if (!allowed.has(toolName) || seen.has(toolName) || !isMcpToolEnabled(tool)) continue;
    out.push({
      name: toolName,
      fullName: fullNameFor(toolName),
      description: tool.definition.description,
      prompt: tool.prompt,
      // pure MCP tools dispatch internally — no external endpoint
      source: "static-mcp",
    });
    seen.add(toolName);
  }

  for (const plugin of getRuntimePlugins()) {
    const def = plugin.definition;
    if (seen.has(def.name)) continue; // runtime-registry collision
    // policy already filters static name collisions, but the
    // build-time-bundle case (#1043 C-2 codex iter-7 medium) is not
    // currently in the static set; the `seen` guard catches any
    // duplicate that slipped through.
    out.push({
      name: def.name,
      fullName: fullNameFor(def.name),
      description: def.description,
      prompt: promptFor(def),
      endpoint: `/api/plugins/runtime/${encodeURIComponent(plugin.name)}/dispatch`,
      source: "runtime",
    });
    seen.add(def.name);
  }

  return out;
}
