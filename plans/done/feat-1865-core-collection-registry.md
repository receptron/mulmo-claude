# feat: Extract collection registry import/export engine into @mulmoclaude/core (#1865)

## Goal

Move the collection registry import/export engine out of the MulmoClaude app
(`server/workspace/collectionsRegistry/`) into `@mulmoclaude/core` so a second
live host (MulmoTerminal) can light up the Discover / registry tab over the same
workspace. Mirror the existing `@mulmoclaude/core/collection` ↔
`collection/server` split and reuse the already-established
`configureCollectionHost` dependency-injected host.

**No behavior change.** Pure relocation + DI; the only new surface is two core
subpath exports and one extra injected path helper.

## Decisions (confirmed with user)

- Include **all** engine files in core, incl. `client.ts` and `performExport.ts`
  (not only the issue's explicit list).
- Path resolution for `config/collections-registries.json` is done by **adding a
  method to the injected host** (`CollectionHost.paths.collectionsRegistriesConfig`),
  not by hard-coding the layout in the package.

## Target structure

```
packages/core/src/collection/registry/
  guards.ts            # isRecord (isomorphic; no shared core guard exists)
  registryIndex.ts     # parseRegistryIndex + RegistryEntry + RegistryIndex (pure)
  types.ts             # RegistrySummary / RegistryListResponse / RegistryImportResponse
                       #   + RegistryConfigEntry + OFFICIAL_REGISTRY_NAME (contract)
  index.ts             # isomorphic barrel
  server/
    index.ts           # node engine barrel + listRegistry()/importRegistry() helpers
    fetch.ts           # fetchWithTimeout (ported from app utils/fetch.ts)
    registriesConfig.ts# parseRegistriesConfig + loadRegistriesConfig (host path + fs)
    client.ts          # listRegistries / findRegistry / fetchAllRegistries / cache
    collectionFiles.ts # fetchCollectionFile / previewCollection / rawBaseForEntry
    importCollection.ts# manifest/bundle fetch + safe-path transforms
    importWriter.ts    # writeImportedCollection / performImport (node:fs)
    exportCollection.ts# writeCollectionExport (node:fs, host-independent)
    performExport.ts   # thin glue: loadCollection + SKILL.md description -> writeCollectionExport
    skillDescription.ts# minimal SKILL.md `description:` reader (core has no js-yaml dep)
```

`RegistryCollectionEntry` is renamed to `RegistryEntry` to match the published
plugin contract (`collection-plugin/src/vue/uiContext.ts`) — single source of truth.

### Cross-entry imports inside core

Core already references sibling subsystems by **relative path** (e.g.
`feeds/server/engine.ts` → `../../collection/server/index.js`), and rollup keeps
shared modules (incl. the `host.ts` singleton) in a shared chunk — feeds depends
on the collection host singleton and works in production. The registry engine
follows the same convention:

- `../../server/index.js` — `collection/server` (acceptParsedSchema, CollectionSchemaZ, isSafeActionTemplatePath, safeRecordId, loadCollection)
- `../../server/host.js` — `log`, new `collectionsRegistriesConfigPath()`
- `../../server/util.js` — `errorMessage`, `ONE_SECOND_MS` (added)
- `../../server/atomic.js` — `writeFileAtomic`
- `../../index.js` — `collection` (CollectionSchema type)
- `../../../skill-bridge/index.js` — claudeSkillDir / dataSkillDir / mirrorSkillWrite

## Steps

1. **Host path method**: add `collectionsRegistriesConfig: (workspaceRoot) => string`
   to `CollectionHost.paths` in `collection/server/host.ts`; add getter
   `collectionsRegistriesConfigPath()`. Add `ONE_SECOND_MS` to
   `collection/server/util.ts`.
2. **Core isomorphic** files (guards, registryIndex, types, index).
3. **Core server** files (relocated engine, relative imports, host path getter).
4. **Build wiring**: add `collection/registry/index` and
   `collection/registry/server/index` to `vite.config.ts`; add `./collection/registry`
   and `./collection/registry/server` to `package.json` exports; bump core version.
5. **App route** `server/api/routes/collectionsRegistry.ts`: import types from
   `@mulmoclaude/core/collection/registry` + engine from
   `@mulmoclaude/core/collection/registry/server`; drop the inline mapping by using
   `listRegistry()`; keep `workspacePath` for import/export.
6. **App host wiring** `server/workspace/collections/configure.ts`: supply
   `collectionsRegistriesConfig` using `WORKSPACE_FILES.collectionsRegistries`.
7. **Delete** `server/workspace/collectionsRegistry/` (all 8 files).
8. **Tests**: move the 7 `test/server/test_*.ts` registry tests to
   `packages/core/test/collection/registry/` and repoint imports to core source.
   All are host-independent (explicit workspaceRoot / loader seam / `log` no-ops
   when the host is unconfigured).

## Verification

Build order matters — the app resolves `@mulmoclaude/core` via dist:

1. `yarn workspace @mulmoclaude/core build`
2. `yarn workspace @mulmoclaude/core test`
3. root `yarn typecheck`, `yarn lint`, `yarn build`, `yarn test`

## Acceptance criteria (from #1865)

- [ ] `@mulmoclaude/core` exports `./collection/registry` and `./collection/registry/server`.
- [ ] Engine is workspace-injected (no hard-coded app paths).
- [ ] App consumes core; no registry engine code remains in `server/`.
- [ ] All registry import/export tests pass (relocated); build/typecheck/lint green.
- [ ] New publishable `@mulmoclaude/core` version.

## Out of scope

MulmoTerminal wiring (separate repo, after a new core is published).
