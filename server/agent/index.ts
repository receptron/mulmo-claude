import { mkdir, unlink } from "fs/promises";
import { writeJsonAtomic } from "../utils/files/json.js";
import { dirname } from "path";
import { resolveSandboxRuntime, type SandboxRuntime } from "../system/docker.js";
import { refreshCredentials } from "../system/credentials.js";
import { loadMcpConfig, loadSettings } from "../system/config.js";
import type { Role } from "../../src/config/roles.js";
import { buildSystemPrompt } from "./prompt.js";
import { loadMemorySnapshot } from "../workspace/memory/snapshot.js";
import { CONTAINER_WORKSPACE_PATH, buildMcpConfig, getActivePlugins, prepareUserServers, resolveMcpConfigPaths, userServerAllowedToolNames } from "./config.js";
import { validateStdioPackages } from "./mcpHealth.js";
import type { Attachment } from "@mulmobridge/protocol";
import type { AgentEvent } from "./stream.js";
import { log } from "../system/logger/index.js";
import { getActiveBackend } from "./backend/index.js";
import type { AgentInput, LLMBackend } from "./backend/index.js";

export interface RunAgentOptions {
  message: string;
  role: Role;
  workspacePath: string;
  sessionId: string;
  port: number;
  claudeSessionId?: string;
  /** When aborted, the spawned Claude CLI process is killed. */
  abortSignal?: AbortSignal;
}

export interface RunAgentInput {
  message: string;
  role: Role;
  workspacePath: string;
  sessionId: string;
  port: number;
  claudeSessionId?: string;
  abortSignal?: AbortSignal;
  attachments?: Attachment[];
  userTimezone?: string;
}

export async function* runAgent(input: RunAgentInput): AsyncGenerator<AgentEvent> {
  const { role, workspacePath } = input;
  const activePlugins = getActivePlugins(role);
  const sandboxRuntime = await resolveSandboxRuntime();
  const useDocker = sandboxRuntime !== null;

  // Per-invocation read so Settings UI changes apply without a server restart.
  const userMcpRaw = loadMcpConfig().mcpServers;
  // `prepareUserServers` may spawn host-side stdio→HTTP gateways for
  // opted-in servers (#1421 Phase B); `mcpShims` MUST be torn down
  // in the finally below or host processes / ports leak.
  const { servers: userServers, shims: mcpShims } = await prepareUserServers(userMcpRaw, useDocker, workspacePath);

  // Shims are live host processes the moment `prepareUserServers`
  // returns. Wrap *all* subsequent setup (credential refresh, memory
  // /prompt prep, MCP config write) so a throw before `runAgent` still
  // tears them down — otherwise host processes / ports leak for the
  // rest of the session.
  try {
    const prepared = await prepareAgentRun(input, { activePlugins, useDocker, sandboxRuntime, userServers });
    try {
      yield* prepared.backend.runAgent(prepared.agentInput);
    } finally {
      if (prepared.hasMcp) unlink(prepared.hostMcpPath).catch(() => {});
    }
  } finally {
    // Tear down any host-side stdio→HTTP shims (#1421 Phase B) —
    // real child processes holding ports. This outer finally also
    // covers a throw during setup (before `runAgent`), which is the
    // main leak risk of the opt-in escape hatch.
    for (const shim of mcpShims) {
      try {
        shim.close();
      } catch {
        // close() is best-effort + idempotent; never let a teardown
        // failure mask the turn's real outcome.
      }
    }
  }
}

interface AgentRunDeps {
  activePlugins: string[];
  useDocker: boolean;
  sandboxRuntime: SandboxRuntime | null;
  userServers: Awaited<ReturnType<typeof prepareUserServers>>["servers"];
}

type McpPaths = ReturnType<typeof resolveMcpConfigPaths>;

interface PreparedAgentRun {
  backend: LLMBackend;
  agentInput: AgentInput;
  hasMcp: boolean;
  hostMcpPath: string;
}

// Assemble everything the backend needs for one turn, in the same
// order the inlined body used to run it: validate user servers +
// refresh credentials, build the system prompt, write the MCP config,
// then build the AgentInput and log the spawn. Non-yielding, so it
// lives outside the generator.
async function prepareAgentRun(input: RunAgentInput, deps: AgentRunDeps): Promise<PreparedAgentRun> {
  const { useDocker, userServers, activePlugins } = deps;
  const hasUserServers = Object.keys(userServers).length > 0;
  const hasMcp = activePlugins.length > 0 || hasUserServers;

  // Catches the "catalog entry pinned to a non-existent npm package" failure where the MCP subprocess never starts and
  // Claude silently falls back to WebSearch. Fire-and-forget; per-package cache amortizes the network round-trip.
  validateStdioPackages(userServers).catch(() => {});

  // macOS sandbox: refresh from Keychain so expired OAuth tokens get replaced transparently.
  if (useDocker && process.platform === "darwin") {
    await refreshCredentials();
  }

  const systemPrompt = await buildFullSystemPrompt(input, useDocker);
  const { mcpPaths, mcpServerNames } = await writeMcpConfig(input, deps, hasMcp);
  const { backend, agentInput } = buildAgentInput(input, deps, { systemPrompt, hasMcp, mcpPaths, mcpServerNames });
  return { backend, agentInput, hasMcp, hostMcpPath: mcpPaths.hostPath };
}

