# plan: unify filter chips across panels with a shared `<FilterChip>` component

## Goal

Filter chips currently live in four panels (Wiki, History, Sources, News) with
four different visual languages — different blues, different text sizes
(`text-[10px]` / `text-[11px]` / `text-xs`), different count formats (separate
`<span>` vs inline `(N)`), and inconsistent borders. Standardize all four on
the Wiki spec via a single shared `<FilterChip>` Vue component.

## Non-goals

- No behavioral change: single-vs-multi-select, "All" semantics, sort order,
  testid names, i18n keys, ARIA — all preserved per panel.
- No change to **toolbar mode toggles** (e.g. News' Unread/All segmented
  control). Those stay in the toolbar with chrome-standard `h-8` styling.
- No change to **inline tag pills** like Wiki's `entry-tag-chip` (used inside
  list items, not as filter rows).
- No change to **action buttons** that share the filter row (e.g. News'
  "Mark all read", Sources' "Clear filter").
- No new filter UX (clear-all chip, multi-select toggling, etc.).

## Design

### Standard

Adopt Wiki's existing `tag-chip` spec verbatim:

| Property | Value |
|---|---|
| Padding | `px-2 py-0.5` |
| Text | `text-xs leading-4` (12px / 16px line-height) |
| Shape | `rounded-full`, 1px border always |
| Active | `bg-blue-600 text-white border-blue-600` |
| Inactive | `bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200` |
| Count format | inline `label (N)` — no separate span |

### New component — `src/components/FilterChip.vue`

```vue
<script setup lang="ts">
defineProps<{
  active: boolean;
  label: string;
  count?: number;  // omit to hide the count
}>();
defineEmits<{ click: [] }>();
</script>

<template>
  <button
    type="button"
    :aria-pressed="active"
    :class="[
      'inline-flex items-center px-2 py-0.5 text-xs leading-4 rounded-full border transition-colors cursor-pointer',
      active
        ? 'bg-blue-600 text-white border-blue-600'
        : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200',
    ]"
    @click="$emit('click')"
  >
    {{ label }}<template v-if="count !== undefined"> ({{ count }})</template>
  </button>
</template>
```

`data-testid` and other attrs flow to the root `<button>` via Vue's default
attrs passthrough — callers keep their existing testid strings.

### Migration (4 sites)

**1. Wiki** — `src/plugins/wiki/View.vue` lines 124–147
- Replace three `<button class="tag-chip ...">` blocks with `<FilterChip>`.
- Remove scoped CSS for `.tag-chip` / `.tag-chip-active` / `.tag-chip-inactive`
  (lines 686–709). **Do NOT** remove `.entry-tag-chip` (still used in list
  items).
- Visual change: none.

**2. History** — `src/components/SessionHistoryPanel.vue` lines 10–21
- Replace the `v-for` button with `<FilterChip>`.
- For the `all` filter, pass `:count="undefined"` (current code suppresses the
  count for `all`).
- Visual change: blue-500 → blue-600; inactive bg `white` → `gray-100`; count
  format `12` → `(12)`. Minor.

**3. Sources** — `src/components/SourcesManager.vue` lines 149–160
- Replace the `v-for` button with `<FilterChip>`.
- Pass `:count="filterCounts[key]"` for every chip (current code shows count on
  all keys including `all`).
- Visual change: inactive bg `white` → `gray-100`; count format `12` → `(12)`.
  Minor.

**4. News (source row only)** — `src/components/NewsView.vue` lines 41–52
- Replace the `v-for` button with `<FilterChip>`.
- Visual change: largest of the four. Active goes from light `bg-blue-100
  text-blue-700` to solid `bg-blue-600 text-white`; borders added; text
  `text-[11px]` → `text-xs`. Worth eyeballing in the browser before merge.

### Out of scope but worth noting

The header rows that **contain** these filter chip rows have their own padding
mismatches (`px-3 py-2` / `px-4 py-2` / `px-5 py-3` / no padding). This plan
does NOT touch container padding — that's a separate cleanup. Filed mentally
for a follow-up if/when we standardize panel header chrome.

## Files touched

- `src/components/FilterChip.vue` — new
- `src/plugins/wiki/View.vue` — replace chips, remove scoped CSS for tag-chip
- `src/components/SessionHistoryPanel.vue` — replace chips
- `src/components/SourcesManager.vue` — replace chips
- `src/components/NewsView.vue` — replace source-filter chips only

## Tests

E2E tests select these chips by `data-testid` (e.g. `wiki-tag-filter-${tag}`,
`session-filter-${f}`, `sources-filter-chip-${key}`, `news-source-${slug}`).
testids are preserved verbatim, so existing tests should keep passing.

`yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn test` per
CLAUDE.md before considering done. Manual eyeball pass on each of the 4
panels (especially News) before PR.

## Open questions

- Whether the `bg-blue-600 / white` active style is too loud for the News
  source row, where chips can number 5+ and previously used a softer fill.
  Decision: ship as-specified per the user's "Wiki に統一" call; revisit only
  if visually jarring once landed.
