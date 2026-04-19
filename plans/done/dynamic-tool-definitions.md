# Dynamic Tool Definitions — Plan

## Problem

`server/agent/mcp-server.ts` hardcodes the full `inputSchema` and `description` for every plugin tool in `ALL_TOOLS`. When a package plugin is updated (new parameters, changed descriptions, fixed enums), `mcp-server.ts` silently drifts out of date. The `playOthello` `playerNames` bug was caused exactly by this.

---

## Key Insight

Every `@gui-chat-plugin/*` and `@mulmochat-plugin/*` package already exports a `TOOL_DEFINITION` with the canonical schema:

```ts
TOOL_DEFINITION = {
  type: "function",
  name: "playOthello",           // tool name
  description: "...",            // description
  parameters: { ... }            // JSON Schema — identical content to MCP's inputSchema
}
```

The only thing MulmoChat adds per tool is the `endpoint`. Everything else can be sourced from the package.

---

## Approach

Replace the hardcoded `ALL_TOOLS` entries with a two-part structure:

1. **`TOOL_ENDPOINTS`** — a simple `Record<string, string>` mapping tool name → API endpoint. This is the only thing we maintain manually.

2. **Package imports** — import `TOOL_DEFINITION` from each package and use it to build the tool entry at runtime.

A helper converts the package format to the MCP format:
```ts
function toolFromDef(def: ToolDefinition, endpoint: string): ToolDef {
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.parameters,   // parameters === inputSchema, just renamed
    endpoint,
  };
}
```

`ALL_TOOLS` becomes:
```ts
const ALL_TOOLS: Record<string, ToolDef> = {
  [MarkdownDef.name]:     toolFromDef(MarkdownDef,     "/api/present-document"),
  [SpreadsheetDef.name]:  toolFromDef(SpreadsheetDef,  "/api/present-spreadsheet"),
  [MindMapDef.name]:      toolFromDef(MindMapDef,      "/api/mindmap"),
  // ... etc.
  switchRole: { ... },  // stays custom — no package
};
```

---

## Local Plugins (todo, scheduler)

`src/plugins/todo/index.ts` and `src/plugins/scheduler/index.ts` cannot be imported in the server because they import Vue components. Two options:

**Option A (recommended):** Extract their `toolDefinition` into a separate file each:
- `src/plugins/todo/definition.ts` — exports `toolDefinition` (no Vue imports)
- `src/plugins/scheduler/definition.ts` — exports `toolDefinition` (no Vue imports)

Then `index.ts` imports from `definition.ts`, and `mcp-server.ts` also imports from `definition.ts`.

**Option B:** Keep todo/scheduler hardcoded. We own these plugins so drift is less of a risk.

Recommended: Option A for consistency. The definition files are trivial to extract.

---

## `present3D` Naming Inconsistency (Pre-existing Bug)

The `@gui-chat-plugin/present3d` package exports `TOOL_NAME = "present3D"` (capital D).
Current `ALL_TOOLS` key and `name` are both `"present3d"` (lowercase) — which means Claude calls the MCP tool as `present3D` but we look it up as `present3d`, missing it.

Fix as part of this change: use the package's `TOOL_DEFINITION.name` as the key (which is `"present3D"`), and update `MCP_PLUGINS` in `server/agent/index.ts` and `availablePlugins` in `src/config/roles.ts` to match.

---

## Files to Change

| File | Change |
|---|---|
| `server/agent/mcp-server.ts` | Import `TOOL_DEFINITION` from packages; replace hardcoded schemas; keep only `TOOL_ENDPOINTS` + `switchRole` |
| `src/plugins/todo/definition.ts` | New file — extract `toolDefinition` from `index.ts` |
| `src/plugins/scheduler/definition.ts` | New file — extract `toolDefinition` from `index.ts` |
| `src/plugins/todo/index.ts` | Import `toolDefinition` from `./definition` |
| `src/plugins/scheduler/index.ts` | Import `toolDefinition` from `./definition` |
| `server/agent/index.ts` | Fix `"present3d"` → `"present3D"` in `MCP_PLUGINS` |
| `src/config/roles.ts` | Fix `"present3d"` → `"present3D"` in `availablePlugins` for affected roles |
| `src/tools/index.ts` | Fix `present3d` key → `present3D` |

---

## What Stays Manual

- `TOOL_ENDPOINTS` map — the endpoint path is MulmoChat-specific, packages don't know it
- `switchRole` — fully custom, no package
- todo/scheduler toolDefinition (only if going with Option B)

---

## Out of Scope

- Plugins not currently in `ALL_TOOLS` (browse, camera, music, piano, weather, etc.) — those aren't wired through MCP yet and are a separate concern
- Auto-discovering new plugins — still requires manually adding to `TOOL_ENDPOINTS`, `MCP_PLUGINS`, and a role's `availablePlugins`
