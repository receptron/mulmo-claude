# feat: Tag-based filtering on the Wiki index

## Problem

Wiki pages already carry `tags: [...]` in YAML frontmatter (e.g. `ai-security, research-paper`), but the index view in `src/plugins/wiki/View.vue` has no way to show or filter by them. As the wiki grows past ~30 pages, the flat alphabetical list becomes hard to navigate. Users want to narrow the index to a single topic (e.g. show only `#ai-agents` pages).

The API response (`WikiPageEntry`) exposes `title`, `slug`, `description` — no `tags` field — so the frontend can't filter even if it wanted to. Reading each page file on every index request to pull tags from frontmatter would work but adds per-request fs cost. Cheaper: put tags directly in `index.md` alongside each entry so the existing `parseIndexEntries` pass picks them up.

## Goal

1. Extend `index.md` formats to carry tags per entry.
2. Parse them into `WikiPageEntry.tags` and return via `/api/wiki`.
3. In `View.vue`'s index view: show a tag filter chip row at the top, tag chips next to each entry, and filter the list to entries matching the selected tag.
4. Lint: flag drift between a page's frontmatter `tags` and the tags recorded for that slug in `index.md`.

## Non-goals

- Multi-tag (intersection / union) filtering. Single selected tag in v1; "all" resets.
- Tag editing UI — tags are still authored by Claude via `index.md` and page frontmatter.
- Migrating existing workspace `index.md` files. Entries without tags just render zero chips and don't contribute to the filter bar.
- A standalone `/wiki/tag/:tag` route. Filter is view-local state only.
- Singleton-tag / typo detection or any fuzzy tag similarity checks.
- Touching the workspace `data/wiki/SCHEMA.md` from code — that file is Claude-maintained. The code-owned `server/workspace/helps/wiki.md` is the only schema doc we update.

## Design

### Index format additions

**Table format** (what the current workspace `index.md` uses) — add a `Tags` column. Detection is header-based, case-insensitive, so existing 4-column tables (`Slug | Title | Summary | Updated`) keep working with empty tags:

```markdown
| Slug | Title | Summary | Tags | Updated |
|------|-------|---------|------|---------|
| `satoshi-nakajima` | Satoshi Nakajima | Engineer… | biography, japan, tech | 2026-04-10 |
```

- Tags cell is comma- or space-separated. Empty cell → `tags: []`.
- Parser reads header row once per `index.md` parse, maps column names → indices, extracts `tags` from the mapped column. Falls back to the current positional `[slug, title, description]` for the first three when header is absent or non-standard.

**Bullet format** (canonical per SCHEMA.md) — append `#tag` tokens anywhere in the description:

```markdown
- [Transformer Architecture](pages/transformer-architecture.md) — foundational seq2seq model #ml #attention (2026-04-05)
```

- `#tag` tokens are matched with `/(?:^|\s)#([a-z0-9][a-z0-9-]*)/gi`, extracted into `tags`, and stripped from the resulting `description`.
- Keeps back-compat: descriptions without `#` tokens yield `tags: []` and an unchanged description.

Both formats land in the same `WikiPageEntry` shape — the UI doesn't care which authoring style the user picked.

### Type changes

`server/api/routes/wiki.ts`:

```ts
export interface WikiPageEntry {
  title: string;
  slug: string;
  description: string;
  tags: string[]; // always present, empty array when none
}
```

Mirror the same change in `src/plugins/wiki/index.ts` (the frontend-side `WikiPageEntry`). Keep `tags` required (non-optional) so every code path has to reason about it — avoids the optional-undefined-empty trilemma in filter logic.

### Server parser changes

Three places in `server/api/routes/wiki.ts`:

1. **`parseTableRow`** — change from the current positional-only parser to a header-aware one. Add a `parseIndexEntries` outer pass that:
   - Detects the header row (first `|…|` line where cells are non-code-fenced identifiers).
   - Builds a column index map: `{ slug: 0, title: 1, summary: 2, tags: 3, updated: 4 }` (case-insensitive, whitespace-trimmed).
   - Uses the map when reading data rows; unmapped columns are ignored.
   - Falls back to the current positional read when the header is missing or doesn't contain a `slug`/`title` column.
2. **`parseBulletLinkRow` / `parseBulletWikiLinkRow`** — run a small `extractHashTags(description)` helper on the captured description before returning:
   ```ts
   function extractHashTags(desc: string): { description: string; tags: string[] } { … }
   ```
   Returns the stripped description and the sorted, deduped tag list.
3. **API response** — no shape change (tags live on each `WikiPageEntry`); just make sure the `tags: []` default is applied uniformly.

