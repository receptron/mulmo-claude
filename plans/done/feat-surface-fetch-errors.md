# feat(ui): surface fetch failures uniformly (#280)

## Context

Issue [#280](https://github.com/receptron/mulmoclaude/issues/280) — CodeRabbit's review on PR #279 (Vue fetch consolidation) flagged **6 surfaces** that silently swallow fetch failures. User sees "nothing happened" instead of an error, so diagnosing network / server problems is guesswork. CLAUDE.md already requires "error handling for all fetch calls" — this PR audits the remaining silent paths and wires them up.

## Approach (same pattern across all 6 surfaces)

1. Add `xxxError: Ref<string | null>` (null when healthy).
2. Clear to `null` on every successful API response.
3. Set to `result.error` (from the `ApiResult<T>` union in `src/utils/api.ts`) on failure.
4. Template renders an inline banner — red bg, not a toast — only when `xxxError.value` is non-null. Banner is not dismissable; it clears naturally on the next successful call.

## Surfaces (implementation order per issue #280)

### D. `src/plugins/markdown/View.vue` (GET markdown content)

Currently: on error sets `markdownContent = ""` — indistinguishable from a legit empty document.
Fix: add `loadError` ref. Template: if `loadError` show red banner + "Retry" text; else if empty show the existing "Empty" placeholder; else render markdown.

### C. `src/components/SettingsModal.vue` (GET /api/config on open)

Currently: on load fail leaves partially-populated form + enables Save button — user can submit stale state and clobber real config.
Fix: keep existing `loadError` ref, but also gate `canSave` on `loadError === null`. Show banner at top of modal. Disable Save button when loadError.

### B. `src/composables/useSessionHistory.ts` (GET /api/sessions)

Currently: on error wipes `sessions.value = []` — sidebar goes blank.
Fix: add `historyError: Ref<string | null>`. On error, **keep** existing `sessions.value` untouched and set `historyError`. UI renders a subtle warning above the list.

### E. `src/plugins/scheduler/View.vue` (`callApi` helper, ~L630)

Currently: `callApi` returns `false` on error, UI does nothing.
Fix: add `apiError: Ref<string | null>`. `callApi` sets it on failure. Template renders banner near the controls (same location as existing `yamlError` / `parseError`).

### F. `src/plugins/todo/View.vue` (`callApi` helper, ~L413)

Same pattern as E. Add `todoApiError` ref + inline banner above controls.

### A. `src/composables/useMcpTools.ts` (GET /api/mcp-tools)

Currently: on error keeps "all tools visible" fallback — masks real failures.
Fix: add `mcpToolsError: Ref<string | null>`. Keep the fallback (so the UI doesn't break) but expose the error so consumers (SettingsModal's MCP section) can show a small warning strip.

## Not in scope

- Creating a shared `<ErrorBanner>` component — each surface has slightly different wording + placement constraints, and abstracting prematurely will need undoing. Revisit if a third variant wants the same styling.
- Toast / alert popups — every error here is *persistent* (the failure doesn't auto-resolve), so inline banners are the right UX.
- i18n — no strings are translated in the app today.

## Testing

- **Unit**: where composables already have tests, add one new case per surface: mock the api util to return `{ ok: false, error: "..." }` and assert the error ref is populated. No test for plain components (View.vue) without existing suites.
- **E2E**: not expanded — the error paths require backend failure injection which Playwright mocks handle but we'd need a dedicated spec per surface. Follow up if regressions appear.
- Manual: start dev server, briefly stop backend, verify each surface surfaces the error.

## Checklist

- [ ] D markdown View: loadError + inline banner
- [ ] C SettingsModal: gate Save on loadError + banner
- [ ] B useSessionHistory: historyError, preserve existing sessions on failure
- [ ] E scheduler View: apiError ref + banner
- [ ] F todo View: todoApiError + banner
- [ ] A useMcpTools: mcpToolsError exposed for consumers
- [ ] `yarn format && yarn lint && yarn typecheck && yarn build`
- [ ] `yarn test` (+ new cases where composables have tests)
- [ ] `yarn test:e2e`
- [ ] PR referencing #280
