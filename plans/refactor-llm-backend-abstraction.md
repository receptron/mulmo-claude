# refactor: LLM backend abstraction

## Goal

Make the server-side agent loop pluggable so MulmoClaude can later support backends other than Claude Code (OpenAI Codex, Ollama native, Gemini API, etc.). Today the agent loop is hard-wired to spawn the `claude` CLI as a subprocess. We want a single seam — an `LLMBackend` interface — that everything above the seam talks to, and a `ClaudeCodeBackend` adapter that preserves today's behavior exactly.

## Status

| PR | Scope | Status |
|---|---|---|
| #1 | Define `LLMBackend`, extract `ClaudeCodeBackend`, rewire `runAgent` | **Landed** (`3254f0f8`) |
| #2 | Migrate journal / chat-index / sources to `backend.generate` + per-backend tuning config | **In progress** |
| #3 | Add a second backend (probably OpenAI) — real validation of the interface | Not started |

Other deferred work tracked at the end of this doc.

## Background

The server already has thinner Claude coupling than you might expect:

- **No Anthropic SDK imports.** Everything goes through `spawn("claude", ...)`.
- **Event format is already abstracted.** `AgentEvent` (`server/agent/stream.ts`) and `SseEvent` (`src/types/sse.ts`) carry no SDK types to the frontend.
- **Tool schemas are portable** (`gui-chat-protocol`'s JSON-Schema-based `ToolDefinition`).
- **MCP is vendor-neutral** — other backends can either speak MCP or call MulmoClaude's `/api/...` endpoints directly the way `mcp-server.ts` does today.

After PR #1 the Claude-specific surface is concentrated in:

| File | What's Claude-specific |
|---|---|
| `server/agent/backend/claude-code.ts` | Spawn + stream-JSON parse for the agent loop |
| `server/agent/config.ts` | `buildCliArgs()`, `buildDockerSpawnArgs()`, `buildUserMessageLine()` |
| `server/agent/stream.ts` | `createStreamParser()` translating Claude CLI events → portable `AgentEvent` |
| `server/agent/resumeFailover.ts` | Stale-`--resume` recovery |
| `server/api/routes/agent.ts` | Reads/writes `claudeSessionId` in session meta |
| `server/workspace/journal/archivist-cli.ts` | One-shot `claude -p` for journal summarization |
| `server/workspace/chat-index/summarizer.ts` | One-shot `claude --json-schema` for session titles |
| `server/workspace/sources/classifier.ts` | One-shot `claude --json-schema` for source classification |
| `server/workspace/sources/pipeline/summarize.ts` | One-shot `claude --output-format json` for daily-brief markdown |

The first five are agent-loop concerns and stay where they are. The last four are the auxiliary callers PR #2 migrates.

---

## PR #1 — landed

The shipped design (for reference):

### Interface (`server/agent/backend/types.ts`)

```typescript
export interface LLMBackend {
  readonly id: string;
  readonly capabilities: BackendCapabilities;
  runAgent(input: AgentInput): AsyncIterable<AgentEvent>;
}
```

`AgentInput` carries `systemPrompt`, `message`, `role`, MCP config path, attachments, abort signal, and an opaque `sessionToken` (today: the Claude CLI's session id; tomorrow: whatever the backend uses for resume).

### Adapter (`server/agent/backend/claude-code.ts`)

Owns the spawn + stream-JSON parser. Pure helpers (`buildCliArgs`, `buildDockerSpawnArgs`, `buildUserMessageLine`, `createStreamParser`) stay in their existing home so `test/agent/` keeps working unchanged.

### Factory (`server/agent/backend/index.ts`)

```typescript
export function getActiveBackend(): LLMBackend {
  return claudeCodeBackend;  // Future: switch on env / settings.
}
```

### Result

`server/agent/index.ts` shrunk from 266 → 132 lines. `runAgent()` keeps its signature; the spawn/stream half delegates to `backend.runAgent(input)`.

---

## PR #2 — auxiliary callers via tuning config

### Why a separate tuning file per backend

The three auxiliary callers each have backend-specific knobs: `--model haiku`, `--max-budget-usd 0.15`, `--no-session-persistence`, `cwd: tmpdir()` to skip project context. An earlier sketch tried to lift those into a portable `tier: "fast"` / `maxBudgetUsd?: number` shape on `GenerateInput`. That just put Claude-shaped concepts in a hat and called them portable — adapters for OpenAI / Ollama / Gemini would have to ignore the budget cap, invent a "fast tier" mapping, etc.

The fix: **the portable surface carries only a profile name; each backend has its own tuning file.** The set of profile names is shared across backends (caller picks one); the knobs are not (each backend's tuning file uses its own vocabulary). Different vocabularies don't pretend to translate.

### Interface extension (`server/agent/backend/types.ts`)

```typescript
/** Tuning profile names. Each backend's tuning file must have an
 *  entry for every name in this union — enforced at compile time
 *  via `satisfies Record<ProfileName, ...>` in each backend's
 *  tuning module. */
export type ProfileName =
  | "journal-archivist"
  | "chat-index-summary"
  | "source-classify"
  | "source-summarize";

export interface GenerateInput {
  systemPrompt: string;
  userPrompt: string;
  profile: ProfileName;
}

export interface LLMBackend {
  // ... existing runAgent
  generate(input: GenerateInput): Promise<string>;
  generateStructured<T>(input: GenerateInput, schema: object): Promise<T>;
}
```

`generate` is for free-text output (today: journal-archivist, source-summarize). `generateStructured` is for JSON-schema-constrained output (today: chat-index-summary, source-classify). Each backend decides which one matches the profile and throws if the wrong method is called.

### Per-backend tuning module

`server/agent/backend/claude-code.tuning.ts`:

```typescript
import { ONE_MINUTE_MS } from "../../utils/time.js";
import type { ProfileName } from "./types.js";

interface ClaudeCodeProfile {
  /** Three Claude-CLI invocation shapes the four callers use today:
   *   - "text-stdin": prompt via stdin, --output-format text
   *     (journal: prompts can be huge, no envelope needed)
   *   - "text-envelope": prompt via argv -p, --output-format json
   *     without --json-schema; adapter extracts envelope.result
   *     (sources/pipeline/summarize: free-form markdown but wants
   *     structured-error detection on stdout)
   *   - "json-schema": prompt via argv -p, --output-format json
   *     with --json-schema; adapter extracts envelope.structured_output
   *     (chat-index, sources/classifier) */
  outputFormat: "text-stdin" | "text-envelope" | "json-schema";
  model?: "haiku" | "sonnet" | "opus";
  maxBudgetUsd?: number;
  noSessionPersistence?: boolean;
  /** Run from tmpdir() so the CLI doesn't load the project's
   *  CLAUDE.md / plugins / memory and inflate the prompt. */
  isolatedFromProject?: boolean;
  timeoutMs: number;
}

export const claudeCodeTuning = {
  "journal-archivist": {
    outputFormat: "text-stdin",
    timeoutMs: 5 * ONE_MINUTE_MS,
  },
  "source-summarize": {
    outputFormat: "text-envelope",
    model: "haiku",
    maxBudgetUsd: 0.25,
    noSessionPersistence: true,
    isolatedFromProject: true,
    timeoutMs: 5 * ONE_MINUTE_MS,
  },
  "chat-index-summary": {
    outputFormat: "json-schema",
    model: "haiku",
    maxBudgetUsd: 0.15,
    noSessionPersistence: true,
    isolatedFromProject: true,
    timeoutMs: 2 * ONE_MINUTE_MS,
  },
  "source-classify": {
    outputFormat: "json-schema",
    model: "haiku",
    maxBudgetUsd: 0.05,
    noSessionPersistence: true,
    isolatedFromProject: true,
    timeoutMs: 2 * ONE_MINUTE_MS,
  },
} as const satisfies Record<ProfileName, ClaudeCodeProfile>;
```

The `satisfies Record<ProfileName, ClaudeCodeProfile>` is load-bearing: it forces every profile in the portable union to have a tuning entry, and every entry to match the Claude profile shape. Adding a new profile in `types.ts` is a compile error in this file until the entry exists. A future `openai.tuning.ts` would have the same `satisfies` line against a completely different `OpenAIProfile` shape — no shared knob vocabulary, no leaky abstraction.

**Why TS over JSON.** A TS module gives you the union-completeness check above for free; a JSON file would need a runtime zod schema + load step + startup error path to get the same property. The cost of TS is that bumping `maxBudgetUsd` from 0.15 to 0.20 needs a rebuild — for tuning that lives next to the adapter and changes on the order of months, that's the right trade. If the values ever become user-editable, that's the time to flip to JSON.

### Adapter implementation

`ClaudeCodeBackend` adds two methods that look up the profile, validate the output-format kind, and spawn `claude` with the right flags:

```typescript
async function generate(input: GenerateInput): Promise<string> {
  const profile = claudeCodeTuning[input.profile];
  if (profile.outputFormat === "json-schema") {
    throw new Error(`profile ${input.profile} is structured — use generateStructured()`);
  }
  // text-stdin (journal) vs text-envelope (sources/pipeline/summarize)
  // routes to two different spawn helpers but both return Promise<string>.
  return profile.outputFormat === "text-stdin" ? spawnTextStdin(input, profile) : spawnTextEnvelope(input, profile);
}

async function generateStructured<T>(input: GenerateInput, schema: object): Promise<T> {
  const profile = claudeCodeTuning[input.profile];
  if (profile.outputFormat !== "json-schema") {
    throw new Error(`profile ${input.profile} is text — use generate()`);
  }
  const stdout = await spawnJsonSchema(input, schema, profile);
  return parseClaudeJsonEnvelope<T>(stdout);
}
```

The three private spawn helpers are lifted from the bodies of `runClaudeCli` (archivist-cli.ts), `spawnClaudeSummarize` in summarizer.ts and pipeline/summarize.ts, and `spawnClaudeClassify` (classifier.ts). The shared envelope parser handles `{is_error, structured_output, result}` — the same lesson PR #94 learned about errors landing on stdout.

### Caller migration

The four callers' default impls become thin wrappers; **the public DI signatures don't change**, so injected fakes in tests keep working unchanged.

```typescript
// archivist-cli.ts (after)
export const runClaudeCli: Summarize = (systemPrompt, userPrompt) =>
  getActiveBackend().generate({ systemPrompt, userPrompt, profile: "journal-archivist" });

// summarizer.ts (after)
export const defaultSummarize: SummarizeFn = async (input) => {
  const result = await getActiveBackend().generateStructured<unknown>(
    { systemPrompt: SYSTEM_PROMPT, userPrompt: input, profile: "chat-index-summary" },
    SUMMARY_SCHEMA,
  );
  return validateSummaryResult(result);  // existing lenient normalizer
};

// classifier.ts and pipeline/summarize.ts — analogous
```

Pure helpers stay where they are: `extractText`, `truncate`, `validateSummaryResult`, `validateClassifyResult`, `buildClassifyPrompt`, `parseSummarizeOutput`, `buildSummarizePromptBody`. The Claude-CLI-specific envelope parsing moves into the adapter — it's the adapter's protocol, not the caller's concern.

### Error portability

`ClaudeCliNotFoundError` (currently in `archivist-cli.ts`, re-imported by summarizer / classifier / pipeline-summarize) becomes a portable `LLMBackendUnavailableError` exported from the backend module. To avoid touching ~10 `instanceof ClaudeCliNotFoundError` catch sites in production code and tests, `archivist-cli.ts` re-exports `LLMBackendUnavailableError as ClaudeCliNotFoundError` — same class, two names. New code can catch the portable name; existing catches keep working.

### File-level changes

**New files:**
- `server/agent/backend/claude-code.tuning.ts`

**Modified files:**
- `server/agent/backend/types.ts` — add `ProfileName`, `GenerateInput`, extend `LLMBackend`, export `LLMBackendUnavailableError`
- `server/agent/backend/claude-code.ts` — implement `generate` / `generateStructured`, lift spawn helpers from the four caller files
- `server/workspace/journal/archivist-cli.ts` — `runClaudeCli` becomes a wrapper; spawn body + `ClaudeCliFailedError` deleted; `ClaudeCliNotFoundError` becomes a re-export alias
- `server/workspace/chat-index/summarizer.ts` — `defaultSummarize` becomes a wrapper; `spawnClaudeSummarize` + `parseClaudeJsonResult` deleted
- `server/workspace/sources/classifier.ts` — `defaultClassify` becomes a wrapper; `spawnClaudeClassify` + envelope-parse half of `parseClassifyOutput` deleted
- `server/workspace/sources/pipeline/summarize.ts` — `makeDefaultSummarize` becomes a wrapper; `spawnClaudeSummarize` deleted; `parseSummarizeOutput` keeps its `result`-extraction role (adapter returns the envelope's `result` field as a string)

**Untouched:**
- All callers of `Summarize` / `SummarizeFn` / `ClassifyFn` (`dailyPass.ts`, indexer, source registry, daily-brief writer)
- All tests under `test/journal/`, `test/chat-index/`, `test/sources/` — they inject fakes, not the spawn layer

### Acceptance criteria

- `yarn format && yarn lint && yarn typecheck && yarn build && yarn test` all clean
- `git grep "spawn.*\\bclaude\\b" server/workspace/` returns zero hits
- Every existing fake injected by tests still satisfies `Summarize` / `SummarizeFn` / `ClassifyFn` without changes

---

## Follow-up PRs (after #2)

- **PR #2.5 (optional):** Rename `claudeSessionId` → `llmSessionToken` across server, tests, and `@mulmobridge/protocol`. Wire-format change — coordinate package version bump.
- **PR #3:** Add a second backend (probably OpenAI). Real validation of the interface; expect refinements. Will exercise both `runAgent` and `generate*` paths and clarify whether the orchestrator's MCP-config-writing belongs there or behind a `capabilities.mcp` check.

## Out of scope

- **Migrating the existing `feat-mulmoclaude-ollama-support.md` plan.** That plan takes a different approach — env-passthrough to leverage Claude Code CLI's Anthropic-compat mode. Both can coexist; the env-passthrough route stays useful for Anthropic-compatible endpoints, and the abstraction in this doc is what unlocks non-Anthropic-shaped backends (OpenAI function calling, Gemini, etc.).

## Risks

- **`generate` / `generateStructured` are provisional.** Their signatures will refine when PR #3 wires up a real second backend — that's the only thing that proves the per-profile tuning file is the right unit. Don't optimize for perfect now.
- **Output-format mismatch is a runtime error.** Calling `generate` for a profile whose tuning has `outputFormat: "json"` (or vice versa) throws. Compile-time discrimination would need discriminated-union profiles, which complicates the tuning shape. Tests cover each profile's correct path; the runtime check is a defensive net.
- **`ProfileName` is a closed union.** Adding a profile is a 2-step change: extend the union *and* add the entry to every backend's tuning module. The compiler enforces both halves; this is the same load-bearing property that makes the design work.