Keep the three parser functions under the 20-line style limit — extract `extractHashTags` and `buildTableColumnMap` as named pure helpers in the same file and export them for direct unit tests.

### Frontend (`src/plugins/wiki/View.vue`)

Current index render (lines 70–83) is a flat list keyed by `entry.slug`. Changes:

1. **Tag filter bar** — render above the list when `action === 'index'` and there's at least one tag across all entries. Horizontal scrollable flex row of chips:
   - First chip: "All" (`t('pluginWiki.tagFilterAll')`). Active when no filter is selected.
   - One chip per unique tag, label = `tag (count)`. Active when `selectedTag === tag`.
   - Click behaviour: click an inactive chip to set filter; click the active one (or "All") to clear.
   - Data-testids: `wiki-tag-filter-all`, `wiki-tag-filter-<tag>`.
2. **Per-entry tag chips** — small gray pills between title and description (or wrapping to a new line on narrow widths). Each chip is clickable and sets the filter to that tag. `data-testid="wiki-entry-tag-<slug>-<tag>"`.
3. **Filtering logic** — computed `visibleEntries`: if `selectedTag === null` return `pageEntries`, else return `pageEntries.filter(e => e.tags.includes(selectedTag))`.
4. **Empty filtered state** — when `selectedTag` is set and `visibleEntries.length === 0`, show `t('pluginWiki.noMatches', { tag })` instead of the list (the top-level "Wiki is empty" branch is unchanged).
5. **State is local** — `const selectedTag = ref<string | null>(null)`. Not persisted to URL, not synced to props. Switching away from the index view and back resets the filter.

Tag list computation:
```ts
const allTags = computed(() => {
  const counts = new Map<string, number>();
  for (const entry of pageEntries.value) {
    for (const tag of entry.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])); // by count desc, then name asc
});
```

Small helpers (`allTags`, `visibleEntries`) stay in the `<script setup>` — no new composable unless a second caller appears.

### Lint: tag drift

Add one new pure helper to `server/api/routes/wiki.ts`:

```ts
export function findTagDrift(
  pageEntries: readonly WikiPageEntry[],
  frontmatterTagsBySlug: ReadonlyMap<string, readonly string[]>,
): string[] { … }
```

Rules:
- For each `entry` in `pageEntries` where the slug exists in `frontmatterTagsBySlug`:
  - Compare as sorted sets. If they differ, emit `- **Tag drift**: \`<slug>.md\` frontmatter has [a, b, c] but index.md has [a, b]`.
- Slugs with no frontmatter file are already caught by `findMissingFiles`; don't double-report.
- Slugs whose frontmatter has no `tags:` field at all → treat as `[]` and compare.

Frontmatter reader:
- Add `server/api/routes/wiki/frontmatter.ts` (new file; the existing `wiki/` subdir already holds `pageIndex.ts`).
- Exports `parseFrontmatterTags(content: string): string[]` — reads only the first `---`-fenced YAML block, matches a `tags:` line in either flow (`tags: [a, b, c]`) or block (`tags:\n  - a\n  - b`) style, returns the list. Anything unparseable → `[]`. No third-party YAML dep — a ~20-line regex extractor is enough for this narrow field.

Wire into `collectLintIssues` (lines 311–338):
- After the existing orphan / missing / broken-link passes, read frontmatter in parallel over the already-loaded `contents` array (no extra fs pass — `contents` is already produced by the broken-link pass at line 328).
- Build the `frontmatterTagsBySlug` map, call `findTagDrift`, push issues.

### i18n — all 8 locales in lockstep

Add under `pluginWiki` in `src/lang/{en,ja,zh,ko,es,pt-BR,fr,de}.ts`:

| Key | English |
|---|---|
| `tagFilterAll` | `All` |
| `noMatches` | `No pages tagged {tag}` |
| `lintChat` | `Lint My Wiki` |

Translate each into the target locale — don't copy English. Placeholders (`{tag}`) stay verbatim. `en.ts` is the schema source of truth, so add there first, then the 7 siblings in the same PR.

### Schema doc

Update `server/workspace/helps/wiki.md`:

- Under **`index.md` Format**: document the new `Tags` column (table) and `#tag` tokens (bullet), with a worked example of each.
- Add a short "Tags" subsection explaining: tags in frontmatter are the source of truth; tags in `index.md` must match; lint flags drift.

## Implementation steps

