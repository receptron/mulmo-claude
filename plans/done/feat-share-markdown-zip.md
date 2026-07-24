# feat: 共有機能 Phase 3 — Markdown / Wiki を自己完結HTML zip でDL

Date: 2026-07-02
Issue: #1908 · Follow-up to #1892 / #1901 / #1907

## ゴール

Markdown / 単一Wikiページ を **自己完結HTML（画像 data URI インライン + CSS インライン）**に変換し、
**zip**（`index.html` 単一）でダウンロードできるようにする。対象は Markdownチャット / Wiki / エクスプローラーの `.md` の全部。
Phase 2（S3）とは独立。

## 方式（DRY: PDF パイプライン再利用）

`server/api/routes/pdf.ts` の `renderMarkdownPdf` は
`wrapHtml(inlineImages(marked.parse(source)), MARKDOWN_CSS)` で自己完結HTMLを作ってから PDF 化している。
その **HTML 生成段を `renderMarkdownHtml(opts): Promise<string>` として抽出**し、PDF/zip 双方から使う。

## 実装

### Server
- `server/api/routes/pdf.ts`: `renderMarkdownHtml(opts)`（marp/非marp両対応）を export し、
  `renderMarkdownPdf` はそれを `renderPdf` に渡すだけに簡素化。
- `server/api/routes/share.ts`: `POST /api/share/pack-markdown`（body 検証: markdown 必須, baseDir/marp/stripFrontmatter）。
  `renderMarkdownHtml` → **script無効化CSP注入(`withScriptCsp`)** → `zipBundle([{ bundlePath:"index.html", bytes }])` → 安全なファイル名。
  （別utilは作らず share.ts 内の `buildMarkdownZip` に集約。）
- `src/config/apiRoutes.ts`: `share.packMarkdown`。
- **セキュリティ**: zip は受信者がHTMLを直接開くため、`marked` の raw HTML 通過による script を CSP
  (`script-src 'none'; object-src 'none'; base-uri 'none'`) で無効化（PDF経路は puppeteer で1回描画のみなので不要）。

### Client
- `src/composables/useMarkdownZip.ts`（新, `usePdfDownload` を鏡）: markdown/opts を POST → zip blob → DL。`packing`/`packFailed`/`reset`。
- `src/plugins/textResponse/View.vue`: 既存 PDF ボタン隣に ZIP（チャット＋エクスプローラー.md を同時にカバー）。
- `src/plugins/wiki/View.vue`: 既存 PDF ボタン隣に ZIP（`baseDir=data/wiki/pages`, `stripFrontmatter=true` は PDF と同じ引数）。
- i18n: 各ビューのロケールに download / downloadZip / downloadError。

## テスト
- `renderMarkdownHtml`: 自己完結（`<!DOCTYPE`, inline `<style>`, ローカル画像が data URI）。
- `packMarkdownZip`: `index.html` を含む有効 zip・安全ファイル名。
- 実アプリで各ビューの ZIP DL 確認。

## Out of scope
S3アップロード / 台帳（Phase 2）、Wiki 全体 SSG（不要）。
