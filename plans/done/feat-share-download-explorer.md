# feat: 共有機能 Phase 1c — ファイルエクスプローラーのHTMLプレビューにも Download(zip)

Date: 2026-07-01
Follow-up to #1892 / #1901.

## 背景

Phase 1b（#1901）で **チャットのキャンバス**（presentHtml の `View.vue`）に Download(zip) を追加したが、
**ファイルエクスプローラー**の HTML プレビュー（`FileContentRenderer.vue` の生 iframe）には出ない。
ユーザが「ファイルを見ながら DL」する自然な導線なので、そこにも足す。

## 方式

`FileContentRenderer.vue` は **ホスト側(`src/`)** なので、プラグインの `runtime.dispatch` を介さず
**既存の `/api/share/pack` ルートを直接叩ける**（`apiFetchRaw` が bearer を自動付与）。
`usePdfDownload` と同じ blob-to-download パターンを踏襲。

## 変更

- `src/composables/useSharePack.ts`（新）: `POST /api/share/pack {path}` → zip blob → ダウンロード。
  `packing` / `packError` state。`usePdfDownload` のミラー。Content-Disposition からファイル名を取得。
- `src/components/FileContentRenderer.vue`: `artifacts/html` の iframe プレビュー（`isHtml && htmlPreviewUrl`）を
  relative ラッパーに変え、右上に Download ボタン（`data-testid="file-html-download"`）＋エラー表示を overlay。
- host i18n（8 locale）: `fileContentRenderer.download` / `fileContentRenderer.downloadZip`。

## テスト

`useSharePack` はネットワーク依存のためユニットは薄い。ボタン表示条件（`isHtml && htmlPreviewUrl` =
artifacts/html のみ）と blob DL は型/ビルドで担保 + 実アプリで file explorer から DL 確認。
サーバ変更なし（Phase 1 の route を再利用）。

## Out of scope

非 `artifacts/html/` の HTML（`srcdoc` フォールバック分）は pack 対象外（route が artifacts/html に限定）。
S3アップロード / 台帳 / MD・Wiki は後続。
