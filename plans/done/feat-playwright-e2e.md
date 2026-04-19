# Plan: Playwright E2E テスト

## Goal

Playwright でブラウザ上の実際の描画・操作・URL 変更を検証する。サーバは動かさず、`page.route()` で API をモックする。

## テストファイル一覧

| Phase | ファイル | 内容 | 状態 |
|---|---|---|---|
| 0 | `smoke.spec.ts` | アプリ読み込み、入力/送信の表示 | **DONE** (#159) |
| 1 | `router-guards.spec.ts` | URL injection 防御 (XSS, traversal, 長大値) | **DONE** (#159) |
| 2 | `router-navigation.spec.ts` | セッション切替 + URL + 戻る/進む | Phase 1 router 後に追加 |
| 3 | `todo-explorer.spec.ts` | Kanban/Table/List 表示 + フィルタ + 検索 + CRUD | OPEN |
| 4 | `todo-columns.spec.ts` | 列追加/削除/リネーム/done切替 | OPEN |
| 5 | `file-explorer.spec.ts` | ファイル選択 + 特殊ビュー (scheduler, todos) | OPEN |
| 6 | `localstorage.spec.ts` | localStorage 状態復元 + 不正値フォールバック | OPEN |
| 7 | `image-plugins.spec.ts` | 画像プラグイン表示 + 空画像フォールバック | OPEN |

## API モック戦略

`page.route()` で全 API をインターセプト。**Playwright は route を逆順マッチする** (最後に登録 = 最初にチェック) ので、catch-all を最初に、specific routes を後に登録する。

URL マッチには glob ではなく predicate 関数を使う — glob は不安定。

## data-testid 命名規則

```text
data-testid="<component>-<element>"
例: session-item-{id}, send-btn, todo-card, file-tree-item
```

## CI

`.github/workflows/pull_request.yaml` の `e2e` ジョブで実行。ubuntu + Node 22 + Chromium。失敗時は `test-results/` を artifact としてアップロード。
