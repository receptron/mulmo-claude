# refactor(#2404): move `useFileWatch` into `@mulmoclaude/core/plugin-vue`

Date: 2026-07-23
Issue: #2404
Branch: `refactor/2404-usefilewatch-to-core`

## Problem

`useFileWatch` (plugin-scoped `file:<path>` subscription + monotonic `version`
ref bump) is duplicated **byte-for-byte** (only comments differ) across two
plugins:

- `packages/plugins/html-plugin/src/vue/useFileWatch.ts`
- `packages/plugins/markdown-plugin/src/plugins/markdown/useFileWatch.ts`

CLAUDE.md dependency rule: a plugin MUST NOT import another plugin — cross-plugin
sharing goes through core. Two copies of live-refresh subscribe/unsubscribe +
path re-bind + unmount cleanup are leak-prone; if one copy is fixed and the other
isn't, only one leaks.

The host's `src/composables/useFileChange.ts` is a *partial* match but rides on a
different substrate (host-local `usePubSub` + `fileChannel` helper, not the
`gui-chat-protocol/vue` runtime), so it is **out of scope** — it is not a plugin
and cannot import the plugin runtime.

## Approach

Extract the composable into `@mulmoclaude/core` on a **browser-safe subpath**
`@mulmoclaude/core/plugin-vue` (same convention as `@mulmoclaude/core/whisper/client`).
This is the first Vue surface in core, so `vue` becomes an **optional** peer of
core (server-only consumers like `google-plugin` must not be forced to install it).

### Files added to core

- `packages/core/src/plugin-vue/fileWatch.ts` — pure, framework-agnostic decision
  logic (`nextFileVersion`, `fileWatchChannel`, `FileChangePayload`). Separated so
  the version-bump rule (collapse same-ms writes, drop out-of-order events) is
  testable without Vue.
- `packages/core/src/plugin-vue/useFileWatch.ts` — the Vue composable, wiring the
  pure logic to the runtime pubsub subscription lifecycle.
- `packages/core/src/plugin-vue/index.ts` — subpath public entry (`useFileWatch`).
- `packages/core/test/plugin-vue/test_fileWatch.ts` — unit tests for the pure logic.

### Wiring

- `packages/core/package.json`: add `./plugin-vue` export (dual ESM+CJS), add
  `vue` as optional peer + dev dep, bump version `1.1.0` -> `1.2.0`.
- `packages/core/vite.config.ts`: add the `plugin-vue/index` entry, externalize
  `vue` and `gui-chat-protocol/vue`.
- Both plugins: delete their `useFileWatch.ts`, repoint the `View.vue` import to
  `@mulmoclaude/core/plugin-vue`, add `@mulmoclaude/core: ^1.2.0` to peer + dev
  deps, add `/^@mulmoclaude\/core/` to the vite external list.

### Version discipline (CLAUDE.md "Internal dep ranges" + launcherSync)

Bumping core to `1.2.0` requires every `@mulmoclaude/core` range in the tree to
move to `^1.2.0`:

- `packages/plugins/collection-plugin/package.json` (peer + dev)
- `packages/plugins/google-plugin/package.json` (deps)
- `packages/mulmoclaude/package.json` launcher dep range (launcherSync invariant 4:
  launcher range lower bound must equal core workspace version)
- `packages/plugins/html-plugin` + `markdown-plugin` (new peer + dev)

The launcher's OWN `version` is NOT touched (reserved for `/publish-mulmoclaude`).

## Verification

- Pure logic tests: subscribe->bump, equal-ms collapse, out-of-order drop,
  undefined/non-number payload, unchanged-otherwise.
- `yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn test`.

## Out of scope

- `src/composables/useFileChange.ts` (host, different substrate).
- Spreadsheet code (explicitly excluded).
