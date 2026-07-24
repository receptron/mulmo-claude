# refactor(#2299): extract View.vue template subtrees into child components

Follow-up to the composables split (#2299 first PR, merged). This step moves
**safe template subtrees** of `packages/plugins/mulmoscript-plugin/src/vue/View.vue`
(1573 lines) into child components. Prop-in / emit-out, Composition API, `$t()`.

## Hazard 1 — scoped-style boundary (enumerated)

The SFC has one `<style scoped>` block. Scoped rules do **not** cross a component
boundary, so a styled subtree moved into a child would lose its styling unless the
rules move with it. Every scoped selector below targets the **bottom-bar region only**
(template lines 458–476):

| Scoped selector(s) | Element it styles (template) |
|---|---|
| `.bottom-bar-wrapper` | 459 outer wrapper `<div>` |
| `.script-source`, ` summary`, `[open] summary`, ` summary:hover` | 460 `<details>` + 461 `<summary>` |
| `.script-editor`, `:focus`, `.script-editor-invalid`, `-invalid:focus` | 463 `<textarea>` |
| `.editor-actions` | 468 `<div>` |
| `.apply-btn`, `:hover`, `:disabled` | 469 Apply `<button>` |
| `.cancel-btn`, `:hover` | 470 Cancel `<button>` |
| `.copy-btn`, `:hover`, ` .material-icons` | 473 Copy `<button>` |

**Every other region uses only Tailwind utility classes + the global `material-icons`
font class**, both of which come from GLOBAL stylesheets — a component's `data-v-*`
scoping does not affect them. Therefore any non-bottom-bar subtree can be extracted
with zero scoped-style risk. The bottom bar is the *only* subtree that would lose
styling, so it is deferred.

## Hazard 2 — the beat row couples ~25 reactive inputs

The beat list (252–456) reads renderedImages / renderState / renderErrors /
beatMovies* / beatDragOver / audioState / beatAudios / audioErrors / playingAudio /
sourceOpen / sourceText / beatSaveErrors / beatSaving + ~10 handlers, per index.
Too wide to extract safely this round. **Deferred** (issue's `BeatRow.vue` idea).

## Candidate children & decision

| Subtree | Lines | testids | style | e2e-exercised | decision |
|---|---|---|---|---|---|
| media button cluster (18–130) → `MulmoScriptToolbar.vue` | ~113 | 6 (2 e2e-critical) | Tailwind only | yes (generate-movie click) | **EXTRACT** |
| characters section (160–242) → `CharacterStrip.vue` | ~83 | 0 | Tailwind only | no (fixture has no characters) | **EXTRACT** |
| lightbox (478–546) → `BeatLightbox.vue` | ~69 | 0 | Tailwind only | no (opens only on click) | **EXTRACT** |
| movie error chip (140–158) | ~19 | 2 (e2e-critical) | Tailwind only | yes | defer — low value, keep e2e-critical chip in parent |
| beat list (252–456) → `BeatRow.vue` | ~205 | 6/idx | Tailwind only | yes (render-beat) | defer — hazard 2 |
| bottom bar / source editor (458–476) | ~19 | 0 | **SCOPED** | no | defer — only scoped region; needs style move + `sourceDetails` template-ref crossing the boundary (issue's `useScriptSource`) |

Safe subset = **Toolbar + CharacterStrip + BeatLightbox**. All three are pure Tailwind
(no scoped rules apply), so no `<style>` moves are needed and rendered appearance is
unchanged. The toolbar path is directly validated by the mulmoscript mock e2e; the
other two are validated by typecheck/build + the scoped-style analysis above.

## Boundaries

**MulmoScriptToolbar.vue** — root `<div class="ml-4 shrink-0 flex items-center gap-2">`.
props: moviePath `string|null`, movieGenerating, movieDownloading, isPlayReady,
canFetchMedia, pdfPath `string|null`, pdfGenerating, pdfDownloading.
emits: play, generate-movie, download-movie, generate-pdf, download-pdf.
Preserves testids: download/regenerate/generate -movie-button, download/regenerate/generate -pdf-button.

**CharacterStrip.vue** — root `<div v-if>` stays in parent; component renders the section body.
props: characterKeys `string[]`, charImages, charRenderState, charErrors, charDragOver,
images (for the `characterPrompt` helper), movieGenerating, anyBeatRendering.
emits: generate-all, char-drag-over, char-drag-leave, char-drop, open-lightbox, render-character.

**BeatLightbox.vue** — parent keeps `v-if="lightbox"`, so the prop is non-null inside.
props: lightbox `LightboxState`, beatCount, beatTexts `(string|undefined)[]` (tooltips via helper),
hasPrev, hasNext, playingAudioIndex `number|null`, audioProgress, hasCurrentAudio.
emits: close, move, jump, play-audio.
New shared type `LightboxState` added to `viewTypes.ts` (used by parent + child).

## Verify
`yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn test`,
`yarn test:e2e e2e/tests/present-mulmo-script.spec.ts` (baseline: 7 passed). No version bumps.
