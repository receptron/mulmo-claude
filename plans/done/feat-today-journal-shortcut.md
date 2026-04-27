# Today's journal shortcut (#876)

One-click affordance in the top-bar icon cluster that opens today's journal daily summary in FilesView, falling back to the most recent existing summary when today's hasn't been generated yet.

## User prompt

> Journal daily passって全てのユーザで実行されて今日のまとめって全ユーザでつくられるんだよね？そうしたらそこへの(wikiかな？）ショートカットほしいね

Follow-up Q&A:
- 配置 → C: トップバーのアイコン1個（chrome-row standard）
- 当日が無い時 → ii: 直近の既存 `daily/*.md` を探して開く

## Architecture

```
[SidebarHeader] → useLatestDaily() composable
                    │
                    ├─ GET /api/journal/latest-daily
                    │     ↓
                    │  { path: "conversations/summaries/daily/YYYY/MM/DD.md",
                    │    isoDate: "YYYY-MM-DD" }
                    │     | null (when no daily summary exists)
                    │
                    └─ router.push(`/files/${path}`)  → FilesView md render
                       OR  toast(t("sidebarHeader.todayJournalNotFound"))
```

## Server endpoint

`server/api/routes/journal.ts` (new). One handler:

```ts
GET /api/journal/latest-daily
→ { path: string; isoDate: string } | null
```

Algorithm — deepest-first walk:

1. List directories under `conversations/summaries/daily/` (workspace-rooted), filter to 4-digit names, take max → `YYYY`.
2. List under `daily/YYYY/`, filter to 2-digit names, take max → `MM`.
3. List `*.md` under `daily/YYYY/MM/`, filter to `/^\d{2}\.md$/`, take max → `DD.md`.
4. If any step yields no matches at its level, walk back to the previous level and try the next-largest. (E.g. `2026/05/` exists but is empty → try `2026/04/`.)
5. Return `null` if exhaustion produces nothing.

Why deepest-first walk over a flat readdir-recursive: directories under `daily/` may include partial-month entries (`2026/05/` empty, `2026/04/` has files) that a naive max-by-stringified-name would miss. Two-level walk with backtrack gives the correct answer with bounded I/O (3 readdir calls in the happy path).

Implementation: pure helper in `server/workspace/journal/latestDaily.ts`, route handler is a thin wrapper. Helper takes `workspaceRoot` so unit tests can pass a tmpdir.

## Client

### `src/config/apiRoutes.ts`

Add constant:
```ts
journal: {
  latestDaily: "/api/journal/latest-daily",
},
```

### `src/composables/useLatestDaily.ts` (new)

```ts
export function useLatestDaily() {
  const router = useRouter();
  const { t } = useI18n();
  const loading = ref(false);
  async function openLatestDaily(): Promise<void> {
    loading.value = true;
    try {
      const response = await apiGet<{ path: string; isoDate: string } | null>(
        API_ROUTES.journal.latestDaily,
      );
      if (!response.ok) {
        // Network or HTTP error — surface via the same not-found path
        // since the user-visible outcome is the same: no journal to open.
        showToast(t("sidebarHeader.todayJournalNotFound"));
        return;
      }
      if (response.data === null) {
        showToast(t("sidebarHeader.todayJournalNotFound"));
        return;
      }
      router.push(`/files/${response.data.path}`);
    } finally {
      loading.value = false;
    }
  }
  return { openLatestDaily, loading };
}
```

`showToast` — check if there's an existing toast composable; if not, use a simple `alert()` for v1 and ticket the toast as follow-up. (Don't block this PR on toast infrastructure.)

### `src/components/SidebarHeader.vue`

Add button inside the existing icon cluster `<div class="flex gap-0.5">`, between `NotificationBell` and the settings button:

```vue
<button
  class="h-8 w-8 flex items-center justify-center rounded text-gray-400 hover:text-gray-700"
  data-testid="today-journal-btn"
  :title="t('sidebarHeader.todayJournal')"
  :aria-label="t('sidebarHeader.todayJournal')"
  :disabled="loading"
  @click="openLatestDaily"
>
  <span class="material-icons">today</span>
</button>
```

