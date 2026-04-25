# feat: /sources page

Tracks: #673

## Goal

Add a dedicated `/sources` page so users can register, list, and delete information sources (RSS feeds, GitHub releases/issues, arXiv searches) without going through the chat `manageSource` tool.

## Design

### Reuse strategy

`src/plugins/manageSource/View.vue` (718 lines) already renders the full manager UI (add form, source list with delete, rebuild, today's brief). But it's coupled to `props.selectedResult.data` for initial seed. Two paths:

1. Pass a stub `selectedResult` to the plugin View from `/sources` — brittle, plugin layer leaks into the page.
2. **Extract the body into `SourcesManager.vue`** that owns its own state via `apiGet`. Plugin View wraps it and forwards the seed; page mounts it directly.

Going with (2). Cleaner separation, same code path for both contexts.

### Components

- `src/components/SourcesManager.vue` — all the form/list/rebuild logic. Optional `initialData` prop to accept the plugin's seed; when absent, fetches on mount.
- `src/components/SourcesView.vue` — thin page wrapper: `<SourcesManager />` in a full-height container. No props.
- `src/plugins/manageSource/View.vue` — thin plugin wrapper: `<SourcesManager :initial-data="selectedResult.data" />`. Also forwards `@update-result` if the plugin API needs it.

### Router

`PAGE_ROUTES.sources = "sources"` + `{ path: "/sources", name: PAGE_ROUTES.sources, component: Stub }`.

### App.vue

Add to canvas column:

```vue
<SourcesView v-else-if="currentPage === 'sources'" />
```

### Nav entry

`PluginLauncher.vue` `TARGETS[]` gets a `sources` entry alongside `/wiki`, `/skills`, etc. Icon: `rss_feed` (material-icons).

### i18n

New keys (all 8 locales):

- `pluginLauncher.sources.label` — short button label
- `pluginLauncher.sources.title` — tooltip / aria-label

Existing `pluginManageSource.*` keys are already populated and reused by `SourcesManager`.

## Files touched

- `src/components/SourcesManager.vue` (new)
- `src/components/SourcesView.vue` (new)
- `src/plugins/manageSource/View.vue` (slim down)
- `src/router/index.ts`
- `src/App.vue`
- `src/components/PluginLauncher.vue`
- `src/lang/{en,ja,zh,ko,es,pt-BR,fr,de}.ts`
- `e2e/tests/sources-page.spec.ts` (new)

## Out of scope

- Per-source schedule editing after registration
- Source re-classification UI (rebuild button covers bulk refresh)
- Bookmarkable deep-links to a specific source (`/sources/:slug`)

## Test plan

- e2e
  - `/sources` direct-link renders the manager with fetched sources
  - Clicking "add" shows the form; submitting calls `POST /api/sources`
  - Delete button calls `DELETE /api/sources/:slug` and removes the row
  - The existing `manageSource` plugin View (chat context) still works with the extracted component
- Manual
  - Nav entry appears in PluginLauncher and navigates to `/sources`
  - Rebuild button triggers `POST /api/sources/rebuild`
  - Error messages display correctly when the API returns non-ok
- `yarn typecheck` / `yarn lint` / `yarn build` clean
