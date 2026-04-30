---
name: e2e-live
description: 実 Claude API を叩く総合テスト（全カテゴリ）を実行する。リリース前ではなく、定期的に手動で回して回帰を検出するための skill。`yarn dev` が起動済みであることが前提。
---

## 前提

- `yarn dev` を別ターミナルで起動済み（`http://localhost:5173` が応答する）
- Claude 認証済み（`claude login` 済み or `ANTHROPIC_API_KEY` 設定済み）
- `e2e-live` ディレクトリのテストは実 LLM を呼ぶため、API 利用枠を消費する

## 実行手順（Docker on / off 両モード）

mulmoclaude の Docker サンドボックス挙動はこのテスト群でカバーする品質の重要な軸なので、 **両モードで回す** こと。 切替は dev サーバ再起動が必要なため Claude では自動化できない — 都度ユーザーに手順を案内する。

### Step 1: 現在モードで実行

```bash
yarn test:e2e:live
```

### Step 2: 結果を確認

- 進捗: ターミナル（`list` reporter）でリアルタイム表示
- 詳細: `playwright-report-live/index.html`（失敗時は自動オープン）
- 動画リプレイ: `npx playwright show-trace test-results-live/<spec>/trace.zip`
- 失敗時の動画: `test-results-live/<spec>/video.webm`

### Step 3: 反対モードに切り替えてもらう

ユーザーに **明確に** 次の指示を出す:

> 次は **Docker を反対モード** で回したいので、 dev サーバを再起動してください:
>
> - **Docker off にする場合**: いま起動中の `yarn dev` を Ctrl+C で停止 → `DISABLE_SANDBOX=1 yarn dev`
> - **Docker on にする場合**: いま起動中の `yarn dev` を Ctrl+C で停止 → `yarn dev`（こちらが既定）
>
> 起動が `http://localhost:5173` で ready になったら教えてください。 もう一度 `yarn test:e2e:live` を回します。

ユーザーの再起動完了通知を待つ。 待ち中に勝手にテストを開始しない（古い dev サーバが残っていると `ERR_CONNECTION_REFUSED` か誤った結果になる）。

### Step 4: 反対モードで再実行 + 統合サマリ

ユーザーから "再起動した" の合図がきたら、 もう一度 `yarn test:e2e:live` を回す。 両モードの結果（Pass / Fail カウント、 違いがあったシナリオ）を 1 つのサマリにまとめてユーザーに返す。

## デバッグ時（QA が画面で動作を見たい場合）

```bash
HEADED=1 yarn test:e2e:live
```

Chromium ウィンドウが開き、`slowMo: 200ms` で動作が目で追える。

## 失敗時の対応

各失敗はカテゴリ・シナリオ ID（L-01 〜 L-30）に紐づいている。`plans/feat-e2e-live.md` の Appendix に内部バグ ID（B-XX）との対応表があるので、回帰したバグを特定できる。

## カテゴリ別の skill

特定カテゴリだけ走らせたい場合は以下を使用：

- `/e2e-live-media` — 画像 / PDF / 動画
- `/e2e-live-roles` — ロール別 sample query（未実装）
- `/e2e-live-session` — セッション / 履歴（未実装）
- `/e2e-live-wiki` — Wiki / Router（未実装）
- `/e2e-live-ui` — UI / 通知 / プラグイン（未実装）
- `/e2e-live-skills` — Skill / Tool（未実装）
- `/e2e-live-docker` — Docker 環境特有（未実装）

カテゴリ別 skill は `playwright-report-live/<category>/index.html` に出力するので、 親 `/e2e-live` の総合レポートは上書きされない。
