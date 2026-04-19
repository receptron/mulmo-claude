# X MCP Tools — Plan

## Goal

Add two MCP tools for X (Twitter) via the official X API v2, both returning plain text to Claude. These are **pure LLM tools** — no GUI rendering, no Vue components.

| Tool | Description |
|---|---|
| `readXPost` | Fetch a single post by URL or tweet ID |
| `searchX` | Search recent posts by keyword/query |

Both share the same `X_BEARER_TOKEN` and live in a single file `server/agent/mcp-tools/x.ts`.

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

### `readXPost` — Tweet lookup

**Endpoint**: `GET https://api.twitter.com/2/tweets/:id`

**Query params**:
```
tweet.fields=created_at,author_id,public_metrics,entities
expansions=author_id
user.fields=name,username
```

**Free tier**: 500,000 reads/month.

### `searchX` — Recent search

**Endpoint**: `GET https://api.twitter.com/2/tweets/search/recent`

**Key params**: `query`, `max_results` (10–100), same `tweet.fields`/`expansions`/`user.fields` as above.

**Free tier**: Rate-limited to 1 request/15 seconds on Basic plan. `max_results` defaults to 10.

**Auth for both**: `Authorization: Bearer <X_BEARER_TOKEN>` — same token, no extra credentials.

---

## Folder Structure for MCP Tools

Pure MCP tools (no GUI) live in `server/agent/mcp-tools/`. Unlike `src/plugins/`, there is no need to split definition from implementation since there are no Vue imports. Each tool is a single file:

```
server/
  mcp-tools/
    x.ts            ← readXPost + searchX (share Bearer Token + helpers)
    index.ts        ← barrel: exports mcpTools[] used by mcp-server.ts and routes
```

**Adding a future MCP tool = add one file to `server/agent/mcp-tools/` and register it in `index.ts`.**

Each tool file exports one entry per tool:

```typescript
// A single MCP tool module — x.ts exports two of these
export interface McpTool {
  definition: { name: string; description: string; inputSchema: object }
  requiredEnv?: string[]   // hidden + disabled if any are unset
  prompt?: string          // injected into system prompt when active
  handler: (args: Record<string, unknown>) => Promise<string>
}
```

