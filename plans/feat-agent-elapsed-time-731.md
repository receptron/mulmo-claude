# Agent run elapsed time + per-tool elapsed (#731 PR2)

## ゴール

長時間実行のエージェント中、ユーザに **(A) 全体の経過時間** と **(B) 現在実行中のツール毎の経過時間** を見せる。バックエンド・型・API スキーマを一切変えずにフロントだけで完結させる。

## 背景

#731 (長時間タスクの進捗確認 + 割り込み) の PR シリーズ:

- ✅ **PR1** (#786, merged): Stop ボタン
- 🚧 **PR2** (本 PR): 経過時間インジケーター
- 🤔 **PR3** (将来): mid-flight 追加指示 (バックエンド変更が必要、別途検討)

PR2 を出して #731 をクローズ可能にする。PR3 はバックエンドの message-queue 変更が必要で副作用が大きいので別 issue 化する。

## 現状

`src/components/ToolResultsPanel.vue:48-64` の Thinking indicator は既に存在:

- `statusMessage` ("Thinking…" 等) + bouncing dots
- `pendingCalls` (実行中ツール) のリスト表示

**未実装**: 経過時間表示 (run 全体 / 個別ツール)

## 実装

### A. Run-level elapsed time

新 composable `src/composables/useRunElapsed.ts`:

- `isRunning` を watch
- `true` 遷移時に `startedAt = Date.now()`、1s tick の `setInterval` を開始
- `false` 遷移時に interval clear、`startedAt = null`
- 公開: `elapsedMs: ComputedRef<number | null>`、`teardown(): void`
- 1秒粒度で十分 (秒未満を表示する必要なし)

### B. Per-tool elapsed time

既存の `usePendingCalls.ts` の 50ms displayTick を流用 (ToolCallHistoryItem.timestamp が開始時刻なので、そこから now() を引くだけ)。`ToolResultsPanel.vue` 側で `formatElapsed(now - call.timestamp)` を表示。

50ms tick は既存仕様で、テンプレート内 inline 計算に流す形が一番自然。

### Format helper

新 pure helper `src/utils/agent/formatElapsed.ts`:

```
< 1s    → "0.3s"
< 60s   → "12s"     // 整数秒、小数なし
< 60min → "1m 23s"
≥ 60min → "1h 5m"
```

A 用 (run elapsed) は >= 1s 想定だから "12s" / "1m 23s" / "1h 5m"。  
B 用 (tool elapsed) は < 1s も出るので "0.3s" 表記を使う。

### UI 配置

`ToolResultsPanel.vue` の `<!-- Thinking indicator -->` ブロック内:

- (A) statusMessage の右に "· 1m 23s" 形式で追加
- (B) 各 pending call 行の末尾に "· 2.3s" 形式で追加

色は既存の text-gray-400 / 500 をそのまま使う。新しい i18n キーは不要 (時間表記は数字のみ)。

## 副作用範囲

- バックエンド: **変更なし**
- API スキーマ: **変更なし**
- 型定義: **変更なし** (composable の返り値型のみ追加)
- i18n: **変更なし** (時間フォーマットは locale-independent)
- 既存テスト: **影響なし** (既存の表示は維持、追加要素のみ)

## テスト

### 1. `formatElapsed` 単体テスト (`test/utils/agent/test_formatElapsed.ts`)

- 0ms / 100ms / 999ms (sub-second)
- 1s / 12s / 59s
- 60s / 90s / 3599s
- 3600s / 3660s / 7200s
- 負の値 (defensive — 0s 表示)

### 2. `useRunElapsed` composable 単体テスト (`test/composables/test_useRunElapsed.ts`)

- isRunning false→true で startedAt セット、tick 開始
- isRunning true→false で interval clear、elapsedMs 更新停止
- teardown() で interval cleanup
- (時間進行は `setInterval` を fake timer でテスト or 簡略化)

### 3. e2e: 既存の todo / chat スペックは動作維持を確認 (CI のみ、手動 e2e は本 PR で追加しない)

## ロールアウトリスク

低。UI 表示の追加のみ。最悪ケースでも既存の Thinking indicator が壊れることはなく、追加要素の表示だけが落ちる。

## #731 のクローズ

PR2 がマージされたら #731 をクローズ。コメントで:

- ✅ PR1: Stop button (#786)
- ✅ PR2: elapsed time + per-tool elapsed (本 PR)
- ⚠️ PR3: mid-flight 追加指示 — バックエンド変更が大きいので別 issue で改めて検討

## Items to Confirm / Review

- 1秒粒度の `setInterval` の cost (単一 session、ほぼ無視できるが一応書いておく)
- 表示位置が混雑しないか (statusMessage が長い locale だと窮屈になる可能性)
- 60min 超のエージェント runs は実在するか? (ある — scheduler 経由の長時間タスクなど)
