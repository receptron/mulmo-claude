# X Post Reader — Plan

## Goal

Add a `readXPost` MCP tool that fetches a post from X (Twitter) via the official X API v2 and returns its content as text to Claude. This is a **pure LLM tool** — no GUI rendering, no Vue components.

---

## Prerequisites

1. An X Developer account at [developer.twitter.com](https://developer.twitter.com/)
2. A Bearer Token from an X Developer App (read-only access is sufficient)
3. Add to `.env`:
   ```
   X_BEARER_TOKEN=your_bearer_token_here
   ```

---

## X API v2 Details

**Endpoint**: `GET https://api.twitter.com/2/tweets/:id`

**Auth**: `Authorization: Bearer <X_BEARER_TOKEN>` (app-only, no user login needed)

**Query params**:
```
tweet.fields=created_at,author_id,public_metrics,entities
expansions=author_id
user.fields=name,username
```

**Free tier**: 500,000 tweet reads/month — sufficient for personal use.

---

## Folder Structure for MCP Tools

Pure MCP tools (no GUI) live in `server/mcp-tools/`. Unlike `src/plugins/`, there is no need to split definition from implementation since there are no Vue imports. Each tool is a single file:

```
server/
  mcp-tools/
    x-post.ts       ← definition + handler for readXPost
    index.ts        ← barrel: exports allMcpTools[] used by mcp-server.ts and routes
```

**Adding a future MCP tool = add one file to `server/mcp-tools/` and register it in `index.ts`.**

Each tool file exports:
```typescript
export const definition = {
  name: "readXPost",
  description: "...",
  inputSchema: { ... },
}

// Optional — env vars that must be set for this tool to be enabled
export const requiredEnv = ["X_BEARER_TOKEN"]

// Optional — injected into the system prompt so Claude knows when to use this tool
export const prompt = "Use the readXPost tool whenever the user shares a URL from x.com or twitter.com."

export async function handler(args: { url: string }): Promise<string> {
  // business logic — returns plain text to Claude
}
```

The barrel `index.ts` collects all tools and exposes an Express router:
```typescript
import * as xPost from "./x-post.js"
export const mcpTools = [xPost]

// Express router
export const mcpToolsRouter = Router()

// POST /:tool — dispatches to the right handler
mcpToolsRouter.post("/:tool", ...)

// GET / — returns { name, enabled } for each tool (used by the role builder UI)
mcpToolsRouter.get("/", (_req, res) => {
  res.json(mcpTools.map(t => ({
    name: t.definition.name,
    enabled: (t.requiredEnv ?? []).every(key => !!process.env[key]),
  })))
})
```

`mcp-server.ts` imports `mcpTools` once to register all definitions and handlers, instead of one import per tool. `server/index.ts` mounts a single `/api/mcp-tools` router (from the barrel) rather than individual routes per tool.

The role builder (`src/plugins/manageRoles/View.vue`) fetches `GET /api/mcp-tools` on mount and merges enabled tools into the plugin checklist. Tools with `enabled: false` are hidden entirely from the list. This means `readXPost` only appears as an option when `X_BEARER_TOKEN` is configured in the environment.

`agent.ts` also skips disabled tools when building `activePlugins`:
```typescript
const enabledMcpToolNames = new Set(
  mcpTools
    .filter(t => (t.requiredEnv ?? []).every(key => !!process.env[key]))
    .map(t => t.definition.name)
)
const knownTools = new Set([...MCP_PLUGINS, ...enabledMcpToolNames])
```

`agent.ts` merges tool prompts from active pure MCP tools into `pluginPrompts` before building the system prompt:
```typescript
const mcpToolPrompts = Object.fromEntries(
  mcpTools
    .filter(t => t.prompt && activePlugins.includes(t.definition.name))
    .map(t => [t.definition.name, t.prompt])
)
// merge with any client-supplied pluginPrompts
const mergedPluginPrompts = { ...mcpToolPrompts, ...pluginPrompts }
```

---

## Architecture

Unlike GUI plugins, this tool:
- Does **not** push a visual ToolResult to the frontend SSE stream
- Does **not** need a `src/plugins/` entry or Vue components
- Just returns the tweet content as plain text back to Claude

The Express route (`/api/mcp-tools`) is used because the MCP server process is only passed a limited env (SESSION_ID, PORT, etc.) and cannot read `.env` directly. The main Express server process has full env access.

---

## Implementation

### 1. `server/mcp-tools/x-post.ts`

Exports `definition` and `handler`:

- `definition` — tool schema with name `readXPost`, description instructing Claude to use this for any x.com/twitter.com URL, and `inputSchema: { url: string }`
- `handler(args)`:
  - Returns an error string if `X_BEARER_TOKEN` is unset
  - Extracts tweet ID using regex `/status\/(\d+)/`; also accepts a bare numeric ID
  - Calls X API v2 with `Authorization: Bearer <token>`
  - On success, returns a plain text summary:
    ```
    @username (Name) · 2025-01-01

    Tweet text here...

    Likes: 42 | Retweets: 5 | Replies: 2
    ```
  - Returns descriptive error strings for X API errors (401, 404, 429, etc.)

### 2. `server/mcp-tools/index.ts`

```typescript
import * as xPost from "./x-post.js"

export const mcpTools = [xPost]

// Express router — one POST /:tool route dispatching to the right handler
import { Router } from "express"
export const mcpToolsRouter = Router()
mcpToolsRouter.post("/:tool", ...)
```

### 3. `server/mcp-server.ts`

- Import `mcpTools` from `./mcp-tools/index.js`
- Add each tool's `definition` to `ALL_TOOLS`
- Handle MCP tool calls: call `handler(args)` directly (or via the Express route), return text to Claude — **no** frontend push

### 4. `server/index.ts`

- Import `mcpToolsRouter` from `./mcp-tools/index.js`
- Mount: `app.use("/api/mcp-tools", mcpToolsRouter)`

### 5. `server/agent.ts`

- Import `mcpTools` from `./mcp-tools/index.js`
- Extend the allowed set dynamically so pure MCP tools are auto-discovered:
  ```typescript
  const knownTools = new Set([
    ...MCP_PLUGINS,
    ...mcpTools.map(t => t.definition.name),
  ])
  const activePlugins = role.availablePlugins.filter(p => knownTools.has(p))
  ```
- `MCP_PLUGINS` is unchanged — it continues to cover all GUI plugins

After this change, adding a new pure MCP tool **never requires editing `agent.ts`** — only the tool file, `mcp-tools/index.ts`, and `roles.ts`.

### 6. `src/config/roles.ts`

- Add `"readXPost"` to `availablePlugins` for relevant roles

---

## File Checklist

New files:
```
server/mcp-tools/x-post.ts     ← definition + handler
server/mcp-tools/index.ts      ← barrel + Express router
```

Edits to existing files:
- `server/mcp-server.ts` — import mcpTools, register definitions, handle calls (no frontend push)
- `server/index.ts` — mount `/api/mcp-tools` router
- `server/agent.ts` — extend allowed set with enabled mcpTools names (MCP_PLUGINS unchanged)
- `src/config/roles.ts` — add `"readXPost"` to relevant roles' availablePlugins
- `src/plugins/manageRoles/View.vue` — fetch `GET /api/mcp-tools` on mount, merge enabled tools into plugin checklist

---

## Notes & Decisions

- **No npm library** — plain `fetch` with `Authorization: Bearer` is sufficient.
- **No `src/plugins/` entry** — no visual output; Claude receives the tweet as text.
- **No frontend push** — `handleToolCall` for MCP tools skips `POST /api/internal/tool-result`.
- **Bearer Token in main process** — Express server reads `X_BEARER_TOKEN`; no changes to how the MCP subprocess env is configured.
- **Graceful missing-token error** — return a clear string so Claude can tell the user what to configure.
- **One file per tool** — no definition/implementation split needed since there are no Vue imports to avoid.
- **Optional `requiredEnv` export** — list of env var names that must be set for the tool to be enabled. Tools with missing env vars are hidden from the role builder and excluded from `activePlugins` in `agent.ts`. No restart logic needed — the check runs at request time.
- **Optional `prompt` export** — each tool file can export a `prompt` string injected into the system prompt via the existing `pluginPrompts` mechanism. Use this to tell Claude when to invoke the tool (e.g. URL patterns, trigger conditions).
- **`agent.ts` is not touched when adding future MCP tools** — `mcpTools` barrel is imported once; new tools are auto-discovered. Only `MCP_PLUGINS` (GUI plugins) requires manual updates.
