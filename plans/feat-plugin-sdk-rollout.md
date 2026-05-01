# Plan: Plugin SDK rollout (Phase 1 + 2 of #1043)

Tracking: #1043 — umbrella for plugin SDK / dynamic install / marketplace.

## Scope of this plan

Phases 1 & 2 only. **Phase 3+ (C-2 dynamic loader, C-4 marketplace) are deferred** — they require a permission model that we don't have yet, and "公式 registry のみ install 許可" is a strategy decision separate from this plan.

| Phase | Stages | Goal |
|---|---|---|
| 1 | C-1 + C-5 | Internal productivity boost (manifest-driven registration) + protocol stability commitment so external authors can depend on `gui-chat-protocol` semver |
| 2 | C-3 | External-developer-ready: scaffold CLI + dev doc + public types so people outside the repo can write a plugin |

## Phase 1: C-1 (manifest) + C-5 (semver)

### C-1: collapse 8-file plugin registration to a manifest

#### Current state (8 touch points per plugin)

For a sample plugin (`manageTodoList`):

| # | File | What gets added |
|---|---|---|
| 1 | `server/agent/plugin-names.ts:7` | `import TodoDef from "../../src/plugins/todo/definition.js";` |
| 2 | `server/agent/plugin-names.ts:28` | `[TodoDef.name]: API_ROUTES.todos.dispatch,` (in `TOOL_ENDPOINTS`) |
| 3 | `server/agent/plugin-names.ts:52` | `TodoDef,` (in `PLUGIN_DEFS` array) |
| 4 | `src/tools/index.ts:14` | `import todoPlugin from "../plugins/todo/index";` |
| 5 | `src/tools/index.ts:25` | `manageTodoList: todoPlugin,` (in `plugins` map) |
| 6 | `src/config/toolNames.ts:25` | `manageTodoList: "manageTodoList",` (in `TOOL_NAMES`) |
| 7 | `src/config/apiRoutes.ts:194` | per-plugin route shape (plugin-specific, not auto-derivable) |
| 8 | `server/api/routes/<name>.ts` | route handler (plugin-specific, not auto-derivable) |

#### Proposed manifest

A single TS file (`config/plugins.registry.ts`) is the source of truth:

```ts
import type { PluginRegistration } from "../packages/protocol/src/registration.js";

export const PLUGIN_REGISTRY: readonly PluginRegistration[] = [
  // Internal plugins
  { id: "manageTodoList", dir: "src/plugins/todo", endpointKey: "todos.dispatch" },
  { id: "manageCalendar", dir: "src/plugins/scheduler", endpointKey: "scheduler.base", definitionFile: "calendarDefinition.ts" },
  { id: "manageAutomations", dir: "src/plugins/scheduler", endpointKey: "scheduler.base", definitionFile: "automationsDefinition.ts" },
  // ... (rest of the 18 internal + 6 external plugins)

  // External plugins (npm packages) — pulled in via package import
  { id: "createMindMap", external: "@gui-chat-plugin/mindmap", endpointKey: "plugins.mindmap" },
  { id: "putQuestions", external: "@mulmochat-plugin/quiz", endpointKey: "plugins.quiz" },
  // ...
];
```

Fields:

- `id` — the canonical tool name (string literal, the same key the LLM uses)
- `dir` (internal) or `external` (npm package) — where to import from
- `endpointKey` — dotted path into `API_ROUTES` (`todos.dispatch`, `wiki.base`, …)
- `definitionFile` (optional) — non-default name for the definition file (e.g. scheduler has 2 definitions)

#### Codegen

`scripts/generate-plugin-registry.mjs` reads `PLUGIN_REGISTRY` and emits:

1. **`server/agent/plugin-names.ts`** — import all `*Def` files + build `TOOL_ENDPOINTS` map + `PLUGIN_DEFS` array
2. **`src/tools/index.ts`** — import all `*Plugin` files + build `plugins` registry
3. **`src/config/toolNames.ts`** — derive `TOOL_NAMES` const from registry ids