Sizing matches the settings button next to it (`h-8 w-8`, no padding override). Loading state disables the button to avoid double-click navigation races.

## i18n

Two new keys, English source of truth:

```ts
sidebarHeader: {
  // ... existing keys
  todayJournal: "Today's journal",
  todayJournalNotFound: "No journal summary yet — chat for a while and the journal will generate one.",
},
```

Translations per locale:

| Locale | todayJournal | todayJournalNotFound |
|---|---|---|
| en | Today's journal | No journal summary yet — chat for a while and the journal will generate one. |
| ja | 今日のまとめ | まだまとめがありません — しばらく会話するとjournalが生成します。 |
| zh | 今日总结 | 暂无总结 — 多聊一会儿，journal 会自动生成。 |
| ko | 오늘의 요약 | 아직 요약이 없습니다 — 잠시 대화하면 journal이 생성합니다。 |
| es | Resumen de hoy | Aún no hay resumen — chatea un rato y el journal lo generará. |
| pt-BR | Resumo de hoje | Ainda sem resumo — converse um pouco e o journal será gerado. |
| fr | Résumé du jour | Pas encore de résumé — discutez un peu et le journal en générera un. |
| de | Heutige Zusammenfassung | Noch keine Zusammenfassung — chatte etwas und das Journal erstellt eine. |

## Tests

### `test/api/test_journalRoute.ts` (new) — server endpoint

Use tmpdir helper to construct workspaces with controlled `conversations/summaries/daily/` layouts.

- empty `daily/` → `null`
- only one file `2026/04/26.md` → returns `{ path: "conversations/summaries/daily/2026/04/26.md", isoDate: "2026-04-26" }`
- multiple years `2025/12/31.md` + `2026/04/26.md` → picks 2026
- multiple months in same year → picks latest month
- year dir with empty month `2026/05/` and populated `2026/04/26.md` → falls back to April
- ignores `.DS_Store`, non-numeric filenames, `.txt` files
- ignores subdirectories under daily/YYYY/MM/ (only `*.md` are candidates)

### `e2e/tests/today-journal-button.spec.ts` (new) — UI

Mock the new endpoint via `mockAllApis`. Two cases:

- mocked `{ path: ".../2026/04/26.md", isoDate: "2026-04-26" }` → click → URL matches `/files/...`
- mocked `null` → click → no navigation, alert/toast text matches the not-found copy (assert via dialog handler since it's `window.alert` in v1)

Skip live filesystem testing — that's covered by the unit tests.

## Files to touch

- New:
  - `server/api/routes/journal.ts`
  - `server/workspace/journal/latestDaily.ts`
  - `src/composables/useLatestDaily.ts`
  - `test/api/test_journalRoute.ts`
  - `test/workspace/journal/test_latestDaily.ts`
  - `e2e/tests/today-journal-button.spec.ts`
- Modified:
  - `server/api/routes/index.ts` (or wherever routes are registered) — wire `journal.ts`
  - `src/config/apiRoutes.ts` — add `journal.latestDaily`
  - `src/components/SidebarHeader.vue` — button + composable wire-up
  - `src/lang/{en,ja,zh,ko,es,pt-BR,fr,de}.ts` — 2 new keys × 8 locales

## Out of scope (deferred)

- Dedicated `/journal` route / FilesView replacement. Use existing md render path.
- Unread / new-summary badge on the button.
- Wiki page auto-include of today's summary.
- Sidebar/calendar surfacing — evaluate after C ships.
- Toast composable infrastructure if it doesn't exist — use `window.alert` for v1, ticket the upgrade.

## Validation checklist (before opening PR)

- [ ] `yarn typecheck` clean
- [ ] `yarn lint` clean (treat existing v-html warnings as pre-existing)
- [ ] `yarn format` clean
- [ ] `yarn build` succeeds
- [ ] `yarn test` passes — new unit tests included
- [ ] `yarn test:e2e --grep "today-journal"` passes
- [ ] All 8 locale files updated in lockstep (vue-tsc enforces this)