The barrel `index.ts` collects all tools and exposes an Express router:
```typescript
import { readXPost, searchX } from "./x.js"
export const mcpTools: McpTool[] = [readXPost, searchX]

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

`mcp-server.ts` imports `mcpTools` once to register all definitions and handlers. `server/index.ts` mounts a single `/api/mcp-tools` router rather than individual routes per tool.

The role builder (`src/plugins/manageRoles/View.vue`) fetches `GET /api/mcp-tools` on mount and merges enabled tools into the plugin checklist. Tools with `enabled: false` are hidden entirely.

`agent.ts` skips disabled tools when building `activePlugins`:
```typescript
const enabledMcpToolNames = new Set(
  mcpTools
    .filter(t => (t.requiredEnv ?? []).every(key => !!process.env[key]))
    .map(t => t.definition.name)
)
const knownTools = new Set([...MCP_PLUGINS, ...enabledMcpToolNames])
```

`agent.ts` also merges tool prompts from active pure MCP tools into `pluginPrompts`:
```typescript
const mcpToolPrompts = Object.fromEntries(
  mcpTools
    .filter(t => t.prompt && activePlugins.includes(t.definition.name))
    .map(t => [t.definition.name, t.prompt])
)
const mergedPluginPrompts = { ...mcpToolPrompts, ...pluginPrompts }
```

---

## Architecture

Unlike GUI plugins, these tools:
- Do **not** push a visual ToolResult to the frontend SSE stream
- Do **not** need a `src/plugins/` entry or Vue components
- Just return content as plain text back to Claude

The Express route (`/api/mcp-tools`) is used because the MCP server process is only passed a limited env (SESSION_ID, PORT, etc.) and cannot read `.env` directly.

---

## Implementation

### 1. `server/agent/mcp-tools/x.ts`

Shared helper: `fetchX(path, params)` — adds `Authorization: Bearer` header, handles 401/404/429 with descriptive error strings.

**`readXPost`**:
- `inputSchema`: `{ url: string }` — full x.com/twitter.com URL or bare tweet ID
- `handler`:
  - Extracts tweet ID via regex `/status\/(\d+)/`; falls back to bare numeric ID
  - Calls `GET /2/tweets/:id` with tweet fields + author expansion
  - Returns:
    ```
    @username (Name) · 2025-01-01

    Tweet text here...

    Likes: 42 | Retweets: 5 | Replies: 2
    ```
- `prompt`: `"Use readXPost whenever the user shares a URL from x.com or twitter.com."`

**`searchX`**:
- `inputSchema`: `{ query: string, max_results?: number }` — `max_results` 10–100, defaults to 10
- `handler`:
  - Calls `GET /2/tweets/search/recent?query=<query>&max_results=<n>` with same fields
  - Returns a numbered list:
    ```
    Search: "your query" — 8 results

    1. @username (Name) · 2025-01-01
       Tweet text here...
       Likes: 10 | Retweets: 2

    2. ...
    ```
- `prompt`: `"Use searchX to find recent posts on X by keyword or topic."`

Both export `requiredEnv = ["X_BEARER_TOKEN"]`.

### 2. `server/agent/mcp-tools/index.ts`

Barrel + Express router as described above.

### 3. `server/agent/mcp-server.ts`

- Import `mcpTools` from `./mcp-tools/index.js`
- Add each tool's `definition` to `ALL_TOOLS`
- Handle calls by routing to the Express endpoint; return text to Claude — **no** frontend push

### 4. `server/index.ts`

- Mount: `app.use("/api/mcp-tools", mcpToolsRouter)`

### 5. `server/agent/index.ts`

- Import `mcpTools` from `./mcp-tools/index.js`
- Replace `MCP_PLUGINS`-only filter with combined set (enabled MCP tools auto-discovered):
  ```typescript
  const knownTools = new Set([...MCP_PLUGINS, ...enabledMcpToolNames])
  ```
- `MCP_PLUGINS` is unchanged — it continues to cover all GUI plugins

After this change, **`agent.ts` never needs editing when adding future MCP tools**.

### 6. `src/config/roles.ts`

- Add `"readXPost"` and `"searchX"` to `availablePlugins` for relevant roles

---

## File Checklist

New files:
```
server/agent/mcp-tools/x.ts          ← readXPost + searchX tools
server/agent/mcp-tools/index.ts      ← barrel + Express router
```

Edits to existing files:
- `server/agent/mcp-server.ts` — import mcpTools, register definitions, handle calls (no frontend push)
- `server/index.ts` — mount `/api/mcp-tools` router
- `server/agent/index.ts` — extend allowed set with enabled mcpTools names (MCP_PLUGINS unchanged)
- `src/config/roles.ts` — add `"readXPost"` and `"searchX"` to relevant roles' availablePlugins
- `src/plugins/manageRoles/View.vue` — fetch `GET /api/mcp-tools` on mount, merge enabled tools into plugin checklist

---

## Notes & Decisions

- **Two tools, one file** — `readXPost` and `searchX` share `X_BEARER_TOKEN` and a `fetchX` helper; no reason to split them across files.
- **No npm library** — plain `fetch` with `Authorization: Bearer` is sufficient for both endpoints.
- **No `src/plugins/` entry** — no visual output; Claude receives results as text.
- **No frontend push** — MCP tool handlers skip `POST /api/internal/tool-result`.
- **Bearer Token in main process** — Express server reads `X_BEARER_TOKEN`; no changes to MCP subprocess env.
- **Graceful missing-token error** — return a clear string so Claude can tell the user what to configure.
- **One file per concern** — both X tools share auth/helpers naturally; unrelated tools get separate files.
- **`requiredEnv`** — tools with unset env vars are hidden from the role builder and excluded from `activePlugins`. Check runs at request time, no restart needed.
- **`prompt`** — per-tool system prompt hint tells Claude when to invoke each tool automatically.
- **`searchX` rate limit** — 1 req/15 sec on Basic plan. No client-side throttling needed for personal use; X API returns 429 which the handler surfaces as a clear error.
- **`agent.ts` never touched for new MCP tools** — `mcpTools` barrel is imported once; new tools are auto-discovered via `index.ts`.
