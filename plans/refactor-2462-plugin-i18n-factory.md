# refactor: extract `createPluginI18n` shared by accounting/collection vue lang (#2462)

## Problem

`packages/plugins/accounting-plugin/src/vue/lang/index.ts` and
`packages/plugins/collection-plugin/src/vue/lang/index.ts` share 31 identical
lines (jscpd alert #208): the `createI18n<[M], string, false>` construction over
the 8 standard locales, a detached `effectScope(true)`, a `syncing` flag, and a
lazy, retry-safe `ensureLocaleSync()` that mirrors a host-injected locale onto
the plugin's own vue-i18n instance. The only deltas are the generic message type
and the locale-source line (`hostLocaleTag()` vs `collectionUi().localeTag()`).

`gui-chat-protocol/vue`'s `createUseT` cannot absorb this: these instances are
driven by host bindings, not the `PLUGIN_RUNTIME_KEY` runtime (1fbc87f48).

## Approach

1. New `packages/core/src/plugin-vue/pluginI18n.ts` exporting
   `createPluginI18n<M>(messages, localeSource: () => string)` on its OWN
   browser-safe `@mulmoclaude/core/plugin-vue/i18n` subpath (a plugin can't
   import another plugin, so shared plugin-Vue code lives in core — same pattern
   as `useFileWatch` #2404 / `useClipboardCopy` #2408). It is deliberately NOT
   re-exported from the `./plugin-vue` barrel: `vue-i18n` is an optional peer,
   and barrel consumers that never use i18n (html/markdown plugin Views) must
   not be forced to resolve it at module-load time (Codex review finding).
   - Owns the `createI18n` construction, the detached `effectScope(true)`, and
     the lazy `ensureLocaleSync` wiring; returns the composable
     (`() => { t, locale }`).
   - **Semantics preserved exactly**: the wired flag flips true only after
     `syncScope.run(...)` returns, so a throw from the first `localeSource()`
     read leaves the sync retryable on the next call; the scope is detached so
     the mirror survives component unmounts. The WHY comment carries over.
   - `const`-only: the `let syncing` flag becomes a closure state record inside
     a small `onceRetryable(wire)` helper (also keeps `createPluginI18n` under
     20 lines).
   - Typing via `ReturnType<typeof createI18n<[M], string, false>>` so each
     plugin's message-type inference is unchanged; no `any` / `as`.
2. Both plugins keep only their message maps, binding closure, and public names
   (`useAccountingI18n` / `useCollectionI18n`, now `const`s produced by the
   factory). The collection plugin passes `() => collectionUi().localeTag()` so
   the binding is still resolved per effect run, exactly as before.
3. Dependency hygiene: core treats `vue-i18n` the same way it treats `vue` —
   optional peerDependency (`^11.4.4`, the range both plugins already declare)
   plus devDependency (`^11.4.7`, the resolution already in yarn.lock) — and
   externalizes it in `vite.config.ts`. Both plugins already externalize
   `/^@mulmoclaude\/core/` and `vue-i18n`, so no plugin build changes. No
   version bumps.

## Tests

`packages/core/test/plugin-vue/test_pluginI18n.ts` (node:test, headless vue):

- initial locale from the source is applied (`locale` + translated `t`)
- locale source is untouched before the composable's first call (lazy wiring)
- the mirror is wired exactly once across repeated calls
- reactive locale-source changes propagate after `nextTick`
- a throwing locale source propagates AND leaves the sync retryable — the next
  call wires successfully (mutation-checked: flipping the flag before `wire()`
  turns this test red)

## Verification

- `yarn format && yarn lint && yarn typecheck && yarn build && yarn test`
- jscpd (same flags as `.github/workflows/duplication-scan.yaml`): the
  accounting↔collection `lang/index.ts` clone pair is gone, no new clones
