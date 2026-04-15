# Custom Roles via Conversation

## Overview

Allow users to create, edit, and delete their own roles by talking to the LLM. Custom roles are stored as JSON files in `~/mulmoclaude/roles/` and are loaded dynamically alongside the built-in roles defined in `src/config/roles.ts`.

---

## User Experience

### Creating a role

The user talks to the LLM in any role (typically General) and describes what they want:

> "Create a new role for a Python coding assistant that helps me write and debug Python code."

Claude:
1. Asks clarifying questions if needed (name, icon, which plugins to include, any special instructions)
2. Calls the `manageRoles` tool to write the role definition to `~/mulmoclaude/roles/pythonCoder.json`
3. Tells the user the role is ready and they can switch to it

The frontend receives a `roles_updated` SSE event and re-fetches the role list from `GET /api/roles`, making the new role appear in the dropdown immediately — no page refresh needed.

### Editing a role

> "Update the Python Coder role to also allow image generation."

Claude reads the existing file, modifies the `availablePlugins` array, and saves it back via `manageRoles`.

### Deleting a role

> "Delete the Python Coder role."

Claude calls `manageRoles` with `action: "delete"`. The file is removed and the frontend refreshes.

### Listing custom roles

> "What custom roles have I created?"

Claude reads the `~/mulmoclaude/roles/` directory and lists them. No tool call needed — Claude can use built-in file tools.

---

## Role File Format

Each custom role is a JSON file at `~/mulmoclaude/roles/<id>.json`. The schema mirrors the `Role` interface in `src/config/roles.ts`:

```json
{
  "id": "pythonCoder",
  "name": "Python Coder",
  "icon": "code",
  "prompt": "You are a Python expert. Help the user write, debug, and optimize Python code. Use presentDocument to show code explanations in a structured format.",
  "availablePlugins": ["presentDocument", "generateImage", "switchRole"],
  "queries": [
    "Help me write a Python script to parse CSV files",
    "Debug this Python code"
  ]
}
```

Rules:
- `id` must be unique and must not clash with built-in role IDs
- `availablePlugins` values must be from the known plugin registry (validated on write)
- `switchRole` is automatically added to `availablePlugins` if not present
- `icon` is a Material Symbols icon name (same as built-in roles)

---

## Architecture

### New: `~/mulmoclaude/roles/` directory

Created by `server/workspace.ts` alongside existing subdirs (`chat`, `todos`, etc.).

### New: `server/routes/roles.ts`

```
GET  /api/roles           → returns merged array of built-in + custom roles
POST /api/roles           → used by manageRoles tool (create/update)
DELETE /api/roles/:id     → used by manageRoles tool (delete)
```

The GET endpoint reads `~/mulmoclaude/roles/*.json` at request time (no caching needed — filesystem is fast). It merges custom roles after built-in ones. Custom roles with a clashing ID override built-ins.

### Modified: `server/roles.ts` (new shared loader)

Extract role loading logic here so both the HTTP routes and the agent can use it:

```typescript
export function loadAllRoles(): Role[] {
  const custom = loadCustomRoles(); // reads ~/mulmoclaude/roles/*.json
  const builtIn = BUILTIN_ROLES.filter(r => !custom.find(c => c.id === r.id));
  return [...builtIn, ...custom];
}
```

### Modified: `server/routes/agent.ts`

Replace `import { getRole } from '../../src/config/roles.js'` with a call to `loadAllRoles()` so the agent picks up custom roles.

### Modified: `server/agent.ts`

Replace `ROLES.map(r => r.id)` with `loadAllRoles().map(r => r.id)` so the `switchRole` enum in the MCP server includes custom role IDs.

### Modified: `server/mcp-server.ts`

No structural change needed — it already reads `ROLE_IDS` from the env var, which the agent sets dynamically.

### New: `manageRoles` tool

A local plugin (`src/plugins/manageRoles/`) that Claude calls to create/update/delete role files.

