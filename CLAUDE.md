# CLAUDE.md

This file provides guidance to Claude Code when working with the MulmoClaude repository.

## Project Overview

MulmoClaude is a text/task-driven agent app with rich visual output. It uses **Claude Code Agent SDK** as the LLM core and **gui-chat-protocol** as the plugin layer.

**Core philosophy**: The workspace is the database. Files are the source of truth. Claude is the intelligent interface.

See `plan/mulmo_claude.md` for the full design plan.

## Key Commands

- **Development server**: `npm run dev` (runs both client and server concurrently)
- **Client only**: `npm run dev:client`
- **Server only**: `npm run dev:server`
- **Lint**: `yarn lint`
- **Format**: `yarn format`
- **Typecheck**: `yarn typecheck`

**IMPORTANT**: After modifying any source code, always run `yarn format`, `yarn lint`, and `yarn typecheck` before considering the task done.

**IMPORTANT**: Do NOT run build commands (`npm run build`, `npm run preview`) as they create unnecessary build artifacts.

## Architecture

### LLM Core

**Package**: `@anthropic-ai/claude-agent-sdk`

The agent loop runs via `query()` in `server/agent.ts`. Claude decides autonomously which tools to use — built-in file tools (bash, read, write, glob, grep) or gui-chat-protocol plugins registered as MCP servers.

### Plugin Layer

**Package**: `gui-chat-protocol`

Plugins follow the gui-chat-protocol standard (`ToolDefinition`, `ToolResult`, `ViewComponent`, `PreviewComponent`). Each plugin is wrapped as a Claude Code SDK `tool()` and registered via `createSdkMcpServer`.

Plugin registry: `src/tools/index.ts`
Plugin types: `src/tools/types.ts`

### Roles

Defined in `src/config/roles.ts`. A role defines:
- **Persona** — system prompt
- **Plugin palette** — `availablePlugins[]` maps to MCP servers created for that session
- **Context reset** — switching roles always starts a fresh `query()` call

**MCP servers are created per role switch** — only the current role's plugins are registered, keeping Claude's context lean.

### Server → Client Communication

The agent streams results to the frontend via **SSE** (Server-Sent Events) from `POST /api/agent`. Event types:
- `{ type: "status", message }` — agent progress updates
- `{ type: "tool_result", result }` — gui-chat-protocol ToolResult to render in canvas
- `{ type: "error", message }` — error from agent

### Workspace

The app operates on a workspace directory set via `WORKSPACE_PATH` env var (defaults to `cwd()`). All data lives here as plain Markdown + YAML frontmatter files:

```
workspace/
  chat/                   ← session ToolResults (one .jsonl per session)
  todos/                  ← todo items
  calendar/               ← calendar events
  contacts/               ← address book
  memory.md               ← distilled facts always loaded as context
```

## Key Files

| File | Purpose |
|---|---|
| `server/agent.ts` | Claude Code agent loop, MCP server creation per role |
| `server/routes/agent.ts` | POST /api/agent → SSE stream |
| `src/config/roles.ts` | Role definitions |
| `src/tools/index.ts` | Plugin registry |
| `src/tools/types.ts` | ToolPlugin type, MulmoClaudeToolContextApp |
| `src/App.vue` | Main UI — sidebar + canvas + role switcher |

## Plugin Development

Each plugin is a `ToolPlugin` (from `gui-chat-protocol/vue`, extended in `src/tools/types.ts`):
- `toolDefinition` — JSON Schema for Claude's function calling
- `execute()` — runs the plugin, returns a `ToolResult`
- `viewComponent` — Vue component rendered in the canvas
- `previewComponent` — Vue component shown in the sidebar

### Adding a package plugin (`@gui-chat-plugin/*` or `@mulmochat-plugin/*`)

Package plugins export a canonical `TOOL_DEFINITION` that is used directly — **do not copy or re-type the schema**. Required updates in **4 places**:

