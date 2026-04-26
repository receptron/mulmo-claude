// LLM backend abstraction. Today the only implementation is
// ClaudeCodeBackend (server/agent/backend/claude-code.ts), which spawns
// the `claude` CLI as a subprocess. The interface exists so future
// backends (OpenAI, Ollama native, Gemini, etc.) can plug in here
// without the orchestrator in server/agent/index.ts knowing which one
// is active.
//
// See plans/refactor-llm-backend-abstraction.md for the broader plan.

import type { Attachment } from "@mulmobridge/protocol";
import type { Role } from "../../../src/config/roles.js";
import type { AgentEvent } from "../stream.js";

/** Inputs the orchestrator passes to a backend for one user turn.
 *  The orchestrator owns role expansion, system prompt building, and
 *  MCP config writing. The backend owns the LLM call itself plus
 *  translation of provider-specific stream events into AgentEvent. */
export interface AgentInput {
  systemPrompt: string;
  message: string;
  role: Role;
  workspacePath: string;
  sessionId: string;
  port: number;
  /** Opaque, backend-specific resume token. For Claude this is the
   *  CLI's session id passed to --resume; other backends may
   *  interpret it differently or ignore it entirely
   *  (capabilities.sessionResume === false). */
  sessionToken?: string;
  attachments?: Attachment[];
  /** Active MCP plugin names (the subset of role.availablePlugins
   *  that is actually registered as an MCP plugin). The orchestrator
   *  has already filtered these — backends should not re-derive. */
  activePlugins: string[];
  /** When set, the path the backend should hand to its MCP loader.
   *  Pre-resolved for host-vs-container by the orchestrator. */
  mcpConfigPath?: string;
  /** Extra allowed-tool names from settings + user MCP servers. */
  extraAllowedTools: string[];
  /** When fired, the backend must terminate any in-flight
   *  subprocess / connection. */
  abortSignal?: AbortSignal;
  userTimezone?: string;
  /** Whether the orchestrator detected a usable Docker sandbox.
   *  Backends that don't sandbox can ignore. */
  useDocker: boolean;
}

export interface BackendCapabilities {
  /** Can the backend resume a prior conversation by an opaque token?
   *  Claude: yes (--resume <id>). OpenAI / Ollama: no — the
   *  orchestrator must replay transcript instead. */
  sessionResume: boolean;
  /** Does the backend speak MCP natively? Claude: yes. Others:
   *  emulate or skip. Today only Claude consumes activePlugins /
   *  mcpConfigPath. */
  mcp: boolean;
}

/** Tuning profile names for one-shot LLM calls (generate /
 *  generateStructured). Each backend has a tuning module
 *  (e.g. claude-code.tuning.ts) mapping every name in this union to
 *  its own knob vocabulary — enforced at compile time via
 *  `satisfies Record<ProfileName, ...>` in each tuning module.
 *  Adding a new profile here is a 2-step change: extend the union
 *  AND add the entry to every backend's tuning module. */
export type ProfileName = "journal-archivist" | "chat-index-summary" | "source-classify" | "source-summarize";

/** Inputs for one-shot generation calls. The portable surface is
 *  intentionally tiny: backend-specific tuning (model, budget cap,
 *  output format, isolation, timeout) is looked up by `profile` in
 *  the active backend's tuning module rather than passed here. */
export interface GenerateInput {
  systemPrompt: string;
  userPrompt: string;
  profile: ProfileName;
}

/** Thrown when the configured backend isn't available on this host
 *  (e.g. `claude` CLI missing on PATH for ClaudeCodeBackend). Each
 *  caller decides what to do — journal disables itself for the
 *  rest of the server lifetime; chat-index / sources log and skip.
 *
 *  Re-exported from server/workspace/journal/archivist-cli.ts as
 *  `ClaudeCliNotFoundError` for back-compat with existing catch
 *  sites (same class, two names). */
export class LLMBackendUnavailableError extends Error {
  constructor(message: string = "LLM backend is not available") {
    super(message);
    this.name = "LLMBackendUnavailableError";
  }
}

export interface LLMBackend {
  readonly id: string;
  readonly capabilities: BackendCapabilities;
  /** Run one user turn. Yields portable AgentEvents. */
  runAgent(input: AgentInput): AsyncIterable<AgentEvent>;
  /** One-shot text generation (no tools, no streaming). Throws if
   *  the profile's tuning declares structured output. */
  generate(input: GenerateInput): Promise<string>;
  /** One-shot structured generation against a JSON schema. Throws
   *  if the profile's tuning declares free-text output. The schema
   *  is the JSON Schema object the backend hands to its provider
   *  (Claude: --json-schema; OpenAI: response_format; etc.). */
  generateStructured<T>(input: GenerateInput, schema: object): Promise<T>;
}