// Load the memory snapshot and assemble the full system prompt for
// this turn, dumping it to the log on the first message of a --debug
// session.
async function buildFullSystemPrompt(input: RunAgentInput, useDocker: boolean): Promise<string> {
  const { role, workspacePath, claudeSessionId, userTimezone } = input;

  // Pre-load memory once (atomic vs topic format chosen inside
  // `loadMemorySnapshot`) so prompt assembly itself stays sync.
  const memorySnapshot = await loadMemorySnapshot(workspacePath);
  const fullSystemPrompt = buildSystemPrompt({
    role,
    workspacePath: useDocker ? CONTAINER_WORKSPACE_PATH : workspacePath,
    useDocker,
    userTimezone,
    memorySnapshot,
  });

  // --debug: dump the full system prompt on the first message of each session.
  if (!claudeSessionId && process.argv.includes("--debug")) {
    log.info("agent", `system prompt for new session:\n${fullSystemPrompt}`);
  }

  return fullSystemPrompt;
}

// Resolve the per-session MCP config paths and, when any MCP server is
// active, write the config file the backend will load. Returns the
// server names for the --debug spawn log.
async function writeMcpConfig(input: RunAgentInput, deps: AgentRunDeps, hasMcp: boolean): Promise<{ mcpPaths: McpPaths; mcpServerNames: string[] }> {
  const { workspacePath, sessionId, port } = input;
  const { activePlugins, useDocker, userServers } = deps;

  const mcpPaths = resolveMcpConfigPaths({
    workspacePath,
    sessionId,
    useDocker,
  });
  if (useDocker) {
    await mkdir(dirname(mcpPaths.hostPath), { recursive: true });
  }

  // Surfaced in the --debug spawn log so developers can verify Settings UI changes reach Claude Code.
  let mcpServerNames: string[] = [];
  if (hasMcp) {
    const mcpConfig = buildMcpConfig({
      chatSessionId: sessionId,
      port,
      activePlugins,
      useDocker,
      userServers,
    });
    mcpServerNames = Object.keys(mcpConfig.mcpServers).sort();
    // Atomic so a concurrent claude spawn can't pick up a half-written file (they share the path under the session dir).
    await writeJsonAtomic(mcpPaths.hostPath, mcpConfig);
  }

  return { mcpPaths, mcpServerNames };
}

// Read per-invocation settings, resolve the active backend, log the
// spawn, and assemble the backend-agnostic AgentInput for this turn.
function buildAgentInput(
  input: RunAgentInput,
  deps: AgentRunDeps,
  args: { systemPrompt: string; hasMcp: boolean; mcpPaths: McpPaths; mcpServerNames: string[] },
): { backend: LLMBackend; agentInput: AgentInput } {
  const { message, role, workspacePath, sessionId, port, claudeSessionId, abortSignal, attachments, userTimezone } = input;
  const { activePlugins, useDocker, sandboxRuntime, userServers } = deps;
  const { systemPrompt, hasMcp, mcpPaths, mcpServerNames } = args;

  // Per-invocation read so allowedTools / MCP-server changes apply without a server restart.
  const settings = loadSettings();
  const userServerAllowedTools = userServerAllowedToolNames(userServers, useDocker);

  // Boolean presence flags only — never write raw sessionId into long-lived log sinks.
  const backend = getActiveBackend();
  const spawnLog: Record<string, unknown> = {
    backend: backend.id,
    roleId: role.id,
    useDocker,
    hasMcp,
    resumed: Boolean(claudeSessionId),
    hasSessionId: Boolean(sessionId),
  };
  // --debug only: kept off the default log to avoid leaking user MCP server names into long-lived sinks.
  if (process.argv.includes("--debug") && hasMcp) {
    spawnLog.mcpServers = mcpServerNames;
  }
  log.info("agent", "spawning agent", spawnLog);

  const agentInput: AgentInput = {
    systemPrompt,
    message,
    role,
    workspacePath,
    sessionId,
    port,
    sessionToken: claudeSessionId,
    attachments,
    activePlugins,
    mcpConfigPath: hasMcp ? mcpPaths.argPath : undefined,
    extraAllowedTools: [...settings.extraAllowedTools, ...userServerAllowedTools],
    effortLevel: settings.effortLevel,
    abortSignal,
    userTimezone,
    useDocker,
    sandboxRuntime: sandboxRuntime ?? undefined,
  };
  return { backend, agentInput };
}
