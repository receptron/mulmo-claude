# fix(#1675): deep-link into a collection stops force-switching to calendar view

## Summary

Cause 1 of #1675, in the reporter's split: opening a collection via a Bell notification / `?selected=<id>` deep-link path forced the view to `calendar` (via `maybeOpenCalendarForSelected` in `CollectionView.vue`), which then landed in localStorage via the view-mode watcher and permanently overrode the user's saved `table` (or `kanban`) preference for that collection.

**Fix** — delete `maybeOpenCalendarForSelected` and its call site. Deep-linked records now open in the user's saved view; the record modal opens over that view via the untouched `syncViewToSelected`. If someone wants the calendar day popup, they switch to calendar from the header.

Cause 2 of the same issue (modal-only editing lost inline enum column changes) is a separate design conversation and is out of scope here — the reporter explicitly asked for two PRs.

## Items to Confirm / Review

- [ ] **`dayOfItem`** is still used elsewhere (line 2101 for in-app calendar-day click, line 2301 for follow-selection). Kept.
- [ ] **`openDay`** is untouched — calendar view still opens the day popup when the record is actively selected while calendar is the current view (line 2101 path). This PR only removes the FORCED switch during the load path.
- [ ] **No localStorage repair** for users already bitten by the bug. They'll see `calendar` as their saved default one more time; a single explicit view switch persists the correct preference. I considered a one-shot migration wipe of all `collection_view_modes.<slug> === "calendar"` entries, but it over-corrects for users who genuinely picked calendar. If the reporter wants the wipe, we can bolt it on as a small follow-up.
- [ ] **No tests added** — behaviour change is a single deletion inside a deep, script-setup Vue component. A focused unit test would need a large harness for marginal coverage; the existing e2e suite exercises the deep-link path.

## User Prompt

> Bug で優先度高くて対応したほうが良いのを順次。

## Original bug report (isamu, #1675)

> 通知 (Bell) からコレクションに飛ぶと、ユーザがそのコレクションで普段使っているビューに関わらず **calendar に強制切替** され、しかも localStorage に書き込まれて以降の default も calendar になってしまう。

Cause chain confirmed against current code:

```
deep-link で slug が変わる
  → loadCollection() 走る
  → syncViewToSelected() で viewing.value セット (これは保持したい)
  → maybeOpenCalendarForSelected() で「日付フィールドあり & item 日付あり」なら view.value = "calendar"  ← 削除
  → watcher が writeCollectionViewMode(slug, "calendar") で localStorage 永続化  ← これも起こらなくなる
  → 次回オープン時 localStorage が "calendar" を返す → カレンダーが default に  ← 起こらなくなる
```

## Implementation

- `packages/plugins/collection-plugin/src/vue/components/CollectionView.vue`:
  - Remove the `maybeOpenCalendarForSelected()` call from `loadCollection()` (line 1374).
  - Delete the function definition (lines 2150–2156).
  - Add an inline comment at the call site explaining why the force-switch was removed (so it doesn't get "restored" as a helpful-looking one-liner in the future).

## Test plan

- [x] `yarn format` / `yarn lint` (0 errors) / `yarn typecheck` / `yarn build` / `yarn test`.
- Manual smoke:
  1. Open a calendar-capable collection (with a `date` field), switch to `table` view. Confirm localStorage stores `"table"`.
  2. Navigate to another page.
  3. Click a Bell notification for a record in that collection.
  4. **Expected**: land on the collection in `table` view, record modal opens for the selected item. localStorage still says `"table"`.
  5. Switch to `calendar` view manually. Confirm the day popup still opens on the selected record's day (existing behaviour via line 2101).

## Out of scope

- **Cause 2** — modal-only editing lost inline enum column changes (`eefefe65` unification). Design conversation needed; separate PR per the reporter's split.
- **localStorage cleanup** for users already polluted. Notable but potentially destructive to legitimate calendar-first users; deferred pending explicit ask.
