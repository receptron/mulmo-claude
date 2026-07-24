# refactor(#2408): dedup markdown host ↔ markdown-plugin (`useMarkdownDoc`, 8-locale lang, clipboard)

Date: 2026-07-23
Issue: #2408
Branch: `refactor/2408-markdown-host-dedup`

## Problem

The host (`src/`) and `@mulmoclaude/markdown-plugin` carry parallel implementations of
markdown-document display code. Issue #2408 lists four duplicates:

| host | plugin |
|---|---|
| `src/composables/useMarkdownDoc.ts` | `markdown-plugin/src/composables/useMarkdownDoc.ts` |
| `pluginMarkdown` section in `src/lang/{8}.ts` | `markdown-plugin/src/lang/{8}.ts` |
| `src/composables/useClipboardCopy.ts` | `markdown-plugin/src/composables/useClipboardCopy.ts` |
| `src/composables/useFileChange.ts` | `markdown-plugin/.../useFileWatch.ts` |

**File-watch (row 4) is out of scope** — it is already being consolidated into
`@mulmoclaude/core/plugin-vue` by the in-flight PR #2422 (issue #2404). This PR does
not touch `useFileChange.ts` / `useFileWatch.ts`.

## Findings

- The host's `src/plugins/markdown/` is already a **thin adapter** that delegates
  View/Preview/TOOL_DEFINITION to `@mulmoclaude/markdown-plugin/vue`. The package's
  View uses the package's own `useT()` for `pluginMarkdown.*` keys.
- The host's `pluginMarkdown` lang section is therefore **dead** — no reference exists
  anywhere in `src/` or `server/` outside the lang files. This matches the established
  precedent: when `form-plugin` and `html-plugin` were packaged, their host lang
  sections (`pluginForm`, `pluginHtml`) were deleted; the packages own their lang.
- `useMarkdownDoc` and `useClipboardCopy` are **live** in both host and plugin, so they
  need a shared home DOWN in core (a plugin must not import the host; the host must not
  import a plugin for generic UI code).
- The two `useClipboardCopy` copies **differ**: the plugin version cancels the in-flight
  reset timer (`clearTimeout`) so a rapid second copy keeps the "Copied!" hint visible;
  the host version does not. Single-sourcing keeps the **plugin's superior version**.

## Approach

### Shared home: `@mulmoclaude/core/plugin-vue`

Add `useMarkdownDoc` + `useClipboardCopy` to the browser-safe `@mulmoclaude/core/plugin-vue`
subpath (the same subpath PR #2422 introduces for `useFileWatch`). This PR mirrors #2422's
infrastructure exactly so the two merge additively:

- `packages/core/src/plugin-vue/markdownDoc.ts` — **pure** logic: `formatScalarField`
  (rewritten with explicit `typeof` guards so it passes the type-aware `no-base-to-string`
  rule without an eslint-disable) and `buildMarkdownDocView(raw)`. Vue-free, testable.
- `packages/core/src/plugin-vue/useMarkdownDoc.ts` — the `computed()` composable.
- `packages/core/src/plugin-vue/useClipboardCopy.ts` — the composable (plugin variant).
- `packages/core/src/plugin-vue/index.ts` — subpath entry re-exporting the public API.
- `packages/core/test/plugin-vue/test_markdownDoc.ts` + `test_useClipboardCopy.ts` —
  ported from the deleted host tests, pinning the extracted logic.

### Wiring

- `packages/core/package.json`: add `./plugin-vue` export (dual ESM+CJS), add `vue` as
  optional peer + dev dep. Core stays at **1.2.0** (unpublished; changes accumulate).
- `packages/core/vite.config.ts`: add the `plugin-vue/index` entry, externalize `vue`
  and `gui-chat-protocol/vue`.
- Host: delete `src/composables/useMarkdownDoc.ts` + `useClipboardCopy.ts`; repoint the
  four consumers (`wiki/View.vue`, `FileContentRenderer.vue`, `textResponse/View.vue`,
  `RightSidebar.vue`) to `@mulmoclaude/core/plugin-vue`. Delete the two host tests.
- Plugin: delete `markdown-plugin/src/composables/{useMarkdownDoc,useClipboardCopy}.ts`;
  repoint `markdown/View.vue` to `@mulmoclaude/core/plugin-vue`; add `@mulmoclaude/core:
  ^1.2.0` to peer + dev deps and `/^@mulmoclaude\/core/` to the vite external list.
- Lang: delete the dead `pluginMarkdown` section from all 8 host `src/lang/*.ts`
  (type-enforced lockstep — must remove from all 8 together). The package's 8-locale
  bundle becomes the single source.

### Version discipline

Core stays 1.2.0 (per the parallel-PR convention keeping it unpublished). Every
`@mulmoclaude/core` range stays `^1.2.0`. The new markdown-plugin core dep uses `^1.2.0`.
The launcher's own version is untouched; launcherSync invariant stays green.

## Verification

- `yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn test`
  (host `test/`, `packages/core`, `packages/plugins/markdown-plugin`).
- Locale switch resolves every key (`yarn dumpi18n` in lint).

## Out of scope

- File-watch (`useFileChange.ts` / `useFileWatch.ts`) — owned by PR #2422 / issue #2404.
- Spreadsheet code (explicitly excluded).
