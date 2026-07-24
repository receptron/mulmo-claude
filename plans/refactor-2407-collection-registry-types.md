# refactor(collection): single-source the registry Discover-catalog types (#2407)

## Problem

The collection registry's Discover-catalog contract is declared **twice**:

| Canonical (core) | Duplicate (plugin) |
|---|---|
| `packages/core/src/collection/registry/registryIndex.ts` — `RegistryEntry` | `packages/plugins/collection-plugin/src/vue/uiContext.ts:147-170` — `RegistryEntry` |
| `packages/core/src/collection/registry/types.ts` — `RegistrySummary` / `RegistryListResponse` / `RegistryImportResponse` | `uiContext.ts:173-198` — same three |

jscpd flagged both blocks (80 / 75 tokens). This is the same class of bug as #2334
(`SessionSummary` twin): while two copies of the type exist, the compiler cannot see
the boundary. If the server adds a field to a registry entry, the plugin's copy stays
stale and the build is still green — silent drift.

## Key facts

- The parser (`parseRegistryIndex`) and all four types already live in core and are
  already exported from the **browser-safe** subpath `@mulmoclaude/core/collection/registry`
  (its barrel is explicitly documented "Browser-safe"; the parser only depends on a pure
  `isRecord` guard, no `node:` imports).
- `server/api/routes/collectionsRegistry.ts` already imports `RegistryEntry`,
  `RegistryListResponse`, `RegistryImportResponse` from that subpath — so it is a proven,
  published surface.
- The plugin **never re-implemented the parser** — it only re-declared the types. So the
  "index parsing" jscpd hit is really the `RegistryEntry` interface that happens to sit at
  the top of `registryIndex.ts`. The fix is entirely type-level; no runtime logic moves.
- Package direction is respected: plugin → core is the allowed (downhill) direction. Core
  is untouched, so nothing imports uphill.

## Approach

1. In `uiContext.ts`, delete the four duplicate `interface` declarations
   (`RegistryEntry`, `RegistrySummary`, `RegistryListResponse`, `RegistryImportResponse`).
2. Add `import type { … } from "@mulmoclaude/core/collection/registry"` and re-export the
   same four names, so the plugin's existing consumers (`DiscoverPanel.vue`,
   `vue/index.ts`) keep importing them from `../uiContext` unchanged. Public surface and
   runtime behavior are identical — types are erased at build time, so no `node:` code
   reaches the browser bundle.

## Version discipline

No `@mulmoclaude/core` change → no version bump, no subpath added, no consumer-range sweep.
The subpath already existed and shipped. This is a plugin-only, type-level refactor.

## Tests

The pure parser logic is already covered by
`packages/core/test/collection-registry/test_registryIndex.ts` (happy path, non-object,
schemaVersion, missing fields, count validation, traversal-poisoned author/slug, tag/view
filtering, registryName stamping). No new pure logic is introduced, so no new test file is
warranted.

**Boundary proof** (the point of the refactor, per the issue): temporarily add a required
field to core's `RegistryEntry`, run the plugin's `vue-tsc`, confirm it now errors at the
plugin boundary, then revert. Recorded in the PR's "Items to Confirm / Review".

## Verify

`yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn test`.