1. **`server/mcp-server.ts`** — import `TOOL_DEFINITION` from the package, add to the imports list and the `TOOL_ENDPOINTS` map, and include the def in the `ALL_TOOLS` spread array
2. **`src/tools/index.ts`** — import the plugin's vue export and register it in the `plugins` map using `TOOL_NAME` as the key (must match exactly — check the package's exported `TOOL_NAME`)
3. **`src/config/roles.ts`** — add the tool name to the relevant role's `availablePlugins`
4. **`server/agent.ts`** — add the tool name to `MCP_PLUGINS`

For the server route, add a handler in `server/routes/plugins.ts` that calls the package's `execute*` function.

### Adding a local plugin (`src/plugins/<name>/`)

Local plugins import Vue components, so their `toolDefinition` must live in a **separate file** to allow server-side imports without pulling in Vue:

1. **`src/plugins/<name>/definition.ts`** — `toolDefinition` only, no Vue imports
2. **`src/plugins/<name>/index.ts`** — imports `toolDefinition` from `./definition`, adds `execute()` and Vue components
3. **`server/routes/`** — add a new route file with the backend logic
4. **`server/mcp-server.ts`** — import the definition from `../src/plugins/<name>/definition.js`, add to `TOOL_ENDPOINTS` and the `ALL_TOOLS` spread array
5. **`src/tools/index.ts`** — register plugin in the `plugins` map
6. **`src/config/roles.ts`** — add tool name to relevant role's `availablePlugins`
7. **`server/agent.ts`** — add tool name to `MCP_PLUGINS`

> If a plugin is in `availablePlugins` but absent from `MCP_PLUGINS` or `ALL_TOOLS`, it will be silently dropped and Claude won't see the MCP tool.

> The key in `src/tools/index.ts` must exactly match the tool's `name` field (i.e. `TOOL_NAME` from the package, or `toolDefinition.name` for local plugins). This is what the frontend uses to look up the view component when rendering a tool result.

## Express Route Type Safety

MUST use Express generics to type route handlers — NEVER use `as` casts on `req.body`, `req.params`, or `req.query`.

### Request typing

`Request<Params, ResBody, ReqBody>` — always specify all three type parameters:

```typescript
// GOOD — fully typed request
interface MyBody { action: string; text?: string }
interface MyParams { id: string }

router.post("/items/:id", (req: Request<MyParams, unknown, MyBody>, res: Response) => {
  const { id } = req.params;    // string — typed
  const { action } = req.body;  // MyBody — typed
});

// BAD — untyped, requires casts
router.post("/items/:id", (req: Request, res: Response) => {
  const { action } = req.body as { action: string }; // avoid
});
```

### Response typing

Use `Response<T>` when the response shape is consistent:

```typescript
interface ErrorResponse { error: string }
interface TodoResponse { message: string; data: { items: TodoItem[] } }

router.post("/todos", (req: Request<object, unknown, TodoBody>, res: Response<TodoResponse | ErrorResponse>) => {
  // res.json() is now type-checked
});
```

### Query parameters

NEVER cast `req.query` — use type narrowing:

```typescript
// GOOD
const session = String(req.query.session ?? "");
const moviePath = typeof req.query.moviePath === "string" ? req.query.moviePath : undefined;

// BAD
const { session } = req.query as { session: string };
```

### JSON.parse results

Use type annotation instead of `as` cast:

```typescript
// GOOD
const data: MyType = JSON.parse(raw);

// BAD
const data = JSON.parse(raw) as MyType;
```

## Tech Stack

- **Frontend**: Vue 3 + Tailwind CSS v4
- **Agent**: `@anthropic-ai/claude-agent-sdk`
- **Plugin protocol**: `gui-chat-protocol`
- **Server**: Express.js (SSE streaming)
- **Storage**: Local file system (plain Markdown files)
- **Language**: TypeScript throughout
