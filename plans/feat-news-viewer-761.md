# Feat: News viewer UI with unread management (#761)

## Why

Sources are auto-fetched into `artifacts/news/` but there's no
dedicated UI for browsing them — users have to open files manually
or ask the agent. We need a Feedly-like reader so the value of the
ingestion pipeline is actually visible.

Issue body + comments resolved the open questions:
- Strategy A: aggregate daily JSON in memory, **no separate index**
  (v1 covers ~30 days; deeper history is a follow-up).
- Source-level filter: deferred to a chip in the news view itself,
  plus a `/news?source=<slug>` deep link from the Sources page.

## Scope (v1)

### Data sources (already on disk)

- `artifacts/news/daily/YYYY/MM/DD.md` — daily LLM brief; the trailing
  ```json``` block holds the per-item index (`id`, `title`, `url`,
  `publishedAt`, `categories`, `sourceSlug`, optional `severity`).
- `artifacts/news/archive/<slug>/YYYY/MM.md` — per-source markdown
  archive with optional body text per item.

### Server (`server/api/routes/news.ts`)

- `GET /api/news/items?days=30` → `{ items: NewsItem[] }`
  - Walk the daily files for the last `days`, parse the trailing
    JSON block, flatten + dedupe by `id`, sort descending by
    `publishedAt`.
  - 7 / 30 / 90 day windows handled by the same query param;
    capped (e.g. ≤ 90) to keep memory bounded.
- `GET /api/news/items/:id/body` → `{ body: string | null }`
  - Look up the item's `sourceSlug` + `publishedAt` from the daily
    aggregate (cached briefly), open the archive file, parse the
    `## <title>` block matching this URL, return the body markdown
    if any.
  - `body: null` when the item has no archive body, or the archive
    file is missing — frontend falls back to "open original".
- `GET /api/news/read-state` / `PUT /api/news/read-state`
  - File-backed: `config/news-read-state.json` with shape
    `{ readIds: string[] }`. Atomic writes via `writeFileAtomic`.
  - Bound the size at the route layer (e.g. cap at 10k ids; older
    ones get pruned).

### Client (`src/components/NewsView.vue` + composables)

- New route `/news` (push `/news?source=<slug>` from the Sources
  page once that filter ships in #768).
- Layout: left list (compact card per item — title / source / time /
  unread bullet), right detail pane (title / metadata / body if
  available / "Open original" link).
- Filters:
  - **Read state**: All / Unread (toggle).
  - **Source**: chip group of sources that actually have items.
- Actions:
  - Auto-mark-as-read when the detail pane shows an item (250 ms
    debounce — avoids racing "I clicked away too fast").
  - Mark-all-read button (bulk PUT with current ids).
- Sidebar entry under the existing plugin launcher row, with an
  unread-count badge.

### State stores

- `src/composables/useNewsItems.ts` — owns the items list, last
  refresh, error state.
- `src/composables/useNewsReadState.ts` — owns `Set<string> readIds`
  + sync to the server. Exposes `markRead(id)`, `markAllRead()`,
  `unreadCount`.

### i18n

New `pluginNews` namespace, mirrored across all 8 locales:

- view title / nav label
- filter chips (All / Unread)
- empty / loading states
- "Open original", "Mark all read"
- "No body available" fallback

### E2E (`e2e/tests/news-view.spec.ts`)

- Mock `/api/news/*` endpoints with a small fixture.
- Open `/news`, see list, click an item, detail pane shows metadata,
  unread bullet disappears.
- Toggle Unread filter, list narrows.
- Click "Mark all read", list empties under Unread filter.

## Out of scope (Issue #761 follow-up tickets)

- > 30-day history (per-source JSON sidecar from the pipeline)
- Full-text search across items
- Favourites / per-item tags
- Mobile swipe / keyboard nav
- Push notifications / bridge integration

## Acceptance

- [ ] `/news` route renders, default 30-day window, sorted newest-first
- [ ] Read state persists across reload
- [ ] Source-filter chip group works
- [ ] Mark-all-read empties the Unread filter
- [ ] Unread badge appears on the sidebar entry
- [ ] All 8 locales have the new keys
- [ ] E2E covers the happy-path flow
- [ ] `yarn format` / `yarn lint` / `yarn typecheck` / `yarn test` clean
