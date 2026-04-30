---
name: e2e-live-wiki
description: 実 mulmoclaude を叩く wiki カテゴリ (markdown image coverage) の総合テストを実行する。`yarn dev` が起動済みであることが前提。
---

## 前提

- `yarn dev` を別ターミナルで起動済み(`http://localhost:5173` が応答する)
- このカテゴリは LLM を呼ばない (wiki ページを直接ファイルとして seed → 標準ルートでレンダー → naturalWidth を assert) ので、Claude 認証は不要

## 実行

```bash
yarn test:e2e:live:wiki
```

## デバッグ時

```bash
HEADED=1 yarn test:e2e:live:wiki
```

## カバーするシナリオ

issue #1011 の Stage C 実装。`data/wiki/pages/<slug>.md` の本文に書ける各画像参照形式が、SPA の v-html サーフェス上で実際に decode されるか (`naturalWidth > 0`) を検証する。

- **L-W-S-01**: 生 `<img src="../../../artifacts/images/...">`(Stage A — markdown rewriter が raw `<img>` を扱えるか)
- **L-W-S-02**: 標準 markdown `![](url)`(常に動くべきパスのリグレッション)
- **L-W-S-03**: `<picture><source><img></picture>`(Stage B 依存 — 現在は `test.fixme` でスキップ)
- **L-W-S-04**: 壊れた prefix `<img src="/wrong/prefix/artifacts/images/...">` が `useGlobalImageErrorRepair` で復活するか
- **L-W-S-05**: `data/wiki/sources/<file>` への相対参照

## 結果の確認

- レポート: `playwright-report-live/wiki/index.html`(カテゴリ専用サブディレクトリに出力)
- トレース: `npx playwright show-trace test-results-live/wiki/<spec>/trace.zip`

## 関連

- Plan: [`plans/feat-markdown-image-coverage.md`](../../../plans/feat-markdown-image-coverage.md) §自動テスト(e2e-live)
- Umbrella issue: [#1011](https://github.com/receptron/mulmoclaude/issues/1011)
- L-W-S-03 を有効化するには Stage B (HTML 側 `rewriteHtmlImageRefs` を `<source>` / `<video poster>` 対応に拡張) が先に必要。
