# Refactor server/agent.ts — Extract Pure Functions & Add Unit Tests

## Goal

Split `server/agent.ts` into testable pure functions and the orchestration layer. The pure functions handle prompt construction, MCP config generation, CLI argument building, and stream event parsing. Each gets unit tests.

## Current State

`server/agent.ts` contains one large `runAgent` async generator (~170 lines) that mixes:
1. System prompt construction (memory, wiki, plugin prompts)
2. Active plugin filtering
3. MCP config JSON generation
4. Claude CLI argument building
5. Process spawning
6. Stream JSON parsing and event mapping

Only items 1–5 are pure logic that can be tested without running a process.

## Extracted Functions

### `server/agent-prompt.ts` — Prompt construction

```typescript
// All pure functions, no side effects except reading workspace files

buildMemoryContext(workspacePath: string): string
  - Read memory.md, append helps hint
  - Wrap in <reference> tags

buildWikiContext(workspacePath: string): string | null
  - Read wiki/summary.md, wiki/index.md, wiki/SCHEMA.md
  - Return null if wiki doesn't exist

buildPluginPromptSections(
  role: Role,
  pluginPrompts?: Record<string, string>,
): string[]
  - Merge MCP tool prompts with caller-provided pluginPrompts
  - Filter by role.availablePlugins
  - Return formatted markdown sections

buildSystemPrompt(params: {
  role: Role;
  workspacePath: string;
  pluginPrompts?: Record<string, string>;
}): string
  - Compose all the above into the final system prompt string
  - Includes date, workspace path, memory, wiki, plugin instructions
```

### `server/agent-config.ts` — MCP config & CLI args

```typescript
getActivePlugins(role: Role): string[]
  - Filter role.availablePlugins against the MCP_PLUGINS set

buildMcpConfig(params: {
  sessionId: string;
  port: number;
  activePlugins: string[];
  roleIds: string[];
}): object
  - Return the JSON structure for --mcp-config

buildCliArgs(params: {
  systemPrompt: string;
  activePlugins: string[];
  claudeSessionId?: string;
  message: string;
  mcpConfigPath?: string;
}): string[]
  - Return the argument array for `spawn("claude", args)`
```

### `server/agent-stream.ts` — Stream parsing

```typescript
parseStreamEvent(event: ClaudeStreamEvent): AgentEvent[]
  - Map a single Claude stream-json event to zero or more AgentEvents
  - Pure function, no I/O
```

### `server/agent.ts` — Orchestration (remains)

`runAgent` becomes a thin orchestrator:
1. Call `buildSystemPrompt()`
2. Call `getActivePlugins()`, `buildMcpConfig()`, `buildCliArgs()`
3. Write MCP config to temp file
4. Spawn process
5. Parse stream using `parseStreamEvent()`
6. Cleanup

~40 lines after extraction.

## Test Plan

### `test/agent/test_agent_prompt.ts`

| Test | Description |
|---|---|
| buildMemoryContext with memory.md | Returns wrapped content + helps hint |
| buildMemoryContext without memory.md | Returns only helps hint |
| buildWikiContext with full wiki | Includes summary + schema hint |
| buildWikiContext without wiki dir | Returns null |
| buildWikiContext with index but no summary | Returns layout description |
| buildPluginPromptSections basic | Returns formatted sections for enabled plugins |
| buildPluginPromptSections merges caller prompts | Caller prompts override MCP defaults |
| buildPluginPromptSections filters by role | Only includes plugins in role.availablePlugins |
| buildSystemPrompt composes all parts | Verify the final string contains role prompt, date, memory, wiki, plugins |

### `test/agent/test_agent_config.ts`

| Test | Description |
|---|---|
| getActivePlugins filters correctly | Only returns plugins in MCP_PLUGINS set |
| buildMcpConfig structure | Validates JSON shape (mcpServers, command, env) |
| buildCliArgs basic | Contains --output-format, --system-prompt, -p |
| buildCliArgs with resume | Includes --resume flag |
| buildCliArgs with mcp | Includes --mcp-config path |
| buildCliArgs without mcp | Omits --mcp-config |

### `test/agent/test_agent_stream.ts`

| Test | Description |
|---|---|
| parseStreamEvent assistant with tool_use | Returns tool_call event |
| parseStreamEvent assistant with text | Returns status event |
| parseStreamEvent user with tool_result | Returns tool_call_result event |
| parseStreamEvent result | Returns text + claude_session_id events |
| parseStreamEvent result without session_id | Returns only text event |
| parseStreamEvent assistant with no content | Returns only status event |

## Implementation Order

1. Create `server/agent-stream.ts` — simplest extraction, no dependencies
2. Create `test/agent/test_agent_stream.ts` — test it
3. Create `server/agent-config.ts` — config/args builders
4. Create `test/agent/test_agent_config.ts` — test it
5. Create `server/agent-prompt.ts` — prompt builders (reads files, needs temp dir in tests)
6. Create `test/agent/test_agent_prompt.ts` — test with temp workspace dirs
7. Refactor `server/agent.ts` — import and call extracted functions
8. Run full test suite + typecheck + lint

## Files Changed

| File | Change |
|---|---|
| `server/agent-stream.ts` | New — stream event parsing |
| `server/agent-config.ts` | New — MCP config and CLI args |
| `server/agent-prompt.ts` | New — prompt construction |
| `server/agent.ts` | Slim down to orchestration only |
| `test/agent/test_agent_stream.ts` | New — stream parsing tests |
| `test/agent/test_agent_config.ts` | New — config/args tests |
| `test/agent/test_agent_prompt.ts` | New — prompt construction tests |

## Notes

- `buildMemoryContext` and `buildWikiContext` do synchronous file reads. They stay synchronous since the files are small and always local.
- MCP tool imports (`mcpTools`, `isMcpToolEnabled`) are used in `agent-config.ts` and `agent-prompt.ts`. These imports stay as-is since they're module-level singletons.
- Type definitions (`AgentEvent`, `ClaudeStreamEvent`, etc.) move to a shared types section or stay in `agent.ts` — whichever keeps imports clean.
