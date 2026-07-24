# feat(google-calendar): 非Primary カレンダー取得 + イベント/カレンダー色の同期

Issue: receptron/mulmoclaude#2162

## ユーザーフィードバック

> Googleカレンダーの連携について、もし可能であれば、Primary以外のカレンダーの取得とカレンダー項目の色も同期できると大変助かります。次の変更の際にご検討いただけると嬉しいです

要件の確認: **ユーザーが Google アカウントに登録(追加・購読)しているカレンダーの一覧を参照**し、
そこからイベントを読み、各イベント/カレンダーの色も取得できるようにする。

## スコープ

現状は取得が `calendar.events` スコープ・URL が `/calendars/primary/events` に固定。

- `CalendarList.list`(カレンダー一覧の発見)には読み取りスコープが必要。
- **broker(mulmoserver)側で最小の `calendar.calendarlist.readonly` を追加済み**(ユーザー対応済み)。
  → mulmoclaude 側の `GOOGLE_SCOPES` も `calendar.calendarlist.readonly` を追加して broker と揃える(ローカル連携パスも同じ許可を要求)。
- 非Primary の**イベント読み取り**(ID 指定)は既存 `calendar.events` で可能。
- イベントの `colorId` は既存スコープで Event に付いてくる。hex 解決は `/colors`(既存 `calendar.events` 内)。

→ 追加スコープは最小の `calendar.calendarlist.readonly` の1個のみ。色は追加スコープ不要。

## 実装

### `@mulmoclaude/core` (packages/core/src/google/)

- `auth.ts`: `GOOGLE_CALENDARLIST_SCOPE`(`calendar.calendarlist.readonly`)を定義し `GOOGLE_SCOPES` に追加。
- `calendar.ts`:
  - `CalendarEventSummary` に `colorId` を追加。
  - `ListEventsInput` / `CalendarEventInput` に `calendarId`(既定 `primary`)を追加。create には `colorId` も。
  - `listCalendars()` → `GET /users/me/calendarList`(id / summary / description / primary / accessRole / backgroundColor / foregroundColor / colorId)。
  - `getCalendarColors()` → `GET /colors`(event / calendar パレット)。
- `index.ts`: 上記の関数/型を re-export。

### `@mulmoclaude/google-plugin`

- `args.ts`: kinds 追加 `calendarListCalendars` / `calendarColors`。`calendarListEvents`・`calendarCreateEvent` に `calendarId`、create に `colorId`。
- `index.ts`: dispatch 追加。
- `definition.ts`: tool description / enum / params 更新。

### host (server/)

- `remoteHost/handlers/googleCalendar.ts`: 既存 list/create に `calendarId` を透過。`google.calendar.listCalendars` / `google.calendar.colors` を追加。
- `remoteHost/handlers/index.ts`: 新コマンド登録。

### tests / docs

- `test/services/google/test_googleCalendar.ts`: `colorId` 反映、`toCalendarSummary` / colors マッピング追加。
- `test/remoteHost/test_googleCalendarHandlers.ts`: `calendarId` 透過、新ハンドラ。
- `packages/plugins/google-plugin/test/test_args_validation.ts`: 新 kinds。
- `packages/core/assets/helps/error-recovery.md`: 新スコープに伴う **再連携** ガイド追記(古い連携では一覧/色が取れない)。

## ロールアウト順

1. broker が `calendar.calendarlist.readonly` を consent に追加(済)。
2. GCP 同意画面(broker web client + desktop client)に `calendar.calendarlist.readonly` 登録を確認。
3. mulmoclaude コードをリリース(`@mulmoclaude/core` + `google-plugin` minor → launcher 再publish)。
4. 既存ユーザ全員が再連携して新スコープを付与。
