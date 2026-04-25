# Agent backend abstraction (umbrella plan)

Discussion plan for the work that subsumes #567 (Codex CLI backend) and adds **Claude Code SDK** as a third backend. v1 of #567 was scoped CLI-only; this plan widens the abstraction so the SDK fits without a future re-rewrite.

Status: **DRAFT — no code yet**. This file exists to make each design decision visible before any adapter code lands.

## Why widen now

`#567` proposed an `AgentAdapter` interface shaped after the CLI assumption — `spawn(): ChildProcess`, `parseStreamLine(line: string)`. The Claude Code SDK has neither: it's in-process and yields typed events natively. Landing the CLI-shaped interface and then re-flattening it for the SDK would mean two refactors. Widening once now is cheaper.

## Goal

Three backends, one interface:

| backend | binary / package | usage |
|---|---|---|
| `claude-cli` | `claude` (current default) | spawn + JSONL parse |
| `codex-cli` | `codex` (#567) | spawn + JSONL parse, different taxonomy |
| `claude-sdk` | `@anthropic-ai/claude-agent-sdk` | in-process, typed events |

`runAgent()` becomes adapter-agnostic. `--agent <kind>` chooses at startup.

## Interface (proposed)

```ts
// server/agent/adapters/types.ts
export type AgentBackend = "claude-cli" | "codex-cli" | "claude-sdk";

export interface AgentTurnInput {
  message: string;
  role: Role;
  workspacePath: string;
  sessionId: string;
  port: number;
  resumeId?: string;          // backend-specific session id
  attachments?: Attachment[];
  userTimezone?: string;
  abortSignal?: AbortSignal;
  mcpConfig: AgentMcpConfig;
  systemPrompt: string;
}

export interface AgentMcpConfig {
  servers: Record<string, McpServerSpec>;
  /** Tool name allowlist (post-MCP-prefix). null = backend default. */
  allowedTools: string[] | null;
}

export interface AgentAdapter {
  readonly kind: AgentBackend;
  /** Verify env / credentials / cli presence at launcher startup. */
  preflight(): Promise<{ ok: true } | { ok: false; reason: string; remediation: string }>;
  /** Run a single turn; yields AgentEvent until LLM ends or abort fires. */
  runTurn(input: AgentTurnInput): AsyncIterable<AgentEvent>;
  /** Capture the backend's session id from a yielded event so we can persist it for resume. */
  sessionIdFromEvent(event: AgentEvent): string | undefined;
}
```

`AgentEvent` stays the project's existing common-language type from `server/agent/stream.ts`. `parseStreamEvent` moves into `claudeCli` adapter; the other adapters emit `AgentEvent` shapes directly.

## Decision matrix

Each row is a separable call. Defaults marked **★** are what the design assumes unless we change them.

### D1. Interface shape

- a★ Async generator (`AsyncIterable<AgentEvent>`) — matches existing `runAgent`, single-call-site change
- b. callback-based — flexible but bigger rewrite
- c. EventEmitter — Node-native but weak typing

### D2. Auth model

| backend | source |
|---|---|
| `claude-cli` | `~/.claude/credentials.json` (`claude auth login`) |
| `codex-cli` | `~/.codex/auth.json` or env |
| `claude-sdk` | `ANTHROPIC_API_KEY` env (or Bedrock/Vertex profile) |

Strategies:

- A★ launcher preflight, fail-fast with remediation message
- B. preflight on first turn (slow failure)
- C. no preflight (worst UX)

Sub-decisions for SDK:

- Bedrock / Vertex / proxy → env-only for v1, Settings UI for v2
- API key in Settings UI (re-write `.env`?) → out of scope for v1

### D3. MCP config delivery

| backend | mechanism |
|---|---|
| `claude-cli` | JSON file + `--mcp-config <path>` (current) |
| `codex-cli` | scratch `~/.codex-temp/config.toml` + `CODEX_HOME` |
| `claude-sdk` | `mcpServers: {...}` option, no file |

Adapter receives the project's normalised `AgentMcpConfig` and converts to the local format. Temp dir lifecycle is each adapter's own concern.

### D4. Session resume / persistence

`chat/<sessionId>.json` extended:

```json
{ "backend": "codex-cli", "backendSessionId": "thr_abc123" }
```

Legacy `claudeSessionId` stays for backward compat (claude-cli only). Cross-backend resume **not supported** — switching backend mid-session starts a fresh thread + UI warning.

Strategies:

- A★ session is bound to the backend it started on; switching backend invalidates resume
- B. attempt cross-backend translation — high effort, fragile
- C. always start fresh on backend change without warning — confusing

### D5. Image / attachments

| backend | mechanism |
|---|---|
| `claude-cli` | inline `{type:"image",source:base64,...}` in stdin JSON |
| `codex-cli` | `--image <path>`; need temp file |
| `claude-sdk` | content blocks in message, programmatic |

Adapter handles its own conversion. PDFs and non-image attachments use the same plumbing.

### D6. Tool whitelist / permission

| backend | granularity |
|---|---|
| `claude-cli` | per-tool csv via `--allowedTools` |
| `codex-cli` | per-server only (`--sandbox <mode>`) |
| `claude-sdk` | per-tool array option |

Pass `allowedTools: string[] \| null` — codex coarsens to "all enabled servers go through". Document the granularity gap so role authors understand the difference.

### D7. Docker sandbox interaction

Sandbox runs claude-cli inside Docker. SDK is in-process, can't be containerised the same way.

- A★ `claude-sdk` adapter is **not sandbox-compatible**. Settings shows a warning when sandbox is on and SDK is selected. Block the combination in launcher preflight
- B. spawn a node sub-process inside Docker that loads the SDK — heavier, untested
- C. host-side filesystem guards for SDK — duplicates work the sandbox already does

`codex-cli + Docker` stays out of scope (#567 already deferred it).

### D8. Cancellation (Stop button, #731)

| backend | mechanism |
|---|---|
| `claude-cli` | `child.kill('SIGTERM')` (current) |
| `codex-cli` | same |
| `claude-sdk` | SDK's cancel/abort method |

Behaviour difference: SDK abort may flush partial text; CLI is immediate. Adapter normalises to "yield AbortError event then end" so UI handles it uniformly.

### D9. System prompt

| backend | injection |
|---|---|
| `claude-cli` | `--system-prompt <str>` |
| `codex-cli` | **none**; prepend to user message (or scratch `AGENTS.md`) |
| `claude-sdk` | `systemPrompt` option |

#567 already chose prepend for codex; SDK uses native option. Adapter-internal.

### D10. Event normalisation

Existing `AgentEvent` (`server/agent/stream.ts`) is the canonical shape. Each adapter maps its native taxonomy:

- text deltas
- tool_use start / args / result / error
- thinking (claude-only? codex emits something similar; SDK exposes structured)
- session metadata (id, model, usage)
- end-of-turn / stop_reason

Unknown events: ignore by default. If we want forward compat, adapters can yield `{ type: "unknown", raw }` for the View to show a generic placeholder. **TBD per adapter PR.**

### D11. Migration order

Phase 1–5 are individually shippable. Phase 1 leaves user-visible behaviour unchanged (claude-cli only).

```
Phase 0  this plan + design review                1 PR
Phase 1  adapter interface + claude-cli moved     1 PR  (no behaviour change)
Phase 2  claude-sdk adapter                        1 PR
Phase 3  codex-cli adapter                         1 PR  (closes #567)
Phase 4  launcher --agent flag + preflight wiring  1 PR
Phase 5  README / CLAUDE.md / docs/developer.md    1 PR
```

Phase 1 risks: `resumeFailover.ts`, `sandboxMounts.ts` are claude-cli-specific helpers — they move into `adapters/claudeCli/` rather than staying at `server/agent/` root.

### D12. Testing strategy

| layer | claude-cli | codex-cli | claude-sdk |
|---|---|---|---|
| unit (adapter logic) | mock spawn / parse | mock spawn / parse | mock SDK client |
| integration (CI) | existing e2e | claude-stub-equivalent | mock or skip |
| smoke (real binaries) | existing | manual / opt-in | manual / opt-in |

Default CI: claude-cli only. `codex-cli` and `claude-sdk` smoke gated by env (`CODEX_E2E=1` / `ANTHROPIC_API_KEY=...`).

### D13. Package size

`@anthropic-ai/claude-agent-sdk` adds install weight to `mulmoclaude`.

- A. `dependencies` — install size ↑, SDK adapter always available
- B★ `optionalDependencies` — `try/catch` dynamic `import("@anthropic-ai/claude-agent-sdk")`; SDK absent → adapter unavailable but launcher still works
- C. peerDependencies — user installs separately (worst UX)

The smoke / deps audit (#669) already accepts dynamic `import()` with `try/catch` for optional native modules (precedent: `node-pty`).

### D14. UI / Settings

- A★ launcher flag only (`--agent codex` at startup, restart to switch)
- B. live switch in Settings — what about an in-flight session?

v1: A. Settings shows current backend as a read-only badge. Live-switch is v2.

### D15. Telemetry / observability

`log.info("agent", "...")` calls already exist; current messages assume CLI subprocess (`Spawning claude...`, etc.). Re-shape to be backend-agnostic: `log.info("agent", "turn start", { backend, sessionId, model })`. Per-backend specifics drop to `debug` level inside each adapter.

### D16. Documentation

- README: per-backend support matrix + auth setup + known differences
- CLAUDE.md: "default is claude-cli; SDK / codex are opt-in"
- docs/developer.md: adapter interface reference + how to add a fourth backend

## Open questions (need answers before Phase 1 starts)

| Q | options | author preference |
|---|---|---|
| Q1. Launcher flag only (v1) — Settings live-switch later? | A1 launcher only / A2 settings live | **launcher only** |
| Q2. Drop sandbox support for `claude-sdk`? | drop / build-out / host-side guards | **drop, warn at preflight** |
| Q3. SDK as `optionalDependencies`? | dep / optional / peer | **optional** |
| Q4. Cross-backend session resume? | block / translate / silent-fresh | **block, warn UI-side** |
| Q5. Coarsen tool whitelist on codex? | accept coarsening / reject codex when allowedTools needs per-tool | **accept, document gap** |
| Q6. Phase split (6 PRs above) OK? | as-is / coarser / finer | **as-is** |

## What this issue is NOT

- Implementation. Code lands in Phase 1+ PRs, each referencing this umbrella issue.
- Decision on which backend MulmoClaude ships **as default**. claude-cli stays default.
- Bedrock / Vertex / proxy support beyond `ANTHROPIC_API_KEY` env (Phase 2 SDK only honours the env; advanced auth is v2).

## Out of scope (future work)

- `codex-cli + Docker sandbox` (deferred per #567)
- Settings UI for live backend switching
- API key management UI for SDK
- Browser-side SDK (`claude-sdk` running in the Vue app instead of the server)
- Custom adapters (third-party CLI / local LLM)

## Acceptance criteria for the umbrella

The umbrella issue closes when:

- All 6 phases merged
- `npx mulmoclaude --agent <kind>` works for all three backends
- Sandbox + Docker still works on claude-cli
- Cross-backend session-resume warning surfaces correctly in the UI
- Existing e2e suite passes on claude-cli with no diff
- README + CLAUDE.md + docs/developer.md updated

## References

- #567 — feat: optional Codex CLI backend (this plan supersedes its scope, #567 itself becomes Phase 3)
- #731 — Stop button (already shipped; cancellation is one of D8's constraints)
- #779 — server logging audit (telemetry shape from D15 follows the same pattern)
