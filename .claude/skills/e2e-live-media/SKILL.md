---
name: e2e-live-media
description: 実 Claude API を叩く media カテゴリ（画像 / PDF / 動画）の総合テストを実行する。`yarn dev` が起動済みであることが前提。
---

## 前提

- `yarn dev` を別ターミナルで起動済み（`http://localhost:5173` が応答する）
- Claude 認証済み（`claude login` 済み or `ANTHROPIC_API_KEY` 設定済み）

## 実行

```bash
yarn test:e2e:live:media
```

## デバッグ時

```bash
HEADED=1 yarn test:e2e:live:media
```

## カバーするシナリオ

- **L-01**: presentHtml の `<img src="../../../images/...">` が `/artifacts/html` 経由で描画される（B-17 / B-18 回帰）
- **L-02**: 画像参照を含む Markdown 応答が PDF として DL できる（B-19 / B-20 回帰）
- L-03 以降は別 PR で順次追加（plans/feat-e2e-live.md 参照）

## 結果の確認

- 詳細: `playwright-report-live/media/index.html`（このカテゴリ専用サブディレクトリに出力されるので、 親 `/e2e-live` の総合レポートは上書きされない）
- 動画リプレイ: `npx playwright show-trace test-results-live/media/<spec>/trace.zip`

## Docker on/off の検証も必要な場合

このカテゴリ単独で両モード回したい時は、 親 `/e2e-live` の Step 3 と同じ手順で dev サーバを再起動してから再実行する。
