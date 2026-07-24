# feat: Google Tasks / Drive(file) ツール — google plugin への横展開 — #2115

#2120 で `google` ツール(Calendar)と `@mulmoclaude/core/google` エンジンが揃い、同意スコープには `tasks` / `drive.file` も先取りで含めてある。本 issue はその中身の実装。

## 前提(疎通確認済み 2026-07-17)

- 連携済みトークンのスコープに `calendar.events` / `tasks` / `drive.file` の3つが入っている → **再連携不要**
- Cloud Console 側の Tasks API / Drive API は**有効化済み**(実トークンで `tasks/v1/users/@me/lists` と `drive/v3/files` がともに HTTP 200)

## 設計方針

- Calendar と同じ形: core にエンジン関数 → plugin の `google` ツールに kind を追加(単一ツール・kind 判別を維持)。remote コマンドは需要が出るまで追加しない。
- `drive.file` は**アプリが作成したファイルのみ**が対象(ユーザーの Drive 全体は見えない = restricted 回避)。この制約は説明文に明記してエージェントの誤解を防ぐ。
- 日時は Calendar と同じ厳格 RFC3339 検証(`isIsoDateTimeWithOffset`)を共有。Tasks の `due` は RFC3339 だが Google 側で日付精度に丸められる仕様なのでコメントで明示。

## Phase A — core エンジン

`packages/core/src/google/tasks.ts`:
- `listTaskLists(accessToken)` → `{ id, title }[]`
- `listTasks(accessToken, { taskListId?, maxResults?, showCompleted? })` → `TaskSummary[]`(`id / title / status / due / notes`)
- `createTask(accessToken, { title, notes?, due?, taskListId? })` → `TaskSummary`
- `completeTask(accessToken, { taskId, taskListId? })` → `TaskSummary`
- `taskListId` 省略時は `@default`(Google の既定リスト別名)

`packages/core/src/google/driveFile.ts`:
- `listDriveFiles(accessToken, { maxResults? })` → `DriveFileSummary[]`(`id / name / mimeType / webViewLink / modifiedTime`)
- `createDriveFile(accessToken, { name, content, mimeType? })` → multipart upload、既定 `text/plain`
- `readDriveFile(accessToken, { fileId })` → `{ file, content }`(テキスト系のみ。バイナリは拒否)

共通: 既存 `calendar.ts` の `fetchWithTimeout` / 403 ヒント / truncate エラー本文のパターンを踏襲。エラーヘルパは `googleApiError(api, status, body)` として共有化を検討(calendar のものを一般化)。

## Phase B — plugin ツール

`google` ツールに kind 追加:
- `tasksList` / `tasksCreate` / `tasksComplete` / `taskListsList`
- `driveList` / `driveCreate` / `driveRead`

説明文に「Drive はこのアプリが作成したファイルのみ」「Tasks の due は日付精度」を明記。args は Zod 判別和で検証。

## Phase C — help / ドキュメント

- `assets/helps/error-recovery.md` の Google 節に Tasks / Drive の 403(API 未有効)ヒントを追記
- plugin README の kind 一覧を更新

## テスト

- core: マッピング関数の unit(`toTaskSummary` / `toDriveFileSummary`、エラーヘルパ)
- plugin: args 検証(必須項目 / due の RFC3339 / maxResults clamp / 未知 kind)
- 実機 smoke: タスク作成 → 一覧 → 完了 → 後片付け、Drive ファイル作成 → 読み取り → 一覧 → 削除

## リリース

- core / google-plugin を patch or minor で publish(新 API 追加なので **minor**: core 0.21.0 / google-plugin 0.2.0)、launcher range lockstep
