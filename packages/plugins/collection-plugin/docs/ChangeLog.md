# Changelog

Newest first. Each entry corresponds to a tagged release. Written in English.

## @mulmoclaude/collection-plugin@4.6.0 — 2026-09-02

Opens an `options` slot in the chat modal's footer, so a host can put its own control beside "Start chat" (#3026, PR #3027).

`CollectionChatModal` covers the whole page — `fixed inset-0` plus `backdrop-blur-sm` — so anything a host draws elsewhere to say *what this chat will start as* is blurred out at exactly the moment the button is pressed. MulmoTerminal starts these chats as one of five agents chosen by a single persisted global, and a user reported a collection chat coming up as Meta Muse with nothing on screen to explain it (receptron/mulmoterminal#1938).

- `CollectionChatModal.vue` renders `<slot name="options" />` at the left of the footer, wrapped in a `mr-auto` div. Empty in every host that passes nothing, and the wrapper is then zero-width: `mr-auto` absorbs the free space the footer's `justify-end` was absorbing anyway, so Cancel and Start do not move. The plugin learns nothing about what a host puts there — no agent vocabulary crosses the boundary.
- `CollectionView.vue` forwards its own `chat-modal-options` slot into it, **and only on the standalone path**. With `sendTextMessage` set the modal is inside a chat card and `submitChat` sends into the session already running (`useCollectionChat`'s `dispatchSeed`), so no new chat is started and a control over "which chat gets started" would change nothing. An option that does not apply is worse than none.
- MulmoClaude fills the slot nowhere, so its own UI is unchanged. `e2e/tests/collection-chat-button.spec.ts` pins that the footer still holds exactly two buttons, and `test/components/test_collection_chat_modal_slot.ts` pins the slot, the forwarding, and the gate on the same template element.

📦 **npm**: [`@mulmoclaude/collection-plugin@4.6.0`](https://www.npmjs.com/package/@mulmoclaude/collection-plugin/v/4.6.0)

## @mulmoclaude/collection-plugin@4.5.0 — 2026-08-30

Routes every icon in the plugin through core's new `IconGlyph` (#2986, #3003), and requires `@mulmoclaude/core@4.5.0` to do it — the component did not exist before that release.

- `CollectionHeader.vue`, `CollectionMutateParamsModal.vue`, `CollectionRecordPanel.vue`, `CollectionToolbar.vue`, `CollectionViewConfigModal.vue`, `CollectionsIndexView.vue`, `DiscoverPanel.vue` and `FeedsView.vue` replace their bare `<span class="material-symbols-outlined">{{ icon }}</span>` with `<IconGlyph :icon="…" size-class="…" />`. The visible difference is that a non-Material icon — an emoji — is now classified and drawn at the right metrics instead of being handed to the icon font and overlapping its neighbour.
- The collection's accent colour is passed down where the header previously dropped it (`:color="collection.color"`).
- `src/style.css` gains two `@source` directives. The enum palette and `IconGlyph` both spell their Tailwind classes out inside **core**, which this package's Vite root does not cover, so those utilities fell out of `dist/style.css` and only the host app — whose root is the repository — kept rendering them (#2989). Both directives name the FILE rather than the directory on purpose: scanning `core/src` harvests ordinary words out of the TypeScript (`contents`, `grow`, `ring`) and emits utilities nothing asked for. `scripts/packages/check-plugin-tailwind-source.mjs` is the gate that went red when the two landed together.

📦 **npm**: [`@mulmoclaude/collection-plugin@4.5.0`](https://www.npmjs.com/package/@mulmoclaude/collection-plugin/v/4.5.0)

## @mulmoclaude/collection-plugin@4.4.0 — 2026-08-26

The app's standard search box now drives a custom collection view (#2959, PR #2963).

The search box stays on screen while a custom view renders, so users reasonably expected the one box to filter both. It could not: the sandboxed iframe has an opaque origin and `window.__MC_VIEW` carried no channel for the host's search text, which forced every view author to ship a second search box beside the app's own.

View authors get two fields — `searchQuery` (the live text) and `onSearchQueryChange(cb)`.

- **Host → view only.** The view reads the query; it cannot write the app's box. The reverse needs echo-loop guards, fights a fast typist's cursor across an async hop, and adds a new class of message: `mc-open-item` / `mc-start-chat` are _user-gesture proposals_, not silent mutations of host UI state.
- **It travels on a `MessageChannel` port, not a window post.** A window post must name a target origin, and an opaque origin can only be addressed as `"*"` — which keeps delivering after a view navigates itself elsewhere. A port belongs to the document that received it, so navigation severs it.
- **`searchQuery` updates synchronously; the callback is debounced at ~150 ms.** Same contract as `onChange`, but a view re-reading the value mid-render is never a keystroke behind.
- **Scoped per collection for free**, because `searchQuery` already resets on collection load.

New module `src/vue/searchChannelPolicy.ts` holds the channel rules; `collectionViewMode.ts`, `CollectionCustomView.vue`, `CollectionToolbar.vue` and `CollectionView.vue` carry the wiring.

The authoring documentation ships in `@mulmoclaude/core@4.4.2` and the host side in `mulmoclaude@1.14.0`.

📦 **npm**: [`@mulmoclaude/collection-plugin@4.4.0`](https://www.npmjs.com/package/@mulmoclaude/collection-plugin/v/4.4.0)

## @mulmoclaude/collection-plugin@4.3.0 — 2026-08-25

Publishes the plugin-side half of the remote-view image-budget fix (#2924, PR #2934). The change had been on `main` since 4.2.0 but was never released, so npm consumers kept the old preview caption. It surfaced during a release audit: `@mulmoclaude/collection-plugin@4.2.0` carried no git tag, so drift against the published tarball could not be measured at all. Tagging 4.2.0 retroactively revealed 9 shipped files ahead of npm — this release delivers them.

- The remote-view preview caption is localized. The image counts beside the byte figure were built from hardcoded English (`N images (M over budget)`), on the assumption that they were locale-free numerics like the byte figures next to them. That stopped being true once the caption had to name _what_ went wrong: it is a word the author reads. Both forms now go through `t()`, and `collectionsView.remoteViewPreviewImages` / `collectionsView.remoteViewPreviewImagesPlaceholders` were added to all 8 locales (de, en, es, fr, ja, ko, ptBR, zh) in lockstep.
- The caption reports "placeholders" instead of "over budget". Since #2934 an over-budget image is deferred to the next page rather than dropped, so a page returns shorter rather than with holes in it. The count now means "images this page hands back as a path" — usually unresolvable ones (missing file, undecodable source), plus the over-budget images of a first item forced through to keep paging alive. The previous wording described behaviour the engine no longer has.

The engine-side change it belongs to (ending a page when the byte budget is exhausted, instead of leaving unfitted fields as bare paths) is host code and ships through the `mulmoclaude` launcher, separately from this package.

The launcher's declared range for this package was swept to `^4.3.0` in the same commit.

📦 **npm**: [`@mulmoclaude/collection-plugin@4.3.0`](https://www.npmjs.com/package/@mulmoclaude/collection-plugin/v/4.3.0)
