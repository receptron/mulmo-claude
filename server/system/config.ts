// Workspace-scoped user settings, loaded fresh on every agent
// invocation so the UI can change things without a server restart.
//
// Layout under <workspace>/config/ (post-#284):
//   settings.json   ← AppSettings (this file)
//   mcp.json        ← user-defined MCP servers
//
// All helpers tolerate missing / malformed files by falling back to
// defaults. Writers perform an atomic replace (tmp + rename) so a
// reader never observes a half-written file.

import { mkdirSync } from "fs";
import path from "path";
import { log } from "./logger/index.js";
import { WORKSPACE_PATHS } from "../workspace/paths.js";
import { writeFileAtomicSync } from "../utils/files/atomic.js";
import { readTextSafeSync } from "../utils/files/safe.js";
import { isRecord, isStringArray, isStringRecord } from "../utils/types.js";

export interface AppSettings {
  // Extra tool names appended to BASE_ALLOWED_TOOLS in
  // server/agent/config.ts#buildCliArgs. Typical entries are
  // Claude Code built-in MCP prefixes like
  //   "mcp__claude_ai_Gmail"
  //   "mcp__claude_ai_Google_Calendar"
  extraAllowedTools: string[];
}

const DEFAULT_SETTINGS: AppSettings = { extraAllowedTools: [] };

export const SETTINGS_FILE_NAME = "settings.json";
export const MCP_FILE_NAME = "mcp.json";

export function configsDir(): string {
  return WORKSPACE_PATHS.configs;
}

export function settingsPath(): string {
  return path.join(configsDir(), SETTINGS_FILE_NAME);
}

export function mcpConfigPath(): string {
  return path.join(configsDir(), MCP_FILE_NAME);
}

export function ensureConfigsDir(): void {
  mkdirSync(configsDir(), { recursive: true });
}

export function isAppSettings(value: unknown): value is AppSettings {
  if (!isRecord(value)) return false;
  return isStringArray(value.extraAllowedTools);
}

export function loadSettings(): AppSettings {
  const file = settingsPath();
  const raw = readTextSafeSync(file);
  if (raw === null) return { ...DEFAULT_SETTINGS };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    log.warn("config", "settings.json is not valid JSON — using defaults", {
      file,
      error: String(err),
    });
    return { ...DEFAULT_SETTINGS };
  }
  if (!isAppSettings(parsed)) {
    log.warn("config", "settings.json does not match AppSettings schema — using defaults", { file });
    return { ...DEFAULT_SETTINGS };
  }
  // Defensive copy — callers shouldn't be able to mutate the file on
  // disk via the returned object.
  return { extraAllowedTools: [...parsed.extraAllowedTools] };
}

export function saveSettings(settings: AppSettings): void {
  if (!isAppSettings(settings)) {
    throw new Error("saveSettings: invalid AppSettings shape");
  }
  ensureConfigsDir();
  const serialised = JSON.stringify({ extraAllowedTools: [...settings.extraAllowedTools] }, null, 2);
  writeFileAtomicSync(settingsPath(), `${serialised}\n`, { mode: 0o600 });
}

// ── MCP user-defined servers ────────────────────────────────────
//
// Stored under <workspace>/config/mcp.json in the Claude CLI's
// standard `--mcp-config` shape so the file is portable:
//   { "mcpServers": { "<id>": <McpServerSpec> } }
//
// A server is either HTTP (remote, always Docker-safe) or stdio
// (local command). See plans/done/feat-web-settings-ui.md for Phase 2a /
// 2b scope notes.

