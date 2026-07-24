# feat: 共有機能 Phase 1b — HTMLビューに「Download (zip)」導線

Date: 2026-07-01
Follow-up to #1889 / #1892 (Phase 1 backend).

## ゴール

Phase 1 の pack+zip をブラウザから使えるようにする。HTMLビューに Download ボタンを足し、
クリックで自己完結zipをダウンロードできるようにする（ユーザ／e2e が実際にクリックしてテスト可能に）。

## 制約と方式

HTMLビュー（`@mulmoclaude/html-plugin` の `View.vue`）は host-agnostic で、ホストへは
`useRuntime().dispatch()` 経由でのみ到達できる（ホストが bearer を自動付与、JSON を返す）。
バンドル処理（バイナリ読取＋zip）は host 側 `server/utils/share` にあり、プラグインは
host を import 不可。そこで:

- View → `runtime.dispatch({ kind: "packHtml", path })`（JSON: base64 zip を受領）。
- `packHtml` は **host 側 dispatch ハンドラ（`html-builtin.ts`）で intercept** し、
  `server/utils/share` を使って処理。プラグインの純粋ルータ `executeHtmlDispatch` は不変
  （`packHtml` は `HtmlDispatchArgs` union に入れない）。

## 変更

- `server/utils/share/packHtml.ts`: `packHtmlZip()`（bundle→zip→安全なファイル名）を追加。
  route と dispatch で共有（DRY）。
- `server/api/routes/share.ts`: `packHtmlZip` を使うよう簡素化。
- `packages/plugins/html-plugin/src/core/contract.ts`（+ `core/index.ts`）: `PackHtmlArgs` /
  `PackHtmlResult`（base64）を追加・公開。
- `server/plugins/html-builtin.ts`: dispatch で `packHtml` を intercept → `isHtmlPath` 検証 →
  `packHtmlZip` → base64 返却。
- `packages/plugins/html-plugin/src/vue/View.vue`: ヘッダに Download ボタン、`dispatch` →
  base64→Blob→ダウンロード、エラーバナー。
- lang（messages + 8 locale）: `download` / `downloadZip` / `downloadError`。

## テスト

- `test/utils/share/test_packHtml.ts`: `packHtmlZip`（ファイル名 + zip 構造）。
- View の Blob ダウンロードはブラウザ専用のため、型/ビルドで担保（e2e は将来）。

## Out of scope

S3互換アップロード / 共有台帳 / Markdown・Wiki アダプタ（後続フェーズ）。
