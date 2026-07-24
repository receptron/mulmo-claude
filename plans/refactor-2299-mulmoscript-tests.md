# refactor(mulmoscript-plugin): safe layer of #2299 — tests + pure-function extraction

Issue #2299 proposes a full split of `packages/plugins/mulmoscript-plugin/src/vue/View.vue` (1919 lines)
into child components and stateful composables. **This PR does ONLY the safe layer** — the part the
issue itself flags as a prerequisite: *"分割の前に helpers.ts の既存 export だけでもテストを書く。
テストがゼロの状態で 1900 行を動かすのは、壊れても気づけない。"*

This plugin currently has **zero tests** (`find test -ipath "*mulmoscript*"` → 0). Moving 1900 lines
without a safety net is how regressions slip through. So: write the net first, then do the cheapest,
lowest-risk extraction (pure functions into the existing `helpers.ts`).

## Scope — IN

1. **Tests for already-exported pure helpers** in `src/vue/helpers.ts`
   (`test/plugins/mulmoscript/` — new):
   `isAllSlideDeck`, `getMissingCharacterKeys`, `validateBeatJSON`, `isSameScript`,
   `beatMayHaveMovie`, `shouldAutoRenderBeat`. Happy path + edge/empty/null + invalid input for
   validators.
2. **Extract the pure functions the issue lists** out of `View.vue` INTO `vue/helpers.ts`, verify each
   is pure first, leave `View.vue` importing them, add tests for each:
   `staleSince`, `effectiveBeat`, `beatTooltip`, `characterPrompt`, `isValidBeat`, `scriptSourceText`.
3. **movie/pdf duplication**: if a *pure* sliver (filename builder / request-body builder) can be
   lifted out of the shared shape, do it with tests. If it is inseparable from the async/reactive
   flow, LEAVE IT and note it for the deferred phase.
4. **`errorMessage`**: `docs/shared-utils.md` flags View.vue's copy as a known duplicate. If it can be
   pointed at the shared helper WITHOUT touching template or behaviour, do it + update the catalog;
   if entangled, leave it.

## Scope — OUT (deferred to the full-split phase)

- [ ] Template → child components (`MulmoScriptToolbar.vue`, `BeatRow.vue`, `CharacterStrip.vue`,
      `BeatLightbox.vue`) — highest e2e risk (the 5 must-keep testids live in the header).
- [ ] Stateful composables (`useBeatAudio`, `useBeatLightbox`, `useMediaExport`,
      `useCharacterImages`, `useDeckEditor`, `useScriptSource`, `useBeatMovie`).
- [ ] Any `data-testid` change.

## Constraints

- Behaviour identical — pure extraction + new tests only.
- No `any`, no `as`, functions < 20 lines.
- Tests import via the package's source path / built dist as the existing suite does; rebuild
  `yarn build:packages` after source changes if the suite reads `dist`.
- Verify tests are real: break `validateBeatJSON`, confirm a test goes RED, restore.

## Gate

`yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn test`. `View.vue` still typechecks;
plugin still builds.
