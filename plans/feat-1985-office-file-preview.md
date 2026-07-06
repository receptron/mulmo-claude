# feat(#1985): Office (xlsx / docx / pptx) file preview + open-in-OS fallback

## Summary

`GET /api/files/content` を拡張して、Office 系ファイル (xlsx / docx / pptx) を
サーバ側で変換して preview 用データを返す。加えて `/api/files/open` を新設し、
OS のファイルマネージャで開くボタン (「Finder で開く」等) を全ての "supported
だけど editor で直接編集できない" 系のファイルに追加。

- **xlsx**: SheetJS で CSV per sheet に変換 → sheet 情報付き JSON で返す →
  frontend で `<table>` 化 (最初のシートだけ表示、複数シートは tab or select)
- **docx**: mammoth で plain text 抽出 → 既存の text kind で返す
- **pptx**: 既存の `convertPptxToPdf()` を preview 用にも呼ぶ → 変換済み PDF
  を per-request temp に置く → 既存の PDF viewer で表示。LibreOffice 未検出時は
  fallback に落ちる
- **共通**: 上記のいずれも変換失敗 or 大きすぎるときは "OS で開く" ボタンを
  fallback として表示

## Items to Confirm / Review

- **Deps は既に揃っている**: `mammoth` / `xlsx` (SheetJS) は attachment 変換
  で既に import 済み、LibreOffice も Docker sandbox で使用済み。今回追加の
  npm dep は無し。
- **キャッシュ戦略**: xlsx/docx 変換は速い (数十 ms) ので毎回変換で OK。
  pptx は LibreOffice subprocess で 2-5s かかるので **mtime + size でキャッシュ**
  ハッシュ、`os.tmpdir()/mulmoclaude-office-cache/<hash>.pdf` に保存。同一
  ファイルの再閲覧を即時化。
- **サイズ制限**: 既存の `MAX_RAW_BYTES` を xlsx/docx/pptx にも適用。過大
  ファイルは変換前に too-large 応答して conversion CPU を守る。
- **セキュリティ**: `/api/files/open` は既存の `resolveWithinRoot` を使って
  workspace 内のパスのみ許可。実行は per-platform:
  - macOS: `open <abs-path>`
  - Linux: `xdg-open <abs-path>` (headless 環境では失敗するが害なし)
  - Windows: `start "" <abs-path>` (cmd 経由、パス quote 必須)
  Docker sandbox 内は host の OS にアクセスできないので、`DISABLE_SANDBOX`
  未設定でも host 側 Express が spawn する形。
- **i18n**: 8 ロケール lockstep で新規キー追加。
- **既存の "text file" 大き過ぎるとき用 too-large 挙動は流用**: xlsx/docx で
  変換後テキストが `MAX_PREVIEW_BYTES` 越えたら too-large にする。

## User Prompt

> https://github.com/receptron/mulmoclaude/issues/1985 viewer を追加できる？
> office 系の document できるだけみえたほうがよいね。
> B: preview + Finder fallback (Recommended).

## Implementation

### Server

1. **`server/utils/officePreview.ts`** (新規、~150 lines):
   - `previewXlsx(absPath: string): Promise<{ sheets: { name: string; csv: string }[] } | null>`
   - `previewDocx(absPath: string): Promise<string | null>` (plain text)
   - `previewPptxAsPdf(absPath: string): Promise<string | null>` (returns path
     to a cached temp PDF, or null if LibreOffice not available). Cache key:
     `sha1(absPath + mtimeMs + size)` → `<tmp>/mulmoclaude-office-cache/<key>.pdf`
   - Deps: `mammoth`, `xlsx`, subprocess spawn for LibreOffice, `crypto.createHash`
2. **`server/api/routes/files.ts`** の `GET /api/files/content`:
   - `classify()` に新 kind `office-xlsx` / `office-docx` / `office-pptx` を追加
   - handler で該当拡張子なら converter を呼び、変換結果 (xlsx→sheets, docx→text,
     pptx→pdf-path) を response body に含める
3. **新規 `GET /api/files/preview-raw`** (pptx の変換済み PDF を stream):
   - path + workspace 内 gate、`previewPptxAsPdf()` の返す absolute path から
     stream。既存 `/api/files/raw` と同じ safety パターン
