# refactor: sweep of verified small folds (#2489)

Three independent, adversarially-verified small folds from the code-scanning
duplication triage. One PR; no behavior change intended.

## 1. spotify `Result<T>` ×3 + `*Deps` ×3 fold (alert #259)

- `client.ts` already exports the canonical `SpotifyClientResult<T>`;
  `listening.ts` / `search.ts` / `playback.ts` each re-declared an identical
  local `type Result<T>` plus a structurally-identical `*Deps` interface.
- Added one `SpotifyDeps` to `types.ts` (keeps the WHY doc comment on `now`);
  the three files now import `SpotifyClientResult` from `./client` and use
  `SpotifyDeps`.
- `ListeningDeps` / `SearchDeps` / `PlaybackDeps` were referenced nowhere
  outside their own files (verified by grep incl. tests), so the names are
  deleted outright — no aliases kept.
- Trap avoided: `Result` must NOT move into `types.ts` — `SpotifyClientError`
  lives in `client.ts` and `types → client → types` would be an import cycle.

## 2. `nextFileVersion` barrel export + host fold (alert #430 partial)

- `packages/core/src/plugin-vue/index.ts` now exports `nextFileVersion` and
  `FileChangePayload` from `./fileWatch.ts`, plus `useFileVersion` /
  `SubscribeToFile` (below). (`fileWatchChannel` stays un-exported — the host
  uses its own unscoped `fileChannel`.)
- `src/composables/useFileChange.ts` loses its hand-written monotonic mtime
  guard (and its `data as FileChannelPayload` cast) — the rule comes from
  `nextFileVersion`.
- Typing decision: `nextFileVersion` now accepts `payload: unknown` instead of
  `FileChangePayload | undefined`. Pubsub payloads arrive untyped on the host
  side; the function already validated `mtimeMs` at runtime, so widening makes
  that check the single validation point and removes the host's unsound `as`
  cast without adding a duplicate type guard. (`FileChannelPayload`
  `{path, mtimeMs: number}` is structurally assignable to `FileChangePayload`
  `{mtimeMs?: number}` anyway.) New tests pin the non-object payload cases.
- Scaffold extraction: replacing only the 3-line guard left the two
  composables' tails textually identical — jscpd (CI config) reported a NEW
  clone pair `useFileWatch.ts` ↔ `useFileChange.ts`, violating the
  "no new clones" gate. So the shared rebind/reset/bump/teardown scaffold
  moved to `useFileVersion(filePath, subscribeToFile)` in
  `packages/core/src/plugin-vue/useFileWatch.ts`; `useFileWatch` (plugin
  runtime pubsub) and the host's `useFileChange` (host `usePubSub` +
  `fileChannel`) are now thin wrappers injecting their substrate's subscribe
  seam. Public APIs of both composables are unchanged. This is still NOT the
  full unification alert #430 asked for — two composables remain because the
  substrates genuinely differ; the seam is exactly that difference.

## 3. confirm header truthfulness (alert #438) — comment-only

- Both `packages/plugins/shared/components/confirm.ts` and
  `src/composables/useConfirm.ts` claimed the mirror exists because of a
  useRuntime-vs-vue-i18n locale split — but neither composable touches i18n
  (both import only `{ ref } from "vue"`); that split concerns the
  ConfirmModal.vue components.
- Real blocker: recipe-book (the plugin copy's consumer) is a deliberately
  gui-chat-protocol-only sample; folding into `@mulmoclaude/core/plugin-vue`
  would force a core dep onto the sample + scaffold.
- Headers rewritten to state the true reason; mirror itself is kept (KEEP).

## Verification

- Gates: `yarn format && yarn lint && yarn typecheck && yarn build && yarn test`.
- jscpd with the CI ignore string: the spotify listening↔search clone pair
  (alert #259) is gone; no new clones (the confirm mirror remains by design).
- `docs/shared-utils.md` `useFileWatch` row updated: the version-bump rule is
  now imported by the host instead of re-implemented.
