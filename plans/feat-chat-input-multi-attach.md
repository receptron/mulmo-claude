# feat: ChatInput を複数添付対応にする

## 背景

ユーザーが複数のスクショ（例: Airtable Automation 一覧 + その詳細）を 1 ターンで送りたいユースケースがある。現状は picker / paste / drop の 3 経路すべて 1 ファイル制限。バックエンド / モデルは `[Attached file: <path>]` 複数行を既に解釈できるので、UI 側 1 箇所の改修だけで複数対応できる。

## 現状の制約（コード上の根拠）

- `src/components/ChatInput.vue:90` — `<input type="file">` に `multiple` 属性なし
- `src/components/ChatInput.vue:181-194` — `onPasteFile` は最初のファイルで `return`
- `src/composables/useFileDropZone.ts:36, 108` — `event.dataTransfer?.files[0]` で 1 件だけ拾う
- `src/components/ChatInput.vue` props の `pastedFile: PastedFile | null` が単数型
- `src/App.vue:541, 561-566` — `chatInputRef.value?.readFile(file)` も単数前提

## 想定スコープ

1. `pastedFile: PastedFile | null` → `pastedFiles: PastedFile[]` へ配列化
2. `<input type="file">` に `multiple` 属性追加（`ChatInput.vue:90`）
3. `onFilePicked` — `input.files` を for-loop で全件 `readAttachmentFile()`
4. `onPasteFile` — `return` を `continue` に変えて clipboard items 全件処理
5. `useFileDropZone` の `onFile: (file)` → `onFiles: (files)` に変更、`dataTransfer.files` を全件渡す
6. `ChatAttachmentPreview` をリスト表示に変更（既存はおそらく単発プレビュー）
7. 個別添付の削除 UI（× ボタン）
8. `MAX_ATTACH_BYTES` の扱い — 合計 30MB か、1 件 30MB × N か。前者推奨
9. i18n: `chatInput.tooManyFiles` `chatInput.fileTooLarge` 等の文言を 8 言語

## 完了条件

- [ ] picker / paste / drop の 3 経路すべてで複数ファイルが取れる
- [ ] 添付プレビューが横並びリストで表示され、個別に × 削除できる
- [ ] サーバー送信時に `[Attached file: <path>]` 行が複数になる（既存サーバー側受信ロジックを壊さない）
- [ ] 1 件 30MB 超 or 合計 N MB 超のときに分かりやすいエラー
- [ ] E2E: 既存テスト `e2e/chat-attachment.spec.ts` 等が緑、複数添付のシナリオを 1 件追加
- [ ] 8 言語 i18n 追加（en/ja/zh/ko/es/pt-BR/fr/de）

## スコープ外

- 添付ファイル間の並べ替え（drag reorder）
- 添付ライブラリ的な永続保存
- 個別ファイル毎の異なる処理（例: 画像は OCR、PDF はテキスト抽出 など）

## 起票元

2026-06-16 のチャットセッション。Airtable Automation 棚卸しで「スクショ 2 枚を 1 回で添付したい」というユーザー要望が発端。当面は 2 通連投で回避。
