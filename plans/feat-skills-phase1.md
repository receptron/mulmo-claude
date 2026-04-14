# feat: conversation → skill capture + delete (skills phase 1)

Tracks #233. Parent: #139. Follows phase 0 (PR #224).

## Goal

Let the user turn the current chat into a reusable skill with a single request, and delete unwanted ones. All writes happen under the **project scope** (`~/mulmoclaude/.claude/skills/`); user-level `~/.claude/skills/` stays read-only.

## UX flow

```text
User (after a productive conversation):
  「この会話を `fix-ci` という skill にして」
  or just: 「skill 化して」

Claude (automatic):
  1. Read `chat/<session-id>.jsonl` via the existing Read tool
  2. Distill: pick a slug, write a short description, synthesize the body
  3. Call manageSkills({ action: "save", name, description, body })

Server:
  1. Validate slug (lowercase alpha-num + hyphen, 1-64 chars)
  2. Fail if ~/mulmoclaude/.claude/skills/<slug>/ already exists
  3. Write SKILL.md atomically
  4. Return { saved: true, path }

Claude response:
  「`/fix-ci` として保存しました」
  + manageSkills view reflects the new skill immediately
```

For **delete**, the user either clicks the Delete button in the manageSkills split pane (project-scope only), or asks Claude to delete a named skill — which triggers `manageSkills({ action: "delete", name })`.

## Non-goals (phase 1)

- Pre-save preview / diff UI — direct write; users can delete & redo
- Skill editing from the web UI — Phase 2 (markdown editor)
- Typed parameter model / placeholder prompts — Phase 2+
- Auto-triggered skills / scheduler integration — Phase 2+
- User-scope (`~/.claude/`) CRUD — intentionally never, for safety
- Rename / versioning — defer

## Design

### Tool shape — extend `manageSkills` with an `action` parameter

Mirrors the `manageRoles` precedent. Keeps one tool, one plugin, one View.

```ts
// src/plugins/manageSkills/definition.ts
parameters: {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["list", "save", "delete"],
      description: "list (default): show all discovered skills. save: persist a new project-scope skill. delete: remove a project-scope skill.",
    },
    name: { type: "string", description: "Slug (required for save/delete). Must match ^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$, 1-64 chars." },
    description: { type: "string", description: "One-line summary for the YAML frontmatter (required for save)." },
    body: { type: "string", description: "Markdown instructions for the skill (required for save)." },
  },
  required: ["action"],
},
```

The `prompt` field tells Claude when to call each action:

> Use this tool when the user asks to see, save, or delete a skill.
>
> - **save**: when the user asks to turn the current conversation into a skill. First read the chat jsonl file via the Read tool (`chat/<session-id>.jsonl`), distill the user's request and your successful steps into a short markdown body, choose a kebab-case slug, and call this tool with `action: "save"`.
> - **delete**: when the user asks to remove a named skill, call with `action: "delete"` and the skill's name.
> - **list** (default): when the user just wants to browse — no arguments needed.

### Server — writer module + paths

```text
server/skills/
  paths.ts           ← projectSkillsDir(), projectSkillPath(workspaceRoot, slug), isValidSlug()
  writer.ts          ← saveProjectSkill() / deleteProjectSkill()
  discovery.ts       ← phase 0, unchanged (still scans both scopes)
```

- `isValidSlug`: identical rule to `server/sources/paths.ts` (already in repo, copy the regex)
- `saveProjectSkill`: atomic write to a tmp file then rename. Fail if `<slug>/SKILL.md` already exists — never overwrite.
- `deleteProjectSkill`: refuse if the skill was discovered under the user scope (guard against accidental user-dir delete even if someone passes the wrong slug)

```ts
// Composed SKILL.md output
`---
description: ${escapeYaml(description)}
---

${body.trimEnd()}
`
```

### REST routes

Extend `server/routes/skills.ts`:

| Route                  | Action                                                                  |
| ---------------------- | ----------------------------------------------------------------------- |
| `GET /api/skills`      | (phase 0) list merged user + project skills                             |
| `GET /api/skills/:name`| (phase 0) detail                                                         |
| **`POST /api/skills`** | **new**: save a project-scope skill. Body: `{ name, description, body }` |
| **`DELETE /api/skills/:name`** | **new**: delete a project-scope skill                           |

Responses:
- 200: `{ saved: true, path }` or `{ deleted: true }`
- 400: `{ error: "invalid slug: ..." }` / `{ error: "description/body required" }`
- 409: `{ error: "skill already exists: <name>" }`
- 403: `{ error: "cannot modify user-scope skill: <name>" }` (delete)
- 404: `{ error: "skill not found: <name>" }` (delete)

### MCP bridge (`server/mcp-server.ts`)

Extend `handleManageSkills` so it switches on `action`:

```ts
async function handleManageSkills(args: Record<string, unknown>): Promise<string> {
  const action = args.action ?? "list";
  if (action === "list") { ... phase 0 code ... }
  if (action === "save") {
    // POST to /api/skills
    // On success: push a tool_result with the updated list (or a minimal "saved" card)
  }
  if (action === "delete") {
    // DELETE /api/skills/:name
    // Push an updated list
  }
  throw new Error(`unknown action: ${action}`);
}
```

### Plugin client (`src/plugins/manageSkills/`)

- `index.ts`: `execute` switches on `args.action` and POSTs / DELETEs accordingly. On success refetches the list and returns it so the canvas shows the updated state.
- `View.vue`: add a **Delete** button next to **Run**, visible only when `detail.source === "project"`. On click, prompt for confirmation (native confirm() is fine for phase 1) and call `manageSkills({ action: "delete", name })` by dispatching the existing `skill-run`-style event (or direct fetch — since it's a project-local action, going via Claude is unnecessary). For phase 1 simplicity: **direct fetch DELETE** from View.vue, then re-emit a refresh event.

### Workspace setup

`~/mulmoclaude/.claude/skills/` must exist before first save. Auto-create on first save via `mkdir({ recursive: true })` in `saveProjectSkill`.

## Tests

- `test/skills/test_paths.ts` — `isValidSlug` (copy-paste from sources/paths.ts; keep them in sync)
- `test/skills/test_writer.ts` — save: happy path, slug rejection, name collision (409), atomic-write recovery (if possible). delete: happy path, project-only guard, 404
- `test/routes/test_skillsRoute.ts` — POST / DELETE endpoints, status codes, validation
- `test/skills/test_discovery.ts` — regression: a freshly-written project skill shows up next scan
- `e2e/tests/skills.spec.ts` — new cases:
  - Save action: mock `POST /api/skills`, assert the new skill appears in the list refetch
  - Delete button: visible on project skills, hidden on user skills; click triggers DELETE and list refresh

## Security

- **All writes go through `isValidSlug`** — no path traversal
- **Writes only inside `~/mulmoclaude/.claude/skills/`** — hard-coded base
- **Refuse to delete user-scope skills** even if slug matches
- Existing localhost-only bind covers external attack surface

## Rollout

1. PR branches off main after #224 lands (✅ done, merged 2026-04-14T05:43Z)
2. Incremental commits: paths → writer → routes → plugin client → View → e2e
3. Manual smoke: with a running session, ask "skill 化して", confirm file is created + reappears in list + Delete button works
