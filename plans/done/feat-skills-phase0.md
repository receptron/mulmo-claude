# feat: invoke existing Claude Code skills from MulmoClaude (phase 0)

Tracks #221. Parent: #139.

## Goal

Let the user pick a skill they already have under `~/.claude/skills/<name>/SKILL.md` and run it from the MulmoClaude UI. Read-only discovery + trigger via the existing `startChat` pipeline. No conversation-to-skill capture, no scheduling, no parameter dialog — all deferred to later phases of #139.

## Non-goals (phase 0)

- Capturing a conversation as a new skill (#139 "会話→skill 化")
- Auto-triggered / scheduled execution (#139 "自動実行")
- Typed parameter capture UI (v0 relies on free-form user input)
- Skill CRUD from the web UI (read-only in phase 0)

## Design

### Data model

A **Skill** is the parsed shape of one `SKILL.md` file.

```ts
interface Skill {
  /** Directory name under skills/, e.g. "ci_enable". */
  name: string;
  /** The `description` field from YAML frontmatter. */
  description: string;
  /** Full markdown body (everything after frontmatter). */
  body: string;
  /** "user" = ~/.claude/skills, "project" = <workspace>/.claude/skills. */
  source: "user" | "project";
  /** Resolved absolute path to the SKILL.md file (post-symlink). */
  path: string;
}
```

### Discovery

`server/skills/discovery.ts` exports `discoverSkills(opts)`:

- Scans `~/.claude/skills/` (user) and `$WORKSPACE/.claude/skills/` (project)
- For each entry that is a directory (or a symlink resolving to a directory), reads `SKILL.md`
- Parses YAML frontmatter (`description` only) + captures body
- Silently skips directories without `SKILL.md`, malformed frontmatter, or unreadable files
- Warns to the structured logger on partial failures (not fatal)
- Deduplication: if the same skill name appears at both scopes, project wins (same logic as #197's settings resolution)

Pure helpers:
- `parseSkillFrontmatter(rawContent: string): { description: string; body: string } | null` — testable without filesystem
- `collectSkillsFromDir(dir: string, source: Skill["source"]): Promise<Skill[]>` — integration-testable with mkdtempSync

### REST API

`server/routes/skills.ts`:

| Endpoint | Response |
|---|---|
| `GET /api/skills` | `{ skills: Pick<Skill, "name" \| "description" \| "source">[] }` — lightweight list for the UI grid |
| `GET /api/skills/:name` | `{ skill: Skill }` — full body for the detail view |

404 when the name isn't present. No POST/PUT/DELETE in phase 0.

Route uses the same Express type-safety pattern (`Request<MyParams, unknown, MyBody>`) the rest of the server uses.

### Web UI (`src/plugins/manageSkills/`)

Mirrors `src/plugins/manageRoles/`:

- `definition.ts` — tool definition for the plugin palette
- `index.ts` — `ToolPlugin` wiring: `execute` returns the list (backed by `/api/skills`)
- `View.vue` — full canvas view: skills grid (description), click to open detail pane with body + "Run" button
- `Preview.vue` — sidebar preview (just the list count + hint)

### Execution

The "Run" button in `View.vue` simply dispatches a message through the existing `startChat` path:

```ts
emit("run-skill", { message: `Use the ${skillName} skill.` });
```

App.vue catches it and calls its existing `sendMessage()` helper. The Claude CLI already recognizes the Skill tool at spawn time (user's `~/.claude/skills/` is on its default discovery path), so no server-side agent changes are needed.

### Registration

Add `manageSkills` to:
- `server/mcp-server.ts` `TOOL_ENDPOINTS` + `ALL_TOOLS`
- `src/tools/index.ts` plugin registry
- `src/config/roles.ts` — at least one role's `availablePlugins`. Start with the `general` role.
- `server/agent.ts` `MCP_PLUGINS`

### Tests

- `test/skills/test_parseSkillFrontmatter.ts` — happy / missing frontmatter / malformed YAML / empty body
- `test/skills/test_collectSkillsFromDir.ts` — mkdtempSync harness: regular dir / symlink resolution / missing SKILL.md / unreadable
- `test/skills/test_discoverSkills.ts` — user + project merge + project-wins precedence
- `test/routes/test_skillsRoute.ts` — list + detail + 404
- E2E (`e2e/tests/skills.spec.ts`) — UI renders list, clicking a skill reveals detail, Run button fires an agent call

## File additions

```text
server/skills/
  index.ts               ← public API (discoverSkills)
  discovery.ts           ← scan + merge logic
  parser.ts              ← parseSkillFrontmatter (pure)
  types.ts               ← Skill interface

server/routes/skills.ts  ← GET /api/skills + GET /api/skills/:name

src/plugins/manageSkills/
  definition.ts
  index.ts
  View.vue
  Preview.vue

test/skills/
  test_parser.ts
  test_discovery.ts

test/routes/test_skillsRoute.ts

e2e/tests/skills.spec.ts
```

## Known limitations (phase 0)

### Docker sandbox + symlinked skills

MulmoClaude's default Docker sandbox mounts `~/.claude` into the container at `/home/node/.claude`. When an entry under that path is a **symlink** pointing outside `~/.claude/` (e.g. `~/.claude/skills` → `~/ss/dotfiles/claude/skills`), the symlink appears in the container as a **dangling link** — the target path doesn't exist inside the container, so the Claude CLI cannot resolve the skill.

**Observed symptom:** in the MulmoClaude UI, the manageSkills list is empty (only built-in skills from the CLI itself) and Run button fires `"Unknown skill: <name>"`.

**Workaround:** run MulmoClaude with `DISABLE_SANDBOX=1 yarn dev` to bypass the sandbox. Slash commands then resolve against the host's real `~/.claude/skills/` directly.

**Not addressed in phase 0** because:

- Resolving multi-level symlink chains (e.g. `~/.claude/skills/pptx` → `~/ss/llm/skills/pptx`) requires recursive realpath + adding each target as a separate Docker mount. Complex and user-specific.
- The workaround (`DISABLE_SANDBOX=1`) is documented and easy.
- Most users do not have symlinked `~/.claude` setups.

Users with symlinked skill trees should either (a) use `DISABLE_SANDBOX=1`, (b) place skills they want in the sandbox under the project scope (`~/mulmoclaude/.claude/skills/`) which is mounted as the workspace, or (c) run with a flat (non-symlinked) `~/.claude/skills/` dir.

## Phase 1+ follow-ups (out of scope)

- Accept an explicit `skillsRoot` env var / config so a user can point at a shared skills repo
- Parameter dialog: parse `{{placeholder}}` in the body and prompt before run
- Schedule: `cron` trigger → fire `startChat` automatically
- "conversation → skill" capture flow (#139 main)
- CRUD from the UI