Does NOT touch:

- `src/config/apiRoutes.ts` (plugin-specific route shapes stay hand-coded; `endpointKey` references existing entries)
- `server/api/routes/<name>.ts` (per-plugin handlers stay)
- role config (`availablePlugins` is a per-role decision, not a plugin property)

#### Trigger + CI guard

- New yarn script `yarn generate:plugins` runs the codegen
- CI runs it then `git diff --exit-code -- server/agent/plugin-names.ts src/tools/index.ts src/config/toolNames.ts` so a manifest edit without committing the generated files trips CI
- Same pattern as `yarn build:hooks` for the wiki-history snapshot bundle

#### Migration

Per-plugin migration is mechanical:

1. Add a row to `PLUGIN_REGISTRY`
2. Run `yarn generate:plugins`
3. Verify diff matches what the hand-coded version had
4. Delete the hand-coded entries from the 3 generated files (the codegen overwrites them anyway)

Order:

1. Land the codegen + manifest with **one** simple plugin migrated end-to-end (e.g. `notify`)
2. Migrate the remaining 17 plugins in a single follow-up commit (mechanical, low review cost)
3. Document the new flow in `docs/developer.md` "Plugin Development" section

### C-5: protocol stability commitment

#### Where it lives

- `packages/protocol/CHANGELOG.md` — Keep a Changelog format
- `packages/protocol/README.md` — semver policy section + how to read the changelog
- `packages/protocol/MIGRATIONS.md` — template + first entry covering 0.x → 1.x rules

#### Semver policy

Pinned in the README + applied to each release:

- **MAJOR** — a breaking change to:
  - The `ToolDefinition` shape that plugins export (rename / removal of any field)
  - The `ToolResult` wire shape that plugins return
  - The `Attachment` / `EventType` discriminants
  - Any TS type plugins import from the package
- **MINOR** — additive only:
  - New optional fields on existing types
  - New event types / discriminants
  - New helper functions (forward-compatible)
- **PATCH** — bug fixes, doc updates, no API surface change

#### Initial graduation: 0.1.0 → 0.2.0 (or 1.0.0?)

Discuss inside the PR. Argument for 1.0.0: signals the contract is stable for external authors. Argument for 0.2.0: keep a "we may still tweak" buffer. Default to **0.2.0** unless there's specific reason — easier to slip later.

#### Per-release process

Add to `docs/developer.md` and `packages/protocol/CONTRIBUTING.md`:

- Bump version per semver rules above
- Update CHANGELOG (`Added` / `Changed` / `Fixed` / `Breaking`)
- For breaking: write a `MIGRATIONS.md` entry with codemod or manual steps
- Tag `@mulmobridge/protocol@<v>` with the same naming convention used for other published packages

### Phase 1 acceptance criteria

- [ ] `PLUGIN_REGISTRY` is the single source of truth for the 18 internal + 6 external plugins
- [ ] `yarn generate:plugins` regenerates `plugin-names.ts` / `tools/index.ts` / `toolNames.ts` deterministically
- [ ] CI fails when the generated files drift from the manifest
- [ ] All existing tests pass without modification
- [ ] No external plugin (`@mulmochat-plugin/quiz` etc.) breaks
- [ ] `gui-chat-protocol` README declares semver policy
- [ ] `CHANGELOG.md` exists with backfilled entries for the existing 0.1.x releases
- [ ] `MIGRATIONS.md` exists (may be empty initial state, just declares the format)
- [ ] Version bumped to 0.2.0 (or 1.0.0 — TBD in PR review)

## Phase 2: C-3 (SDK + scaffold + dev doc)

### Public types from `gui-chat-protocol`

Today the package exports only the wire-level types (`ToolDefinition`, `ToolResult`, …). For external plugin authors, additionally expose:

- `PluginEntry<TData, TJsonData>` — the runtime registry shape a plugin's `index.ts` should match
- `executeViaApi<T>(endpoint, args)` — a thin helper for the `execute` boilerplate every plugin currently inlines (apiPost + error envelope)
- `defineToolDefinition(...)` — typed builder so plugin authors don't reach for `as const`
- Re-export `Component` types so plugins that ship Vue components don't import the wrong Vue version

### `npx create-mulmoclaude-plugin <name>` scaffold

Lives in a new package `packages/create-mulmoclaude-plugin/`. Generates:

```
my-plugin/
├── package.json          (with @mulmobridge/protocol dep)
├── tsconfig.json
├── src/
│   ├── definition.ts     (TOOL_DEFINITION export)
│   ├── index.ts          (default-export PluginEntry)
│   ├── execute.ts        (server-side handler)
│   └── View.vue          (canvas render)
├── test/
│   └── test_execute.ts   (golden test scaffold)
└── README.md
```

Targets the public API surface of `gui-chat-protocol@>=0.2.0` so the scaffold's deps align with the semver guarantee.

### Developer doc

New file `docs/plugin-development.md`:

1. **Quickstart** — `npx create-mulmoclaude-plugin foo && cd foo && yarn install && yarn build`
2. **Architecture** — what runs server-side (execute) vs browser-side (View component)
3. **Lifecycle** — how a tool call flows: LLM → MCP → execute → ToolResult → View
4. **Testing** — node:test patterns for execute, Playwright patterns for View
5. **Publishing** — `npm publish` to `@<scope>/<name>`; how to register with MulmoClaude (manifest entry today; dynamic install when C-2 lands)
6. **Versioning** — pin to `@mulmobridge/protocol@^0.2.0`; what semver rules apply
7. **Common pitfalls** — Vue version drift, CSS scoping, async handling

### Phase 2 acceptance criteria

- [ ] `packages/create-mulmoclaude-plugin/` published
- [ ] `gui-chat-protocol` exports the new public-API helpers
- [ ] `docs/plugin-development.md` exists and is reachable from `README.md`
- [ ] An existing internal plugin (`weather` or similar) migrated to use the new helpers as a working example
- [ ] CI smoke test runs the scaffold end-to-end (generate → build → unit test)

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Codegen output churn on every PR | Sort manifest entries deterministically; codegen emits header comment with manifest hash so reviewers can see the trigger |
| External plugin breaks because of protocol change | C-5 declares semver before any codegen change touches protocol types |
| Manifest format itself becomes a breaking change | Keep manifest TS-typed (compile errors trip immediately); version manifest schema separately if needed |
| Vue version drift in scaffold | Pin Vue / Vite / Tailwind versions in scaffold's `package.json` to match the host repo at scaffold-generation time |
| `apiRoutes` shape varies wildly per plugin | Don't try to generate it — manifest references existing `endpointKey`. Plugin-specific routes stay hand-coded. |
| Phase 1 stalls Phase 2 | Phase 1 is independently valuable; ship it even if Phase 2 takes longer |

## Out of scope (future plans)

- C-2 (dynamic loader) — needs permission model design (capability declarations, install consent UI, quotas, code signing). Separate plan.
- C-4 (marketplace UI) — depends on C-2.
- Migrating external plugins (`@mulmochat-plugin/quiz` etc.) to use the new SDK helpers — they'll keep working with the legacy API surface for the foreseeable future via Phase 1's manifest.

## Test plan (umbrella, will be split per PR)

- [ ] Unit: codegen output is deterministic given a fixed manifest
- [ ] Integration: every plugin in the manifest passes its existing test suite
- [ ] Build: `yarn build:packages && yarn build` clean after migration
- [ ] CI: drift check between manifest edit and committed generated files
- [ ] Manual: spawn a chat session, exercise 3 representative plugins (a presentation, a generation, a management plugin), confirm none regress
- [ ] Phase 2: `npx create-mulmoclaude-plugin demo && cd demo && yarn build && yarn test` all green