1. **Server types + parser.** Extend `WikiPageEntry`, add `extractHashTags` + `buildTableColumnMap` helpers, update `parseTableRow` / `parseBulletLinkRow` / `parseBulletWikiLinkRow`. Default `tags: []` everywhere. Export the new helpers.
2. **Server tests** (`test/routes/test_wikiHelpers.ts`): table with Tags column, table without (back-compat), bullet with `#tag` tokens, bullet without, tag dedup + sort, non-ASCII-safe.
3. **Frontmatter reader** (`server/api/routes/wiki/frontmatter.ts`) + unit tests: flow-style `tags: [a, b]`, block-style list, missing frontmatter, missing `tags:` field, malformed YAML (returns `[]`).
4. **Lint rule**: add `findTagDrift` + direct unit tests alongside existing ones. Wire into `collectLintIssues` using the already-read `contents` array.
5. **Frontend type mirror** in `src/plugins/wiki/index.ts`.
6. **`View.vue` UI**: tag filter bar, per-entry chips, `visibleEntries` computed, empty-filter state. Scoped styles match existing Tailwind chip vibe (gray border, blue active).
7. **i18n**: `tagFilterAll`, `noMatches`, `lintChat` across all 8 locales.
8. **Schema doc** update in `server/workspace/helps/wiki.md`.
9. **Run** `yarn format && yarn lint && yarn typecheck && yarn build && yarn test`.

## Test plan

### Unit (server, `node:test`)

- `extractHashTags`:
  - `"notes #ml #attention"` → `{ description: "notes", tags: ["attention", "ml"] }` (sorted, deduped).
  - `"plain text"` → `{ description: "plain text", tags: [] }`.
  - `"#a #a #b"` → `tags: ["a", "b"]`.
  - `"#ml-arch"` / `"#AI"` — hyphens allowed, lowercased.
- `buildTableColumnMap`:
  - Header `| Slug | Title | Summary | Tags | Updated |` → map includes `tags: 3`.
  - Header without `Tags` → map omits it; parser returns `tags: []`.
  - Case + whitespace tolerance.
- `parseIndexEntries`:
  - Table with Tags column populates tags.
  - Back-compat: legacy 3-col table (no Tags) → `tags: []` on every entry (regression guard for the existing test at line 87).
  - Bullet with `#tag` populates tags and strips them from description.
  - Bullet with em-dash + tags: `- [[X]] — desc #a #b` → `description: "desc"`, `tags: ["a", "b"]`.
  - Mixed table + bullet entries both carry tags correctly.
- `parseFrontmatterTags`:
  - Flow `tags: [a, b, c]` → `["a", "b", "c"]`.
  - Block list `tags:\n  - a\n  - b` → `["a", "b"]`.
  - Missing frontmatter → `[]`. Missing `tags:` → `[]`. Malformed YAML → `[]`.
- `findTagDrift`:
  - Matching sets → no issues.
  - Different sets → one issue per mismatched slug, message includes both lists.
  - Slug in `pageEntries` but not in frontmatter map → no issue (handled by `findMissingFiles`).
  - Empty frontmatter tags vs non-empty index tags → flagged.

### E2E (Playwright, extend `e2e/tests/wiki-plugin.spec.ts`)

- Mock `/api/wiki` to return entries with varied tags. Navigate to `/wiki`:
  - Tag filter bar renders; "All" chip is active by default.
  - Per-entry chips render with correct labels.
  - Click `#ai-agents` chip in the filter bar → only entries with that tag visible; chip becomes active; "All" deactivates.
  - Click the active chip → filter clears, full list returns.
  - Click a tag chip on an entry row → filter switches to that tag.
  - Mock an empty-result scenario: select a tag, then navigate to a mocked payload with zero matching entries → empty-state message shown.
- Filter state is view-local: navigate to `/wiki/log` and back → filter is reset (expected, per design).

### Manual

- In a real workspace: ask Claude to regenerate `data/wiki/index.md` with tags following the updated `helps/wiki.md` schema. Verify chips + filter behave against real data.
- Deliberately edit a page's frontmatter `tags` to diverge from `index.md`, run Lint → expect a `Tag drift` entry pointing at that slug. Re-sync → lint clears.
- Non-ASCII entry with tags: `- [さくらインターネット](pages/sakura-internet.md) — クラウド #日本企業 #infra` — confirm the non-ASCII tag `#日本企業` is accepted (or, if we restrict to `[a-z0-9-]`, confirm the restriction is intentional and documented in `helps/wiki.md`). Decision for v1: **ASCII-only tag tokens** in bullet form, to keep the regex simple. Non-ASCII tag names can still be used via the table format's `Tags` column, which accepts any comma-separated string.

## Out of scope / future work

- Multi-tag filtering (AND / OR chips).
- Tag pages / `/wiki/tag/:tag` routes.
- Tag renaming or merging utilities.
- Singleton-tag / typo warnings in lint.
- Automatic back-fill of tags from page frontmatter into `index.md` (a "regenerate index" command).
- Tag coloring / iconography.
