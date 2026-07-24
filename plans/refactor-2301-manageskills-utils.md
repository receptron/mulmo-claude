# refactor(#2301): manageSkills View.vue — safe-layer utility extraction

Refs #2301. **Scope deliberately narrowed to the SAFE LAYER only.**

The issue's primary prescription is a template→child-component split
(`SkillCatalogList.vue`, `SkillRepoGroup.vue`, `SkillDetailPane.vue`,
`AddRepoModal.vue`, `SkillActiveList.vue`, `CatalogDetailPane.vue`) plus
stateful composables (`useExternalRepos`, `useSkillCatalog`,
`useSkillDetail`). **That split is DEFERRED** because of the dynamic-testid
hazard: `:data-testid="isSelectedPreset ? 'skill-unstar-btn' : 'skill-delete-btn'"`
and `skill-catalog-item-<entryKey>` mean a careless prop hand-off would
silently flip a testid and break `e2e/tests/skills.spec.ts`.

## This PR (safe layer)

Extract the PURE functions into the existing receptacle
`src/plugins/manageSkills/categories.ts`, each WITH tests in
`test/plugins/manageSkills/`. View.vue keeps thin reactive wrappers and
imports the pure logic.

1. **`entryKey(entry)`** — TOP PRIORITY. The unique UI key: `(repoId,
   skillFolder)` for external entries vs `slug` for presets. Its own
   comment warns the external `slug` is lossy and can collide (dup Vue
   keys / testids, wrong-row highlight, shared in-flight lock, stale
   guard bypass) yet it had NO test. `skill-catalog-item-<entryKey>` is a
   live testid, so this is load-bearing. Test hard: external entry,
   preset entry, two externals colliding on slug but differing on repoId,
   missing repoId/skillFolder fallback. **Verify the test is real by
   reverting `entryKey` to return the bare slug and watching the
   collision test go RED.**
2. `catalogActionParams(entry)` — star/preview body shape; comment says
   it exists so the two call sites don't drift. Test both shapes.
3. `groupEntriesByRepo(entries, repos)` — grouping for `externalGroups`:
   preserve repo order, show empty repos. Test ordering + empty-repo.
4. `skillBadgeMeta(skill)` / `PRESET_SOURCE_META` / `repoLabel(repo)` —
   smaller pure helpers. `skillBadge`/`presetSourceMeta` used `t()`, so
   the pure part returns an i18n `titleKey`; View.vue resolves it via
   `t()` in a thin wrapper (template contract `.icon/.title/.colour`
   unchanged).

## Markdown dedup (`useSkillMarkdown`)

`marked` + `sanitizeMarkdownHtml` (+ `useMermaidRenderer`) is duplicated
in `renderedBody` and `catalogRenderedBody`. The mermaid wiring is a
stateful composable, but the `marked`+`sanitize` step is a pure function
of `body`. Decision recorded after checking `sanitizeMarkdownHtml`'s DOM
dependency and node-test feasibility (see PR body).

## Out of scope (deferred follow-up)

- [ ] template → child components (dynamic-testid hazard)
- [ ] `useExternalRepos` / `useSkillCatalog` / `useSkillDetail` composables

## Constraints

Behaviour identical (pure extraction + tests). No `any`, no `as`,
functions < 20 lines. Do not touch any `data-testid`.
