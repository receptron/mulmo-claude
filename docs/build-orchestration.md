# Build orchestration (`yarn build:packages`)

Read this when adding a new workspace package, debugging a "Cannot find module" cold-install error, or touching `scripts/build-workspaces.mjs`. The dependency-direction rule that the tier order enforces is in [`CLAUDE.md`](../CLAUDE.md#package-dependency-direction-always-apply).

The script runs **five tiers in order**:

0. `@mulmoclaude/common` — alone, and first. The zero-dep leaf every other tier may import; `@mulmoclaude/markdown-utils` takes a real dependency on it (`escapeHtml`, #2483), so it cannot share tier 1's parallel group without racing that package's `tsc`.
1. `@mulmobridge/protocol` + `@mulmobridge/web-push` + `@mulmobridge/webhook-runtime` + `@receptron/task-scheduler` + `@mulmoclaude/markdown-utils` — no deps beyond tier 0, run in parallel
2. `@mulmobridge/{client, chat-service, mock-server}` + `@mulmoclaude/core` — depend on tiers 0-1
3. **All bridges** under `packages/bridges/*` whose name starts with `@mulmobridge/` and has a `build` script
4. **All runtime plugins** under `packages/plugins/*` whose name starts with `@mulmoclaude/` AND ends with `-plugin` and has a `build` script

Tiers 3 and 4 are auto-discovered by `scripts/build-workspaces.mjs`. Tiers 0-2 stay explicit in `package.json` because their dep-graph order can't be globbed.

**Before adding a workspace-internal dep to a tier-0/1/2 package**, check that the target builds in an EARLIER tier. Two packages in the same `concurrently` group are genuinely parallel — a `tsc` consumer starting before its producer emits `dist/*.d.ts` fails cold, and passes on a warm tree, so the breakage only ever shows up in CI.

## Adding a new workspace

**Bridge** — just create `packages/bridges/<name>/` with name `@mulmobridge/<name>` and `scripts.build`. Auto-discovery in tier 3 picks it up, no root `package.json` edit needed.

**Runtime plugin** — see [`docs/plugin-development.md`](plugin-development.md). Auto-discovery in tier 4 picks it up if it follows the `@mulmoclaude/<name>-plugin` naming.

**Anything else** (non-bridge `@mulmobridge/*` like `mock-server`, any `@receptron/*`, or a new top-level core package that other workspaces depend on) MUST be added to the explicit tier-1 / tier-2 enumeration in the root `package.json`; auto-discovery won't pick it up.

## The `@mulmoclaude/foo-plugin` naming trap

NEVER name a non-runtime-plugin package `@mulmoclaude/foo-plugin` (e.g. a helper library). The build driver will try to run its `build` script in tier 4, after every consumer has already been built. Pick a different name (`@mulmoclaude/foo`, `@mulmoclaude/foo-helpers`, …) or fold it into `@mulmoclaude/core`.

## yarn 4 compatibility

The `yarn4_smoke` workflow verifies the chain still works under yarn 4. Both tiers' driver only spawns `yarn workspace <name> run build` — identical syntax in yarn 1 and 4 — so portability is preserved.

## "Cannot find module" cold

When the build complains "Cannot find module `@mulmoclaude/foo`" cold (after `yarn install` + `yarn build:packages`), the cause is almost always an uphill or peer import that the build-order tier system can't resolve. **Don't patch with a new tier or a `--first=foo` flag** — surface the import and move the code instead. The canonical fix recipe is in [`CLAUDE.md`](../CLAUDE.md#package-dependency-direction-always-apply); the post-mortem of one such loop is [`plans/done/refactor-shared-core.md`](../plans/done/refactor-shared-core.md).
