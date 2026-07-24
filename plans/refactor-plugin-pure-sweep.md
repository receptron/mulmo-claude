# src/plugins pure-function sweep + bug hunt

Status: in progress (branch `refactor/plugin-pure-sweep`, from `origin/main` 2026-07-24)

## Motivation

The spreadsheet plugin had a large bug family fixed on `origin/main` (#2332–#2396,
formula-engine numeric coercion / boundary / date / error-reporting bugs), each
paired with an extracted pure module + node:test coverage. This sweep gives the
**other** `src/plugins/*` the same scrutiny: verify suspicious bugs (concrete
failure scenario required, speculation discarded) and extract the decision logic
buried in `.vue` components into pure `.ts` files with unit tests.

Method: 7 parallel read-only review agents, one per plugin group. Each finding was
re-verified against the actual code before any change.

## Shipped in this PR — verified fixes + extractions (all with node:test)

| Area                       | Fix                                                                                                                                                                                                            | Extracted pure module + test                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| shared `meta-types.ts`     | `buildRouteUrl` `:id`-inside-`:idx` prefix collision → single-pass regex, own-prop guard                                                                                                                       | `test/plugins/test_buildRouteUrl.ts`                                                   |
| shared `metas.ts`          | proto-key hardening missed `__proto__` (silent drop / prototype pollution) → `Object.create(null)` targets, spread back                                                                                        | extended `test_meta_aggregation.ts`                                                    |
| shared `api.ts`            | `pluginEndpoints`/`pluginPageRoute` proto-key lookups → own-prop guard                                                                                                                                         | (covered by hardening)                                                                 |
| scheduler                  | `formatInterval(90m)` → "Every 2h" (remainder dropped); `20s` → "Every 0m" → `1h 30m` / `<1m`                                                                                                                  | extended `test_formatSchedule.ts`                                                      |
| scheduler                  | display + tri-state toggle logic                                                                                                                                                                               | `taskDisplay.ts` (`nextEnabledState`: `undefined`≠`!current`) + test                   |
| manageRoles **(security)** | server `role.id` unvalidated on tool path → `path.join` traversal (write/delete outside `roles/`)                                                                                                              | `server/utils/files/roleId.ts` + `test/server/test_roleId.ts`                          |
| manageRoles                | edit path persisted `icon: ""` (create fell back to `person`); duplicated form logic                                                                                                                           | `roleForm.ts` (`formToRole`/`roleToForm`/`validateRoleForm`/`parseQueriesText`) + test |
| manageSkills               | local `skills` ref aliased + mutated the shared tool-result array (rewrote history/export); `saveEdit` had no stale-selection guard (could graft skill A onto skill B)                                         | `skillListEdits.ts` (immutable update/remove) + test                                   |
| manageSkills               | catalog detail pane missing `@click="handleExternalLinkClick"` (external links navigated SPA away)                                                                                                             | —                                                                                      |
| wiki                       | embedded log/lint result clobbered to Index on mount (Preview had the guard, View didn't) → mirrored guard                                                                                                     | —                                                                                      |
| wiki                       | task-checkbox toggle scroll-jumped to top (watch keyed on `content`) → keyed on page identity                                                                                                                  | —                                                                                      |
| wiki                       | restore-toast timer leaked past unmount → `onBeforeUnmount` cleanup                                                                                                                                            | —                                                                                      |
| wiki                       | raw `[[link]]` text used as slug (2 copies)                                                                                                                                                                    | `currentSlug.ts` (`resolveWikiSlug`) + test                                            |
| textResponse               | unsanitised `marked` via `v-html` (`<img onerror>`/`javascript:` executed) → route through `renderMarkdownToSafeHtml` (DOMPurify)                                                                              | —                                                                                      |
| textResponse               | `<think>` regex mangled fenced examples; JSON-fence wrap inline                                                                                                                                                | `renderPipeline.ts` (fence-aware `transformThinkBlocks`, `wrapJsonAsCodeFence`) + test |
| textResponse               | `truncateForRender` split surrogate pairs; `extractTextResponseTitle` took `# comment` inside a fence as title                                                                                                 | extended `test_utils.ts`                                                               |
| photoLocations             | `fmtDate` rendered "Invalid Date"; `hasFiniteCoords` missing lat/lng range + 0,0 rejection                                                                                                                     | `format.ts` + test                                                                     |
| canvas                     | width 33px → 1×0 canvas accepted (height floors to 0)                                                                                                                                                          | `canvasSize.ts` (`computeCanvasSize`) + test                                           |
| presentSVG                 | empty-string "unloaded" sentinel clobbered a deliberately-cleared editor; stale-fetch could overwrite cache; PDF failed silently; PNG squashed viewBox-only SVGs; proto-key cache reads; duplicated `saveBlob` | `exportName.ts`, `editorRefresh.ts`, `pngExport.ts`, `printableHtml.ts` + tests        |

Every regression test was mutation-checked (reverting the fix turns it red).

## Deferred — need product/UX decision or live (browser) verification

These are verified or plausible but out of scope for a mechanical fix-plus-test PR:

- **canvas** (leans on unmaintained `vue-drawing-canvas@1.0.14`): shared default
  `canvas-id` cross-contaminates two mounted instances (C1); Clear round-trips
  cleared content back to disk after remount (C2); white-snapshot race on slow
  background load (C3); stroke lost on off-canvas release (C4); silent save
  failures (C6); ResizeObserver + debounced remount; height clamp in stack layout.
  The `coalescingSaver` extraction (E2) falls out of the C6/C9 fix.
- **photoLocations**: declared `locations-changed` pubsub channel wired nowhere
  (stale list until remount).
- ~~**scheduler TasksTab**: unsequenced refetch races; full-list remount on every
  mutation (scroll/expand reset); unconfirmed one-click delete; hardcoded English
  frequency-hint labels (8-locale change).~~ **Shipped (fix/scheduler-tasks-robustness).**
- **manageSkills**: ~~same-repo update/uninstall overlap~~ **(shipped)**;
  four loaders sharing one `catalogError` channel (still open — needs a UX call
  on where the repo-list error surfaces); post-delete selection clobber;
  ~~`actionLock` extraction (release-if-owner)~~ **(shipped, fix/manageskills-loader-races)**.
- **manageRoles** ~~IME-Enter commits half-typed names; no re-entrancy guard
  on Enter; unconfirmed delete; refresh-failure swallowed~~ **(shipped,
  fix/manageroles-form-robustness — applied to BOTH the plugin View and the
  `RolesView.vue` fork, incl. the fork's `icon:""` bug)**. Still open:
  `alwaysActive` MCP tools shown as toggleable (needs a UX call); the
  `RolesView.vue` ~570-line fork itself (full consolidation deferred — it is
  deliberately decoupled from the plugin module, so shared helpers can't be
  imported without re-coupling).
- **wiki**: ~~stale-response tokens for `callApi`/`loadPageEditData`; non-404
  snapshot failure rendered as "page deleted"~~ **(shipped, fix/wiki-stale-response)**;
  renderer vs `WIKI_LINK_PATTERN` divergence (core); save-queue extraction
  (`taskSaveQueue`).
- ~~**textResponse / StackView**: speaker labels hardcoded English (×8);
  StackView duplicate capture-phase link handler (opens 2 tabs); StackView
  edit panel emits to nothing (silent edit loss); copy button copies rewritten
  display text in Files-Explorer mode.~~ **Shipped (fix/textresponse-stackview).**
- ~~**generateImage**: stale-image cache watch; chart-plugin sparse
  `instances[]`.~~ **(shipped, fix/chart-generateimage-cleanup — chart crash +
  generateImage deep-watch)** — generateImage's caching-ref/StackView-key
  interaction still open (needs live verification).
- **shared**: 3 near-duplicate `ImageToolData` interfaces (deferred — low
  value, high churn); ~~`saveBlob` missing from `docs/shared-utils.md`~~
  **(shipped)**.