4. **新規 `POST /api/files/open`**:
   - body: `{ path: string }`, workspace 内 gate
   - platform 判定して `open` / `xdg-open` / `start` を spawn (detached, timeout)
   - respose: `{ ok: true }` (成功) or `{ ok: false, error: string }` (spawn 失敗)

### Client

5. **`src/config/apiRoutes.ts`**: `files.open`, `files.previewRaw` 追加
6. **`src/composables/useFileSelection.ts`**: `FileContent` 型に新 variants:
   ```typescript
   | { kind: "office-xlsx"; sheets: { name: string; csv: string }[]; ...meta }
   | { kind: "office-docx"; content: string; ...meta }
   | { kind: "office-pptx"; previewUrl: string; ...meta }
   ```
7. **`src/components/FileContentRenderer.vue`**:
   - xlsx: sheet 選択 UI (最初は 1 sheet だけならそのまま) + CSV を `<table>`
     化する軽い parser (ダブルクォート考慮)
   - docx: `<pre class="whitespace-pre-wrap">` で text 表示
   - pptx: 既存の PDF `<iframe>` を previewUrl 経由で使用
   - fallback (variant なし or 変換失敗): "OS で開く" ボタン + 従来の
     `content.message` 表示
8. **`src/components/FileContentHeader.vue`** or `FileContentRenderer.vue` の
   fallback branch: `apiPost(API_ROUTES.files.open, { path: selectedPath })`
   を叩くボタン。任意のファイル種でも表示 (unsupported preview のとき最も
   便利、supported でも Excel で直接開きたい時に有用)
9. **`src/lang/*.ts` × 8**: `filesView.openInOs` (mac は "Finder で表示",
   linux は "ファイルマネージャで開く", windows は "エクスプローラで開く" —
   実際は "Open in OS" 相当の共通文言で ok)、`filesView.officePreviewFailed`
   (LibreOffice 未検出等の fallback メッセージ)、xlsx の sheet 選択ラベル等

### Tests

10. **`test/routes/test_filesRoute_office.ts`** (新規):
    - `.xlsx` GET → `sheets: [{ name, csv }]` の shape assert
    - `.docx` GET → `content: "..."` の text
    - `.pptx` GET → LibreOffice ある環境なら `previewUrl` 返り + preview-raw
      から PDF binary が取れる、無い環境なら fallback binary kind
    - `/api/files/open` — mac / linux / windows の 3 分岐で `execFile` を
      spy して呼ばれる引数を assert (実際に spawn はしない)
11. **`test/utils/officePreview.spec.ts`** (新規): SheetJS wrapper + docx
    wrapper の pure conversion test。既存の attachment converter test が
    参考になる

### Docs

12. `docs/manual-testing.md` に追記: xlsx/docx/pptx の preview 動作確認手順、
    LibreOffice 未検出時の fallback 挙動。

## Test plan

- [ ] `yarn tsx --test test/utils/officePreview.spec.ts test/routes/test_filesRoute_office.ts` — pure + integration
- [ ] `yarn format` / `yarn lint` (0 errors) / `yarn typecheck` / `yarn build`
- [ ] 手動: `data/attachments` に生成された `.xlsx` / `.docx` / `.pptx` を
  Files ビューで開いて preview 表示を確認、"OS で開く" ボタンでネイティブ
  アプリが起動することを確認
- [ ] LibreOffice 無い環境で pptx を開いて fallback UI が表示されることを
  確認 (Homebrew の libreoffice を temporarily unlink して検証)

## Out of scope

- **Editing** (xlsx セルの編集、docx の re-write): preview のみ。編集は "OS で開く"
  で Excel/Word/Keynote に任せる
- **PPTX の高精度レンダリング**: LibreOffice の PDF 変換の見た目 (フォント差異)
  を修正するのは範囲外
- **doc / xls (旧バイナリ形式)** のサポート: 今回は Open XML (docx/xlsx/pptx)
  のみ。旧形式の需要が出たら別 issue で
- **Remote host からの preview**: remote-view API に埋め込むのは別スコープ
