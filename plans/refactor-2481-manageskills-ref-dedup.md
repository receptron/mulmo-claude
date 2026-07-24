# refactor(manageSkills): single-source the Ref field lists (#2481)

Code Scanning alerts #436 / #437: inside `src/plugins/manageSkills/`, the private
`State` record and the exported composable interface enumerate the *same* Ref
fields twice. Adding a field means editing two lists, and adding it to only one
of them is not a type error — the field silently never reaches the consumer.

## The duplicated lists

| File | private State | public interface | duplicated Refs |
|---|---|---|---|
| `useSkillCatalog.ts` | `CatalogState` | `SkillCatalog` | 7 (`catalogPresets`, `catalogExternal`, `catalogError`, `selectedCatalog`, `catalogDetail`, `catalogDetailLoading`, `catalogActioningKey`) |
| `useExternalRepos.ts` | `ReposState` | `ExternalRepos` | 11 (`catalogRepos`, `repoCollapsed`, `addRepoOpen`, `addRepoUrl`, `addRepoSubpath`, `addRepoError`, `addRepoBusy`, `suggestions`, `selectedSuggestionUrl`, `uninstallingRepoId`, `updatingRepoId`) |

There is in fact a **third** enumeration in each file: the object literal the
factory returns (`useSkillCatalog`'s `return { catalogPresets, … }`,
`useExternalRepos`'s `return { catalogRepos: state.catalogRepos, … }`). So today
a new Ref costs three hand-edits.

## Approach

Per the issue: extract a shared base interface holding *only* the Refs, and have
both the State record and the public interface `extends` it.

```ts
interface CatalogRefs {
  catalogPresets: Ref<CatalogEntry[]>;
  // …Refs only
}
interface CatalogState extends CatalogRefs { t: TranslateFn; endpoints: SkillsEndpoints; deps: SkillCatalogDeps }
export interface SkillCatalog extends CatalogRefs { selectedCatalogKey: ComputedRef<string | null>; loadCatalog(): Promise<void>; /* …methods */ }
```

To also kill the third (runtime) enumeration, each factory builds the Refs once
through a `create*Refs(): *Refs` helper and spreads that bundle into both the
state record and the returned object:

```ts
const refs = createCatalogRefs();
const state: CatalogState = { t, endpoints, deps, ...refs };
return { ...refs, selectedCatalogKey, loadCatalog: () => loadCatalog(state), … };
```

Spreading copies the Ref *objects*, so the state record and the returned object
share one Ref instance per field — identical runtime behaviour to the current
hand-written literals.

Net: adding a Ref is **one edit to the field list** (`CatalogRefs` /
`ReposRefs`). The initial value must still be given in `create*Refs`, but that is
not a second *list* — the compiler refuses to build the object without it, so it
cannot be silently forgotten. Nothing else in either file, and nothing in
`View.vue`, needs touching.

## Fields that stay hand-declared (with reason)

- `SkillCatalog.selectedCatalogKey` (`ComputedRef`) — derived from
  `selectedCatalog` in the factory, never stored in the state record.
- `ExternalRepos.externalGroups` (`ComputedRef`) — derived from
  `deps.catalogExternal` + `catalogRepos`, also factory-local.
- `t` / `endpoints` / `deps` on the State records — deliberately private; they
  are exactly the fields that must NOT leak into the public surface.
- Methods on the public interfaces — they have no counterpart in the state
  record, so there is nothing to fold.

## Non-goals

- No runtime behaviour change; no change to the public API shape (same keys,
  same Ref identities).
- No touching of `CatalogDetailPane.vue` / `AddRepoModal.vue` (#2472) or
  `actionLock.ts` (#2479).

## Verification

- `yarn typecheck` is the load-bearing gate (type-only refactor), plus
  `yarn format`, `yarn lint`, `yarn build`.
- `yarn test` for the manageSkills unit tests (`test/plugins/manageSkills/`).
- Double-edit proof: temporarily add a probe Ref to `CatalogRefs` only and
  confirm (a) the factory fails to compile until the initial value is supplied
  and (b) `View.vue` can consume `catalog.<probe>` with no edit to `SkillCatalog`
  — i.e. the public interface picked the field up for free. Revert afterwards.
