# feat: CC実行中もユーザ入力をロックせず、送信をバッファーにためる (#2067)

## 背景 / 要望

現状、CC 実行中はユーザ入力 textarea が `:disabled="isRunning"` でロックされ、
`sendMessage()` も `activeSessionRunning` 中は早期 return する。

要望（terminal に近い挙動）:

1. 実行中も入力欄をロックしない
2. 実行中に送信（Enter）した内容はバッファー（キュー）にたまる。複数可
3. 各バッファー項目は × ボタンで削除できる
4. CC 実行が完了したら、バッファーの内容を入力欄（textarea）に改行区切りで結合して戻す
5. ユーザが最終的に編集して手動送信する
6. Ctrl+Enter（Mac は Cmd+Enter も）で改行を挿入できる

## UX 決定（ユーザ確認済み 2026-07-12）

- 完了時: 入力欄に戻して手動送信（自動送信しない）
- 実行中のボタン列: 「停止」のみ（現状維持）。バッファー追加は Enter キー

## 現状のコード

- `src/App.vue`
  - `userInput`（グローバル ref、セッション切替でクリアされない）
  - `sendMessage()` は `activeSessionRunning` 中は return
  - `activeSessionRunning`（表示中セッションの実行状態、`useSessionDerived` 由来）
- `src/components/ChatInput.vue`
  - textarea は `:value=modelValue` / `@input`、`:disabled=isRunning`
  - 実行中は send ボタン → stop ボタン
  - `useImeAwareEnter` で Enter 判定（Shift+Enter は素通しで改行）
  - 添付は `pastedFiles` + `ChatAttachmentPreview` チップ（× 削除は `update:pastedFiles`）

## 実装方針

### 1. 純粋関数 `src/utils/chat/buffer.ts`

- `mergeBufferedIntoDraft(buffered: string[], draft: string): string`
  - `[...buffered, draft]` を `trim` + 空要素除去して `\n` で結合
  - ユニットテスト対象

### 2. `ChatInput.vue`

- textarea の `:disabled="isRunning"` を削除（ロックしない）
- 新規 prop `bufferedMessages: string[]`、emit `update:bufferedMessages`
- textarea の上（`pastedFiles` チップと同位置）に buffered チップ一覧を描画
  - 各チップ: メッセージ本文（省略表示、`title` に全文）+ × ボタン
  - × で該当 index を除いた配列を `update:bufferedMessages`
  - `data-testid="buffered-message-list"` / `data-testid="buffered-message"`
- `onKeydown`: Ctrl/Cmd+Enter を最優先で捕捉し、カーソル位置に改行を挿入
  （`insertNewlineAtCursor`）。IME 確定中は無視
- 実行中でも Enter は従来どおり `emit("send")`。ボタン列は現状維持
- 実行中プレースホルダを切り替え（任意）

### 3. `App.vue`

- 新規 state: `bufferedMessagesBySession = ref<Record<string, string[]>>({})`
  （セッションIDごとにキュー）+ 書込み可能 computed
  `currentBufferedMessages`（表示中セッションのキューを get/set）
- `sendMessage(text?)`:
  - `if (!message) return;`
  - `if (activeSessionRunning.value)`:
    - `currentBufferedMessages.value = [...currentBufferedMessages.value, message]`
    - textarea 由来（`typeof text !== "string"`）なら `userInput = ""`
    - return
  - それ以外は従来の送信フロー
- 完了 / 切替 watch `watch([activeSessionRunning, currentSessionId], ...)`:
  - まだ実行中 / 表示中セッションのキュー空 → 何もしない
  - 非実行かつキューあり →
    `userInput = mergeBufferedIntoDraft(currentBufferedMessages, userInput)`、
    当該セッションのキュークリア、`focusChatInput()`
- 両 ChatInput 呼び出し（単一 / stack レイアウト）に
  `v-model:buffered-messages="currentBufferedMessages"` を追加

### 4. i18n（全 8 ロケール）

- `chatInput.removeBuffered`（× の aria-label）
- `chatInput.runningPlaceholder`（実行中プレースホルダ、任意）

### 5. テスト

- ユニット: `test/utils/chat/test_buffer.ts`（merge の正常・空・trim・順序）
- e2e: `e2e/tests/chatinput-buffer.spec.ts`
  - 実行中に Enter でチップ増加 → × 削除 → 完了で textarea へ結合
  - **複数セッション同時実行でキューが混線しない**（回帰テスト）
  - Ctrl+Enter で改行挿入

## セッションスコープ

- バッファーは `bufferedMessagesBySession`（セッションIDごと）で保持。表示中
  セッションのキューは、そのセッションが非実行になった時点でのみ入力欄へ結合。
  別セッションで実行中のキューは各セッション固有に保たれ、混線しない。
- `userInput`（下書き）は従来どおりグローバル。
