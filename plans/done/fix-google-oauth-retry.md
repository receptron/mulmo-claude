# fix: Google 連携（OAuth）の途中放棄後にリトライできない

独立したバグ修正（当初 #2170 と併せて検討したが、#2170 は不要と判断しクローズ済み。
再リンク経路の堅牢性という一般的な問題としてこのまま進める）。

## 症状

設定 UI で Google 連携を開始し、ブラウザの同意を途中でやめると「ブラウザでの同意完了を待っています…」のまま、
その後もう一度接続できない（リトライ不能）。

## 根本原因（コードから特定）

- `packages/core/src/google/authFlow.ts` の `flowRunning`（= `/api/google/status` の `pending`）は
  `authorizeGoogle()` が settle するまで true。
- `authorizeGoogle()` は loopback リスナーを立て `waitForAuthCode(server, state, AUTH_TIMEOUT_MS)` を待つ。
  `AUTH_TIMEOUT_MS = 5 分`（`auth.ts`）。同意を放棄するとコールバックが来ないため、**5 分のタイムアウトまで settle しない**。
- その間ずっと `pending=true`。`SettingsGoogleTab.vue` の接続ボタンは `:disabled="busy || pending || …"` なので
  **最大 5 分、押せない = リトライできない**。
- 進行中フローを中断する経路が無い。`start()` は進行中フローがあると同じ URL を返すだけで、やり直せない。

## 方針（選択済み）

- 範囲: **リトライ修正のみ**（#2170 のバックエンドは実装済み。カレンダー選択 UI は別 PR）。
- UX: **pending 中も「接続」を押せるようにし、押したら進行中フローを中断して新規開始**。

## 変更

1. `packages/core/src/google/auth.ts`
   - `AuthorizeGoogleOptions` に `signal?: AbortSignal` を追加し、`authorizeGoogle` → `authorizeWithLocalClient` /
     `authorizeWithBroker` → `waitForAuthCode` へ通す。
   - `waitForAuthCode(server, state, timeoutMs, signal?)`: abort でも reject（"authorization cancelled"）。
     タイマ/リスナのクリーンアップを一箇所に集約。コールバック処理は小関数へ抽出（関数 20 行以内）。
   - `finally { server.close() }` は既存のまま（abort でも通り loopback を閉じる）。
2. `packages/core/src/google/authFlow.ts`
   - 契約変更: `start()` は **進行中フローを abort してから新規 launch**（直近が勝つ）。
   - 各フローは自分の `AbortController` を持ち、共有状態（`flowRunning` / `active`）は
     **自分が現行のときだけ** クリア（restart で `active` が差し替わっても古い finally が新フローを潰さない）。
   - abort 起因の失敗は `lastError` に載せない（ユーザー操作の再開でありエラーではない）。
   - `cancel()` を公開（内部再利用 + 将来のキャンセル UI 用）。
3. `server/api/routes/google.ts` — 変更不要（`start()` の意味が「再押下で再開」に変わるだけ）。
4. `src/components/SettingsGoogleTab.vue`
   - 接続ボタンの無効条件から `pending` を外す（`:disabled="busy || clientSecret === 'ambiguous'"`）。

## テスト

- `test/services/google/test_googleAuthFlow.ts`
  - 旧「pending 中は同一 URL を再利用」→ 新「pending 中の start() は前フローを abort して再開」に置換
    （callCount=2、前フローの `signal.aborted===true`、新 URL、pending 継続）。
  - 完了/失敗/エラークリア/URL 前失敗の各既存ケースは維持。
- `test/services/google/test_googleAuthCallback.ts`
  - `waitForAuthCode` が abort で "cancelled" reject する回帰テストを追加。
- 破壊しないこと: e2e `settings.spec.ts`（`missing`=有効 / `ambiguous`=無効のみを主張、pending 無効は未主張）。

## リトライ機構レビュー観点（CLAUDE.md）

- 二重実行: abort→reject は副作用（トークン保存）前で起こる。保存後は settle 済みで abort 無効。OK。
- 待機中の abort: `waitForAuthCode` が signal を購読し即 reject。OK。
- 過剰なエラーマッチ: abort とその他エラーを `signal.aborted` で分岐。abort のみ lastError から除外。OK。