export interface McpHttpSpec {
  type: "http";
  url: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

export interface McpStdioSpec {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

export type McpServerSpec = McpHttpSpec | McpStdioSpec;

// UI-friendly flat array form. Storage uses the record form; conversion
// helpers below keep the two in sync.
export interface McpServerEntry {
  id: string;
  spec: McpServerSpec;
}

export interface McpConfigFile {
  mcpServers: Record<string, McpServerSpec>;
}

const DEFAULT_MCP: McpConfigFile = { mcpServers: {} };

// Accepts only allow-listed commands for stdio servers — user input
// that asks Claude to spawn arbitrary binaries (eg. a shell one-liner)
// is rejected upstream. Anything that needs more tools should go in
// the sandbox image (see #162), not here.
const STDIO_COMMAND_ALLOWLIST = new Set(["npx", "node", "tsx"]);

// Accept only http: / https: URLs. Rejects malformed strings, other
// protocols (ftp:, file:, javascript:, ...), and empty values so bad
// endpoints can't be persisted even if a client bypasses the UI.
function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function isMcpHttpSpec(value: unknown): value is McpHttpSpec {
  if (!isRecord(value)) return false;

  if (value.type !== "http") return false;
  if (typeof value.url !== "string" || !isHttpUrl(value.url)) return false;
  if (value.headers !== undefined && !isStringRecord(value.headers)) return false;
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") return false;
  return true;
}

export function isMcpStdioSpec(value: unknown): value is McpStdioSpec {
  if (!isRecord(value)) return false;

  if (value.type !== "stdio") return false;
  if (typeof value.command !== "string" || value.command.length === 0) return false;
  if (!STDIO_COMMAND_ALLOWLIST.has(value.command)) return false;
  if (value.args !== undefined && !isStringArray(value.args)) return false;
  if (value.env !== undefined && !isStringRecord(value.env)) return false;
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") return false;
  return true;
}

export function isMcpServerSpec(value: unknown): value is McpServerSpec {
  return isMcpHttpSpec(value) || isMcpStdioSpec(value);
}

// Workspace id must be slug-shaped so it survives being used as the
// mcpServers map key and in the `mcp__<id>__<tool>` tool naming.
const MCP_ID_RE = /^[a-z][a-z0-9_-]{0,63}$/;

export function isMcpServerId(value: unknown): value is string {
  return typeof value === "string" && MCP_ID_RE.test(value);
}

export function isMcpConfigFile(value: unknown): value is McpConfigFile {
  if (!isRecord(value)) return false;

  const servers = value.mcpServers;
  if (!isRecord(servers)) return false;
  for (const [serverId, spec] of Object.entries(servers)) {
    if (!isMcpServerId(serverId)) return false;
    if (!isMcpServerSpec(spec)) return false;
  }
  return true;
}

export function loadMcpConfig(): McpConfigFile {
  const file = mcpConfigPath();
  const raw = readTextSafeSync(file);
  if (raw === null) return { mcpServers: { ...DEFAULT_MCP.mcpServers } };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    log.warn("config", "mcp.json is not valid JSON — using defaults", {
      file,
      error: String(err),
    });
    return { mcpServers: {} };
  }
  if (!isMcpConfigFile(parsed)) {
    log.warn("config", "mcp.json does not match McpConfigFile schema — using defaults", { file });
    return { mcpServers: {} };
  }
  return parsed;
}

export function saveMcpConfig(cfg: McpConfigFile): void {
  if (!isMcpConfigFile(cfg)) {
    throw new Error("saveMcpConfig: invalid McpConfigFile shape");
  }
  ensureConfigsDir();
  const serialised = JSON.stringify(cfg, null, 2);
  writeFileAtomicSync(mcpConfigPath(), `${serialised}\n`, { mode: 0o600 });
}

// Flatten storage form to UI-friendly array.
export function toMcpEntries(cfg: McpConfigFile): McpServerEntry[] {
  return Object.entries(cfg.mcpServers).map(([serverId, spec]) => ({ id: serverId, spec }));
}

// Re-inflate UI-friendly array to storage form. Duplicate ids are
// rejected so the record shape stays lossless.
export function fromMcpEntries(entries: McpServerEntry[]): McpConfigFile {
  const out: Record<string, McpServerSpec> = {};
  for (const { id, spec } of entries) {
    if (!isMcpServerId(id)) {
      throw new Error(`invalid MCP server id: ${JSON.stringify(id)}`);
    }
    if (id in out) {
      throw new Error(`duplicate MCP server id: ${id}`);
    }
    if (!isMcpServerSpec(spec)) {
      throw new Error(`invalid MCP server spec for id ${id}`);
    }
    out[id] = spec;
  }
  return { mcpServers: out };
}
