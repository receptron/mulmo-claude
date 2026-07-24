# refactor(mulmoscript-plugin): split View.vue into components/composables (#2299)

## Goal

`packages/plugins/mulmoscript-plugin/src/vue/View.vue` is 1919 lines (template
548 / script ~1240 / style ~126). A prior "safe layer" PR (#2380) extracted the
pure helpers into `helpers.ts` + tests, but the component body is unchanged.
This PR takes the next step: move cohesive **stateful logic clusters** into
composables so the orchestrator (`View.vue`) shrinks materially, without
touching the rendered DOM.

## Hard constraint — DOM / testid parity

The plugin has an e2e mock suite (`e2e/tests/present-mulmo-script.spec.ts`) that
traverses the View by `data-testid` and visible text. 17 testids live in the
template. **The template must stay byte-identical.**

Strategy that guarantees this: **extract composables only, not child
components.** A composable returns the exact same `ref` / `reactive` / `computed`
/ function values under the **same names**, destructured back into `<script
setup>`. The `<template>` block is not edited at all, so:

- every `data-testid` stays in place, unchanged, in the same nesting;
- every Tailwind class / layout stays identical (the moved logic touches no
  markup);
- scoped `<style>` targets only the bottom-bar classes, none of which move.

Because the template is untouched, the only risk surface is wiring the moved
functions to the same reactive state — verified by `yarn build`, `yarn
typecheck`, the unit tests, and the mock e2e (which exercises mount →
initializeScript → renderBeat → the movie-generation error path).

Child-component extraction of template sections (BeatRow, CharacterStrip, etc.)
is deferred: it cannot be proven byte-equivalent as cheaply, and the beat row in
particular couples ~25 reactive inputs. Composables are the safe, high-value
slice.

## Slices

### Composables (new dir `src/vue/composables/`)

1. **`useMediaExport.ts`** — movie + PDF. Moves the state refs, `generateMovie`,
   `downloadMovie`, `refreshMoviePath`, `generatePdf`, `downloadPdf`,
   `refreshPdfPath`, and `resetMedia`. DRYs the two byte-identical download
   flows (`triggerBlobDownload`) and the two status refreshes.
   Options: `api`, `adapter`, `filePath`, `chatSessionId`.
   Returns (same names): `moviePath`, `movieGenerating`, `movieDownloading`,
   `movieError`, `pdfPath`, `pdfGenerating`, `pdfDownloading`, `generateMovie`,
   `downloadMovie`, `refreshMoviePath`, `generatePdf`, `downloadPdf`,
   `refreshPdfPath`, `resetMedia`.

2. **`useBeatMovie.ts`** — per-beat video clips. Moves the state maps,
   `loadExistingBeatMovie`, `playBeatMovie`, `closeBeatMovie`,
   `invalidateBeatMovie`, `resetBeatMovies`.
   Options: `api`, `adapter`, `filePath`.
   Returns: `beatMovies`, `beatMovieUrls`, `beatMovieOpen`, `beatMovieLoading`,
   `loadExistingBeatMovie`, `playBeatMovie`, `closeBeatMovie`,
   `invalidateBeatMovie`, `resetBeatMovies`.

3. **`useCharacterImages.ts`** — character strip. Moves the state maps,
   `characterKeys`, `characterPrompt`, drag handlers, `onCharDrop`,
   `loadExistingCharacterImage`, `refreshMissingCharacterImages`,
   `renderCharacter`, `generateAllCharacters`, `resetCharacters`.
   Options: `api`, `filePath`, `chatSessionId`, `script`.
   Returns: `charRenderState`, `charImages`, `charErrors`, `charDragOver`,
   `characterKeys`, `characterPrompt`, `onCharDragOver`, `onCharDragLeave`,
   `onCharDrop`, `loadExistingCharacterImage`, `refreshMissingCharacterImages`,
   `renderCharacter`, `generateAllCharacters`, `resetCharacters`.

4. **`useDeckEditor.ts`** — deck editor debounce save. Moves `isDeck`,
   `deckScriptInput`, the Deck shape types, `scheduleDeckSave`, `flushDeckSave`,
   `onDeckUpdate`.
   Options: `api`, `filePath`, `effectiveScript`, `commitScript`.
   Returns: `isDeck`, `deckScriptInput`, `onDeckUpdate`, `flushPendingDeckSave`.

`openCharacterLightbox` stays in the parent (it sets the shared `lightbox` and
calls `stopAllPlayback`). The audio-playback + lightbox loop stays in the parent
this PR — it is deeply mutually recursive (`advanceFromBeat` ↔ `lightboxMove` ↔
`openLightbox` ↔ `playBeat`) and is NOT e2e-covered, so moving it is deferred.

### Parent DRY

`commitScript(next)` — the identical `emit("updateResult", { …selectedResult,
data: { …data, script: next } })` used by `applySource`, `refreshScriptFromDisk`,
and the deck save. Extracted as one parent function; passed into
`useDeckEditor`.

### Pure helpers → `helpers.ts` (+ unit tests)

- `resolveSilentAdvanceSeconds(raw, defaultSec)` — the duration-narrowing guard
  from `scheduleSilentAdvance` (zero / negative / NaN / non-number → default).
  A "silently wrong value" risk (a bad value collapses the silent-beat timer to
  an immediate fire and the Play loop races). Tested directly.
- `clearReactiveRecords(...records)` — deletes every own key of each record;
  replaces the 12-line delete-loop wall in `initializeScript` and is reused by
  the composables' reset functions. Tested directly.

## Why the DOM stays identical (per slice)

Every slice moves only `<script>` logic. The values are returned from the
composable under the identical identifiers and destructured back into setup
scope, so both `<template>` bindings and remaining `<script>` call sites resolve
to the same reactive objects. No template line is edited; therefore no testid,
class, or nesting changes.

## Verification

`yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn test`
(unit), and the mulmoscript mock e2e specs. No package version bumps.
