# refactor: LLM backend abstraction

## Goal

Make the server-side agent loop pluggable so MulmoClaude can later support backends other than Claude Code (OpenAI Codex, Ollama native, Gemini API, etc.). Today the agent loop is hard-wired to spawn the `claude` CLI as a subprocess. We want a single seam — an `LLMBackend` interface — that everything above the seam talks to, and a `ClaudeCodeBackend` adapter that preserves today's behavior exactly.

This plan is the **first of three** PRs. It is a **pure refactor — no behavior change.**

## Background

The server already has thinner Claude coupling than you might expect:

- **No Anthropic SDK imports.** Everything goes through `spawn("claude", ...)`.
- **Event format is already abstracted.** `AgentEvent` (`server/agent/stream.ts`) and `SseEvent` (`src/types/sse.ts`) carry no SDK types to the frontend.
- **Tool schemas are portable** (`gui-chat-protocol`'s JSON-Schema-based `ToolDefinition`).
- **MCP is vendor-neutral** — other backends can either speak MCP or call MulmoClaude's `/api/...` endpoints directly the way `mcp-server.ts` does today.

The Claude-specific surface is concentrated in just a few files:

| File | What's Claude-specific |
|---|---|
| `server/agent/index.ts` | `spawnClaude()`, `readAgentEvents()` (parses Claude CLI JSON), `runAgent()` orchestrator |
| `server/agent/config.ts` | `buildCliArgs()` (Claude CLI flags), `buildDockerSpawnArgs()`, `buildUserMessageLine()` (stream-JSON input) |
| `server/agent/stream.ts` | `createStreamParser()` translating Claude CLI events → portable `AgentEvent` |
| `server/agent/resumeFailover.ts` | Stale-`--resume` recovery, only meaningful for Claude |
| `server/api/routes/agent.ts` | Reads/writes `claudeSessionId` in session meta; orchestrates `runAgent()` |
| Three auxiliary CLI calls | `journal/archivist-cli.ts`, `chat-index/summarizer.ts`, `sources/classifier.ts` (all `spawn("claude", ...)`) |

## Out of scope (for this PR)

- **Auxiliary CLI calls** (journal / chat-index / sources). Migrating those is PR #2 — they already accept injectable summarize functions, so it's a small isolated change.
- **A second backend.** That's PR #3 and is what actually validates the interface. Expect interface refinements then.
- **Renaming `claudeSessionId` → `llmSessionToken`.** This touches `@mulmobridge/protocol` (a published wire-format) and 15 files. Deferred to a small follow-up PR after #1 lands.
- **Migrating the existing `feat-mulmoclaude-ollama-support.md` plan.** That plan takes a different approach — env-passthrough to leverage Claude Code CLI's Anthropic-compat mode. Both can coexist; the env-passthrough route stays useful for Anthropic-compatible endpoints, and the abstraction below is what unlocks non-Anthropic-shaped backends (OpenAI function calling, Gemini, etc.).

## Design

### The interface

New file: `server/agent/backend/types.ts`

```typescript
import type { Attachment } from "@mulmobridge/protocol";
import type { Role } from "../../../src/config/roles.js";
import type { AgentEvent } from "../stream.js";

/** Inputs the orchestrator passes to a backend for one user turn.
 *  The orchestrator owns role expansion, system prompt building, and
 *  MCP config writing. The backend owns spawn / SDK call + stream
 *  translation into AgentEvent. */
export interface AgentInput {
  systemPrompt: string;
  message: string;
  role: Role;
  workspacePath: string;
  sessionId: string;
  port: number;
  /** Opaque, backend-specific resume token. For Claude this is the
   *  CLI's session id; other backends interpret it differently or
   *  ignore it entirely (capabilities.sessionResume === false). */
  sessionToken?: string;
  attachments?: Attachment[];
  /** Active MCP plugin names (subset of role.availablePlugins that
   *  is registered in MCP_PLUGINS). The orchestrator already filtered
   *  these — backends should not re-derive. */
  activePlugins: string[];
  /** When set, the path the backend should hand to its MCP loader.
   *  Pre-resolved for host-vs-container by the orchestrator. */
  mcpConfigPath?: string;
  /** Extra allowed-tool names from settings + user MCP servers. */
  extraAllowedTools: string[];
  /** When fired, the backend must terminate any in-flight subprocess
   *  / connection. */
  abortSignal?: AbortSignal;
  userTimezone?: string;
}

export interface BackendCapabilities {
  /** Can the backend resume a prior conversation by an opaque token?
   *  Claude: yes (--resume <id>). OpenAI: no. Ollama: no. Used by
   *  the orchestrator to decide whether to replay transcript instead. */
  sessionResume: boolean;
  /** Does the backend speak MCP natively? Claude: yes. Others: emulate
   *  or skip. Today only Claude consumes activePlugins / mcpConfigPath. */
  mcp: boolean;
}

export interface LLMBackend {
  readonly id: string;
  readonly capabilities: BackendCapabilities;
  /** Run one user turn. Yields portable AgentEvents. */
  runAgent(input: AgentInput): AsyncIterable<AgentEvent>;
}
```

Note: the interface is intentionally narrow. Auxiliary "summarize one shot" calls (PR #2) get a separate `generate` / `generateStructured` pair on a future expansion of this interface; we don't add them now because we don't need them yet and shapes are clearer once we have the second backend.

### The adapter

New file: `server/agent/backend/claude-code.ts`

`ClaudeCodeBackend` owns everything that's currently in `spawnClaude()`, `readAgentEvents()`, `buildCliArgs()`, `buildDockerSpawnArgs()`, `buildUserMessageLine()`, and `createStreamParser()`. The functions don't move physically — they stay in `server/agent/{config,stream}.ts` because they're testable utilities — the adapter just **calls** them. This keeps the diff small and the existing tests untouched.

```typescript
export const claudeCodeBackend: LLMBackend = {
  id: "claude-code",
  capabilities: { sessionResume: true, mcp: true },
  async *runAgent(input) {
    // existing spawnClaude + readAgentEvents flow, lifted from index.ts
  },
};
```

### The factory

New file: `server/agent/backend/index.ts`

```typescript
export function getActiveBackend(): LLMBackend {
  // Today: always claude-code. Future: switch on env / settings.
  return claudeCodeBackend;
}
```

A factory rather than a direct export so PR #3 can flip on env without touching every call site.

### Rewired orchestrator

`runAgent()` in `server/agent/index.ts` keeps its signature and responsibilities — the orchestrator still:

1. Filters role plugins
2. Loads user MCP servers + checks Docker availability
3. Refreshes credentials (macOS sandbox)
4. Builds the full system prompt
5. Writes the MCP config file
6. Loads settings (extra allowed tools)

…but instead of building CLI args + spawning + streaming itself, it builds an `AgentInput` and calls `getActiveBackend().runAgent(input)`. Yields the events through unchanged.

The stale-`--resume` recovery in `server/api/routes/agent.ts` stays where it is (Claude-specific failure mode, can be moved into the backend later when a non-Claude backend exists to compare against).

## File-level changes

**New files:**

- `server/agent/backend/types.ts` — interface + types
- `server/agent/backend/claude-code.ts` — Claude adapter (calls existing helpers)
- `server/agent/backend/index.ts` — `getActiveBackend()` factory

**Modified files:**

- `server/agent/index.ts` — `runAgent()` keeps its signature but delegates the spawn/stream half to the active backend. `spawnClaude()` and `readAgentEvents()` move into the adapter.

**Untouched** (verifies the boundary is right):

- `server/agent/config.ts`
- `server/agent/stream.ts`
- `server/agent/prompt.ts`
- `server/agent/resumeFailover.ts`
- `server/api/routes/agent.ts`
- All tests under `test/agent/`

## Sequencing inside this PR

1. Add `server/agent/backend/types.ts` (pure types)
2. Add `server/agent/backend/claude-code.ts` (lifts `spawnClaude` + `readAgentEvents` from `index.ts`)
3. Add `server/agent/backend/index.ts` (factory)
4. Rewire `runAgent()` in `index.ts` to build `AgentInput` and delegate
5. Run `yarn format && yarn lint && yarn typecheck && yarn build && yarn test`

## Acceptance criteria

- `yarn typecheck`, `yarn lint`, `yarn build`, `yarn test` all pass
- `runAgent()` keeps the same exported signature
- No behavior change observable from `server/api/routes/agent.ts` or tests
- `server/agent/backend/types.ts` is the only file imported by any future second backend
- `git grep "spawn.*claude"` outside `server/agent/backend/` and the three auxiliary files returns zero hits

## Follow-up PRs (not in this one)

- **PR #2:** Migrate `journal/archivist-cli.ts`, `chat-index/summarizer.ts`, `sources/classifier.ts` to a `generate` / `generateStructured` extension of `LLMBackend`. Three files, all already test-injectable.
- **PR #2.5 (optional):** Rename `claudeSessionId` → `llmSessionToken` across server, tests, and `@mulmobridge/protocol`. Wire-format change — coordinate package version bump.
- **PR #3:** Add a second backend (probably OpenAI). Real validation of the interface; expect refinements.

## Risks

- The orchestrator/backend split has to put MCP config writing on the *orchestrator* side (it's filesystem state, not LLM call), but `mcpConfigPath` only matters to the Claude adapter. That's OK as long as we keep `BackendCapabilities.mcp` and let other adapters ignore the field.
- `BackendCapabilities` is meant to be honest, not enforcing. The orchestrator may grow `if (backend.capabilities.sessionResume) { ... }` branches over time. That's the right place for them; resist the temptation to push them into adapters as no-ops.
- The interface is provisional. Don't optimize for it being perfect on PR #1 — it will refine in PR #3.
