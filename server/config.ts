// Workspace-scoped user settings, loaded fresh on every agent
// invocation so the UI can change things without a server restart.
//
// Layout under <workspace>/configs/:
//   settings.json   ← AppSettings (this file)
//   mcp.json        ← Phase 2 (not yet read by runtime)
//
// All helpers tolerate missing / malformed files by falling back to
// defaults. Writers perform an atomic replace (tmp + rename) so a
// reader never observes a half-written file.

import fs from "fs";
import path from "path";
import { log } from "./logger/index.js";
import { workspacePath } from "./workspace.js";

export interface AppSettings {
  // Extra tool names appended to BASE_ALLOWED_TOOLS in
  // server/agent/config.ts#buildCliArgs. Typical entries are
  // Claude Code built-in MCP prefixes like
  //   "mcp__claude_ai_Gmail"
  //   "mcp__claude_ai_Google_Calendar"
  extraAllowedTools: string[];
}

const DEFAULT_SETTINGS: AppSettings = { extraAllowedTools: [] };

export const CONFIGS_DIR_NAME = "configs";
export const SETTINGS_FILE_NAME = "settings.json";
export const MCP_FILE_NAME = "mcp.json";

export function configsDir(): string {
  return path.join(workspacePath, CONFIGS_DIR_NAME);
}

export function settingsPath(): string {
  return path.join(configsDir(), SETTINGS_FILE_NAME);
}

export function mcpConfigPath(): string {
  return path.join(configsDir(), MCP_FILE_NAME);
}

export function ensureConfigsDir(): void {
  fs.mkdirSync(configsDir(), { recursive: true });
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

export function isAppSettings(value: unknown): value is AppSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return isStringArray(candidate.extraAllowedTools);
}

export function loadSettings(): AppSettings {
  const file = settingsPath();
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
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
    log.warn(
      "config",
      "settings.json does not match AppSettings schema — using defaults",
      { file },
    );
    return { ...DEFAULT_SETTINGS };
  }
  // Defensive copy — callers shouldn't be able to mutate the file on
  // disk via the returned object.
  return { extraAllowedTools: [...parsed.extraAllowedTools] };
}

// Atomic write: serialize, write to a sibling tmp file, then rename.
// rename(2) is atomic on POSIX; on Windows Node's implementation
// falls back to a copy+unlink which is still safer than truncating
// the target in place.
function atomicWrite(file: string, content: string): void {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, { encoding: "utf-8", mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function saveSettings(settings: AppSettings): void {
  if (!isAppSettings(settings)) {
    throw new Error("saveSettings: invalid AppSettings shape");
  }
  ensureConfigsDir();
  const serialised = JSON.stringify(
    { extraAllowedTools: [...settings.extraAllowedTools] },
    null,
    2,
  );
  atomicWrite(settingsPath(), `${serialised}\n`);
}

// ── MCP user-defined servers ────────────────────────────────────
//
// Stored under <workspace>/configs/mcp.json in the Claude CLI's
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

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((v) => typeof v === "string");
}

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
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  if (c.type !== "http") return false;
  if (typeof c.url !== "string" || !isHttpUrl(c.url)) return false;
  if (c.headers !== undefined && !isStringRecord(c.headers)) return false;
  if (c.enabled !== undefined && typeof c.enabled !== "boolean") return false;
  return true;
}

export function isMcpStdioSpec(value: unknown): value is McpStdioSpec {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  if (c.type !== "stdio") return false;
  if (typeof c.command !== "string" || c.command.length === 0) return false;
  if (!STDIO_COMMAND_ALLOWLIST.has(c.command)) return false;
  if (c.args !== undefined) {
    if (!Array.isArray(c.args)) return false;
    if (!c.args.every((a) => typeof a === "string")) return false;
  }
  if (c.env !== undefined && !isStringRecord(c.env)) return false;
  if (c.enabled !== undefined && typeof c.enabled !== "boolean") return false;
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
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  const servers = c.mcpServers;
  if (typeof servers !== "object" || servers === null) return false;
  if (Array.isArray(servers)) return false;
  for (const [id, spec] of Object.entries(servers)) {
    if (!isMcpServerId(id)) return false;
    if (!isMcpServerSpec(spec)) return false;
  }
  return true;
}

export function loadMcpConfig(): McpConfigFile {
  const file = mcpConfigPath();
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch {
    return { mcpServers: { ...DEFAULT_MCP.mcpServers } };
  }
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
    log.warn(
      "config",
      "mcp.json does not match McpConfigFile schema — using defaults",
      { file },
    );
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
  atomicWrite(mcpConfigPath(), `${serialised}\n`);
}

// Flatten storage form to UI-friendly array.
export function toMcpEntries(cfg: McpConfigFile): McpServerEntry[] {
  return Object.entries(cfg.mcpServers).map(([id, spec]) => ({ id, spec }));
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
