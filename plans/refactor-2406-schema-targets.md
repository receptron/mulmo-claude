# refactor(collection): unify hand-mirrored schema-walk functions (#2406)

## Problem

Three pure `CollectionSchema`-walking functions decide **which linked
collections to preload** and are hand-MIRRORED between server and client:

| copy | file |
|---|---|
| server | `packages/core/src/collection/server/derive.ts` (`uniqueRefTargets` / `uniqueEmbedTargets` / `uniqueBacklinkSources`) |
| client | `packages/plugins/collection-plugin/src/vue/useCollectionRendering.helpers.ts` (same three, exported) |

The comments admit it ("Mirrors the client's `uniqueRefTargets`",
"Mirrors the server's `uniqueBacklinkSources`"). Both sides MUST agree —
server derive/enrich and client linked-cache fetch must preload the same
collections, or one drifts (server derefs a collection the client never
loaded, or the client wastes a load). jscpd flags 87/79/78 tokens.

## Field-by-field diff (both copies)

Logically identical. Only difference: the server copy types the walker
param as `CollectionFieldSpec`; the client copy uses `FieldSpec`, which is
just an import alias — `import type { CollectionFieldSpec as FieldSpec } from "@mulmoclaude/core/collection"`.
**Same type.** Safe to unify.

## Plan

1. Extract the three functions into a new browser-safe module
   `packages/core/src/collection/core/linkTargets.ts` (sibling of
   `backlinks.ts`; no `node:` imports on this path — verified). Export it
   from the `collection/index.ts` barrel so it ships on the existing
   browser-safe subpath `@mulmoclaude/core/collection`.
2. Preserve the WHY comments: table one-level recursion (nested tables
   are schema-rejected), embed top-level only, backlinks/rollup share one
   `from` load.
3. `server/derive.ts`: delete its three copies, import from
   `../core/linkTargets`, drop the "Mirrors" comment.
4. `useCollectionRendering.helpers.ts`: delete its three copies + the
   "Mirrors" comment. Re-point `useLinkedCollectionCaches.ts` (the only
   consumer) to import them from `@mulmoclaude/core/collection`.
5. Tests in `packages/core/test/collection/test_linkTargets.ts`:
   ref inside a table (one-level recursion), nested table (must NOT
   recurse — schema-rejected), embed top-level only, backlinks + rollup
   sharing one `from`, empty schema, schema with none of these field
   types. Verify-by-breaking: stop `uniqueRefTargets` walking `field.of`
   → table-ref test goes RED → restore.

## Versioning

The public `@mulmoclaude/core/collection` surface gains three exports that
a consumer (`collection-plugin`) now imports → bump `@mulmoclaude/core`
patch and sweep the internal dep range per CLAUDE.md.
