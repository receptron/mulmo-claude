# fix: settle a pending confirm before replacing state in the plugin-side confirm mirror (#2463)

## Problem

`packages/plugins/shared/components/confirm.ts` is the plugin-side mirror of
`src/composables/useConfirm.ts` (the two stay separate on purpose: the plugin
side pulls locale from `useRuntime`, the host side from vue-i18n — see the
header note in `useConfirm.ts`). The host copy settles a still-pending confirm
as `false` before `openConfirm` replaces the state; the plugin copy does not,
so opening a second confirm while one is pending leaves the first
`Promise<boolean>` unresolved forever and the caller `await`ing it hangs.

## Fix

- Port the host's settle-previous block (comment included, verbatim) into the
  plugin copy's `openConfirm`.
- Add a reciprocal mirror-note header to the plugin copy pointing at
  `src/composables/useConfirm.ts`, so future edits to either file know to keep
  them in sync (the missing note is how this drift happened).
- Consumer check: `packages/plugins/recipe-book-plugin/src/View.vue` only does
  `!(await openConfirm(...))` for delete confirmation — a superseded confirm
  now resolves `false` → early return, no delete. Nothing relied on the old
  hanging behavior.

## Test

`test/plugins/shared/test_confirm.ts` (node:test, vue `ref` runs headless under
`tsx --test` like the other `test/composables`/`test/plugins` suites): open →
open again → first promise resolves `false` (checked via `Promise.race` so a
regression fails red instead of hanging), plus the plain resolve/clear path.
Mutation-checked by removing the ported lines.

## Out of scope

Merging the two files — blocked on the host/plugin runtime split; jscpd alerts
#257/#258 for this pair remain KEEP.
