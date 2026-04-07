import { join } from "path";
import type { Role } from "../../src/config/roles.js";
import { mcpTools, isMcpToolEnabled } from "../mcp-tools/index.js";
import { MCP_PLUGIN_NAMES } from "../plugin-names.js";

const BASE_ALLOWED_TOOLS = [
  "Bash",
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
];

const MCP_PLUGINS = new Set([
  ...MCP_PLUGIN_NAMES,
  ...mcpTools.filter(isMcpToolEnabled).map((t) => t.definition.name),
]);

export function getActivePlugins(role: Role): string[] {
  return role.availablePlugins.filter((p) => MCP_PLUGINS.has(p));
}

export interface McpConfigParams {
  sessionId: string;
  port: number;
  activePlugins: string[];
  roleIds: string[];
}

export function buildMcpConfig(params: McpConfigParams): object {
  const { sessionId, port, activePlugins, roleIds } = params;
  return {
    mcpServers: {
      mulmoclaude: {
        command: join(process.cwd(), "node_modules/.bin/tsx"),
        args: [join(process.cwd(), "server/mcp-server.ts")],
        env: {
          SESSION_ID: sessionId,
          PORT: String(port),
          PLUGIN_NAMES: activePlugins.join(","),
          ROLE_IDS: roleIds.join(","),
        },
      },
    },
  };
}

export interface CliArgsParams {
  systemPrompt: string;
  activePlugins: string[];
  claudeSessionId?: string;
  message: string;
  mcpConfigPath?: string;
}

export function buildCliArgs(params: CliArgsParams): string[] {
  const {
    systemPrompt,
    activePlugins,
    claudeSessionId,
    message,
    mcpConfigPath,
  } = params;

  const mcpToolNames = activePlugins.map((p) => `mcp__mulmoclaude__${p}`);
  const allowedTools = [...BASE_ALLOWED_TOOLS, ...mcpToolNames];

  const args = [
    "--output-format",
    "stream-json",
    "--verbose",
    "--system-prompt",
    systemPrompt,
    "--allowedTools",
    allowedTools.join(","),
  ];

  if (claudeSessionId) {
    args.push("--resume", claudeSessionId);
  }

  args.push("-p", message);

  if (mcpConfigPath) {
    args.push("--mcp-config", mcpConfigPath);
  }

  return args;
}
