# feat: 単発/長期セッションを分ける — query 数記録 + 24h フィルタ (#1881)

## 背景

セッションが増えると目的のチャットを探すのに迷子になる（umbrella #1883）。「1回だけのセッション」と「長く続くセッション」を分けたい。最初から24時間以上会話しているものを filter したい。

## 方針（#1881 で合意）

- **user query 数を meta に記録**（とっておく。将来の one-shot 判定/表示用）。
- **v1 のフィルタは時間（24h+）**。`updatedAt - startedAt >= 24h` で判定。クライアント側で既存データから導出。

## 実装

### データ記録（サーバ）

- `server/utils/files/session-io.ts`: `SessionMeta.userQueryCount?: number` を追加。`incrementUserQueryCount(sessionId)` mutator（read → `(count ?? 0) + 1` → write、`updateHasUnread` と同形）。
- `server/api/routes/agent.ts`: ユーザターンの `isFirstTurn` 分岐直後（メタ書込み領域）で `incrementUserQueryCount(chatSessionId)` を1回呼ぶ。`createSessionMeta` は count を seed しないので first turn は undefined→1。
- `server/api/routes/sessions.ts`: `buildSessionSummary` で `userQueryCount` を SessionSummary に露出（`exactOptionalPropertyTypes` 準拠の条件代入）。

### クライアント型/マージ

- `src/types/session.ts`: `SessionSummary.userQueryCount?: number`。
- `src/utils/session/mergeSessions.ts`: `SERVER_OVERRIDE_KEYS` に `userQueryCount` を追加（live セッションの merge でサーバ値を保持）。

### フィルタ（時間 v1）

- `src/utils/session/longRunning.ts`（新・pure）: `LONG_RUNNING_THRESHOLD_MS = 24h`、`sessionDurationMs()`、`isLongRunning()`。パース不能な時刻は 0 扱い（corrupt 行で落ちない）。
- `src/config/historyFilters.ts`: `longRunning: "longRunning"` を `HISTORY_FILTERS` と `HISTORY_FILTER_ORDER`（bookmarked の後）に追加。
- `src/components/SessionHistoryPanel.vue`: `matchesFilter` に `longRunning → isLongRunning(session)` 分岐。
- i18n 8 locale に `filters.longRunning`（ラベルに `(24h+)` を入れ閾値を自己説明）。

## テスト

- `test/utils/session/test_longRunning.ts`（新）: 閾値境界（24h inclusive）、短/長、負の span、パース不能。
- `test/utils/files/test_session_io.ts`: `incrementUserQueryCount` の undefined→1→2、meta 無し no-op、他フィールド保持。

## 将来（別 issue / フォローアップ）

- `userQueryCount` を使った `one-shot`（query=1）フィルタ、または件数のバッジ表示。
- 既存セッションの count backfill（jsonl の user text を数える）。今は記録開始のみ。

## 関連

umbrella #1883 / #1880 / #1881
