# refactor(#2412): sweep of small in-package clones

Issue #2412 is a triage list of small clones (jscpd 50–117 tokens), split into
**in-package** (same file / same package) and **host↔package** groups. The issue
says fold the in-package ones unconditionally; the host↔package ones need a
dependency-direction / intentional-copy judgment first.

This PR takes the **in-package** subset only — the unconditionally-safe category —
and defers every host↔package item to a follow-up, with a reason recorded per item
below. Rationale: the in-package dedups involve zero import-direction risk and make
one cohesive, easily-reviewable PR. The host↔package items each need their own
direction call (and several are deliberate structural duplicates), so batching them
here would muddy the review.

## Done (in-package, behavior-preserving)

| # | File | Clone | Change |
|---|------|-------|--------|
| 1 | `recipe-book-plugin/src/index.ts` | 32-42↔42-51 (117tok) | Shared Zod field object for the `save` / `update` union members. |
| 2 | `recipe-book-plugin/src/index.ts` | 240-247↔270-277 (66tok) | Extract `validateWritableArgs` (slug + title precheck) shared by `save` / `update`. |
| 3 | `mulmoscript-plugin/src/core/validate.ts` | 41-49↔73-81 (57tok) | Extract `validateFilePathBody` (object + non-empty `filePath`) shared by the script / beat validators. Also drops two `body.filePath as string` casts (now narrowed). |
| 4 | `mulmoscript-plugin/src/server/ops.ts` | 596-612↔763-768 (92tok) | Extract module-level `withBeatProgress(beats, onBeat, body)` — wires the global `addSessionProgressCallback` guard + `idToIndex` filter around the movie / PDF pipeline bodies. |
| 5 | `spotify-plugin/src/playback.ts` | 68-73↔75-80 (52tok) | Extract `playerPutWithParam` shared by `playerSeek` / `playerSetVolume`. |
| 6 | `core/src/collection/core/draft.ts` | 14-19↔32-37 (81tok) | Extract `buildTableRowDraft(subFields, readSub)` shared by `emptyRow` / `rowFromItem`. `emptyRow` == `rowFromItem` with an always-`undefined` reader (verified `fieldText(undefined) === ""`). |
| 7 | `core/src/collection/server/io.ts` | 52-60↔110-118 (68tok) | Extract `parseRecordJson` (parse → object-not-array narrow) shared by `tryReadRecord` / `readItem`. |
| 8 | `core/src/notifier/engine.ts` | 319-325↔331-337 (55tok) | Extract `terminateEntry(entryId, reason)` shared by `clear` / `cancel`. |
| 9 | `chat-service/src/{commands,types}.ts` | 80tok | Named `ListSessionsFn` / `GetSessionHistoryFn` type aliases in `types.ts`, reused by `ChatServiceDeps` and `createCommandHandler`'s opts. |

New tests:
- `test/utils/collections/test_draft_rows.ts` — `emptyRow` / `rowFromItem` had **no**
  coverage anywhere; locks the boolean-present semantics the refactor threads through
  `buildTableRowDraft`, and the `emptyRow == rowFromItem({})` equivalence.

The other refactors are internal helpers already exercised end-to-end by existing
tests (`test/workspace/collections/test_io.ts`, `test/server/notifier/test_engine.ts`,
`test/plugins/test_recipe_book_integration.ts`, the spotify handler tests, and — for the
shared filePath precheck — the already-comprehensive
`packages/plugins/mulmoscript-plugin/test/test_validate.ts`). No redundant root-level
validator test was added since that workspace suite already runs in CI and covers every
precheck branch.

No new **cross-cutting** shared helper is introduced (every extraction is a private,
in-file helper), so per `docs/shared-utils.md`'s own scope rule ("one plugin's parser
… stays inside that plugin; it doesn't belong here") there is no catalog entry to add.

No package `version` bumped → no dep-range sweep needed.

## Deferred (with reason)

In-package, but skipped in this PR:
- `core/src/collection/server/io.ts` 151-161↔198-203 (53tok) — `writeItem` / `deleteItem`
  id+containment preamble. `writeItem` and `deleteItem` return **different** discriminated
  unions and `writeItem` re-checks containment a second time after `mkdir` with a distinct
  log message; a shared precheck would have to thread a neutral discriminated result and
  re-map it per caller, which reads worse than the duplication. Deferred.
- `spotify-plugin/src/listening.ts`↔`search.ts` (51tok) — the `…Deps` interface + `Result<T>`
  alias (also in `playback.ts`). Type-only; consolidating means a new shared module + renaming
  three `Deps` interfaces used across the package. Low value vs. churn. Deferred.

host↔package (all deferred — each needs a direction call; several are intentional):
- `chat-service/src/types.ts`↔`server/api/routes/agent.ts` (53tok) — `types.ts` is
  `@package-contract`: its types are **deliberately** structural duplicates so the package
  keeps no compile link to the host. Not a defect.
- `x-plugin/src/internal.ts`↔`server/utils/date.ts` (72tok) — plugin↔host; a plugin can't
  import host `server/`. The `toUtcIsoDate` family (3 copies incl. x-plugin) is already noted
  in the duplicates table as soft-forced; a real fix means a core home. Out of scope here.
- `mulmoscript-plugin/src/server/support.ts`↔`server/utils/files/safe.ts` and
  ↔`x-plugin/src/internal.ts` (91/93tok) — same: host or cross-plugin; needs a core extraction.
- `client/src/options.ts`↔`server/events/resolveRelayBridgeOptions.ts` (69/60tok) — needs a
  home judgment; deferred.
- `core/src/wiki/render.ts`↔`src/utils/markdown/wikiEmbeds.ts` (62tok) — `escapeHtml`, a
  5-copy family. Fixing one pair without the family is what the duplicates-table guidance warns
  against; deferred to a dedicated `escapeHtml` sweep.
- `collection-plugin/src/vue/useStarterTranslations.ts`↔`src/composables/useTranslatedStrings.ts`
  (97tok) — Vue composables on opposite sides of the host/plugin boundary (plugin can't import
  host `src/`). The shared core cache (`@mulmoclaude/core/translation/client`) is already used by
  both; the residue is the Vue wrapper. Deferred.
- `core/src/scheduler/task-manager.ts`↔`mulmoscript-plugin/src/server/types.ts` (62tok) —
  type shape; needs a judgment on the right core home. Deferred.
- `plugins/shared/components/confirm.ts`↔`src/composables/useConfirm.ts` (177/62tok) —
  `plugins/shared/` has no `package.json` and is imported from nowhere. The issue asks to first
  decide "scaffold source vs. dead code" and only delete if dead. Deletion is riskier than a
  fold and needs that determination; deferred out of a clone-fold PR.