**Tool definition** (server-side only, no canvas view needed):
```typescript
{
  name: "manageRoles",
  description: "Create, update, or delete a custom user role stored in ~/mulmoclaude/roles/. After a successful write or delete, the frontend role list will refresh automatically.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["create", "update", "delete"] },
      role: {
        type: "object",
        description: "The full role definition (required for create/update)",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          icon: { type: "string" },
          prompt: { type: "string" },
          availablePlugins: { type: "array", items: { type: "string" } },
          queries: { type: "array", items: { type: "string" } }
        },
        required: ["id", "name", "icon", "prompt", "availablePlugins"]
      },
      roleId: {
        type: "string",
        description: "The role ID to delete (required for delete)"
      }
    },
    required: ["action"]
  }
}
```

**Execute logic** (`server/routes/roles.ts`):
1. Validate `availablePlugins` against `getAllPluginNames()`
2. Ensure `id` does not clash with built-in role IDs (block overriding built-ins via this tool)
3. Write/delete the JSON file
4. Return the updated roles list as the tool result
5. Emit a `roles_updated` SSE event so the frontend reloads

**No canvas view** — the result is just a confirmation message. Use `text-response` plugin type for the tool result.

### Modified: `src/App.vue`

- On mount, fetch `GET /api/roles` instead of importing `ROLES` directly from `src/config/roles.ts`
- Listen for a `roles_updated` SSE event during an active agent stream → re-fetch `GET /api/roles`
- The role dropdown re-renders automatically via reactivity

### Modified: `src/config/roles.ts`

- Rename `ROLES` to `BUILTIN_ROLES` (or keep `ROLES` but export it as `BUILTIN_ROLES` too) so the server can distinguish built-in from custom when needed

---

## SSE Event: `roles_updated`

Emitted by the `manageRoles` route handler after a successful write/delete. The frontend listens for this during streaming and re-fetches the role list:

```typescript
// server emits:
{ type: "roles_updated" }

// client handles:
case "roles_updated":
  await refreshRoles(); // GET /api/roles
  break;
```

---

## Implementation Steps

1. **`server/workspace.ts`** — add `roles` to `SUBDIRS`
2. **`src/config/roles.ts`** — export `BUILTIN_ROLES` alias
3. **`server/roles.ts`** (new) — `loadAllRoles()` and `loadCustomRoles()` functions
4. **`server/routes/roles.ts`** (new) — REST endpoints + `manageRoles` execute handler
5. **`src/plugins/manageRoles/definition.ts`** (new) — tool definition
6. **`src/plugins/manageRoles/index.ts`** (new) — registers as text-response plugin (no custom view)
7. **`server/mcp-server.ts`** — add `manageRoles` to `ALL_TOOLS` and `TOOL_ENDPOINTS`
8. **`src/tools/index.ts`** — register `manageRoles` plugin
9. **`server/routes/agent.ts`** — use `loadAllRoles()` for `getRole()`
10. **`server/agent.ts`** — use `loadAllRoles()` for `ROLE_IDS`
11. **`src/App.vue`** — fetch roles from `/api/roles`, handle `roles_updated` event
12. **`src/config/roles.ts`** — add `manageRoles` to the `general` role's `availablePlugins`
13. **`server/agent.ts`** — add `manageRoles` to `MCP_PLUGINS`

---

## Constraints & Edge Cases

- **Built-in roles cannot be deleted** via the tool — only custom roles in `~/mulmoclaude/roles/`
- **Plugin validation**: only plugins in the known registry are allowed — the tool returns a clear error listing valid options if an unknown plugin is specified
- **ID collision with built-ins**: blocked; user must choose a different ID
- **Switching to a new role**: after creation, Claude can immediately call `switchRole` to jump the user into their new role
- **Role persistence**: custom roles survive app restarts since they live in the filesystem
- **Schema forward-compat**: unknown fields in role JSON files are ignored on load
