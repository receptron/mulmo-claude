# feat: ChatInput を「実行中の連投」対応にする

## 背景

現状、エージェントが実行中の間、ユーザーは textarea にタイプはできるが Send ボタンが disabled で送信できない（`ChatInput.vue:69` の `:disabled="isRunning"`）。

ユーザー要望：考え中（実行中）でも追加の文脈や補足情報を送りたい。会話の流れが切れずにいったん投げておきたい。

## 現状の制約（コード上の根拠）

- `src/components/ChatInput.vue:38-51` — textarea は **enabled のまま**（IME 中断回避のため、#1289 で意図的）
- `src/components/ChatInput.vue:69` — Send ボタンは `:disabled="isRunning"`
- `src/App.vue` の `sendMessage()` — `activeSessionRunning` のとき bail する（二重 submit 防止）

## 想定仕様

3 案：

### A. キューイング型（推奨）
- 実行中もユーザーが送信ボタンを押せる
- 押した瞬間に「次のターンに送るキュー」に積まれる（UI 上「⏳ 実行完了後に送信されます」と表示）
- 現在の run が完了した瞬間、キューの内容を新規メッセージとして自動送信
- メリット：実装シンプル、副作用なし、現在の会話が完了してから次の文脈を受ける
- デメリット：本当の意味での「割り込み」はできない

### B. 割り込み型（複雑）
- ストリーミング中のレスポンスを止めて、ユーザーメッセージを差し込む
- Anthropic SDK は native の割り込みサポートが薄いので、現在の run を `abort` → 中断点までの結果を保存 → 新規メッセージ追加 → 再開
- メリット：本物の "途中で口を挟む" 体験
- デメリット：実装複雑、ツール呼び出しの途中中断のセマンティクスが厄介

### C. 並列セッション型
- Send ボタンの隣に「New thread」ボタンを置いて、別セッションで送る
- 既存実装の `sessionId` を変えるだけ
- メリット：ほぼ実装ゼロ
- デメリット：会話の文脈が切れる（ユーザーが望む挙動ではなさそう）

→ **A 案推奨**。B はオーバーキル、C は要件未達。

## A 案の実装スケッチ

1. App.vue で `queuedMessages: PastedMessage[]` を新設
2. `ChatInput.vue` の Send ボタンの `:disabled` を外す
3. `sendMessage()` を分岐：
   - `!activeSessionRunning` → 即時送信（現状）
   - `activeSessionRunning` → `queuedMessages` に push、textarea クリア、トースト or インライン表示「実行完了後に送信されます」
4. run 完了イベントをフックして、キューが空でなければ FIFO で 1 件ずつ自動 send
5. キュー表示の UI：textarea の下に「Queued (N)」と並べて、× で取り消し可能
6. i18n: `chatInput.queuedHint` `chatInput.queueLabel` 等を 8 言語

## 完了条件

- [ ] 実行中に Send ボタンが押せる
- [ ] キューが UI に見える（件数 + 内容のプレビュー + 削除 × ボタン）
- [ ] run 完了後、キューが自動で順次送信される
- [ ] 既存の二重 submit 防止セマンティクスは維持（同じ瞬間に 2 回押しても 1 件しか入らない）
- [ ] IME 中断回避（既存挙動）も維持
- [ ] E2E: 「実行中に追加 prompt 送信 → 完了後に自動配送」のシナリオを 1 件追加
- [ ] 8 言語 i18n 追加

## スコープ外

- B 案（割り込み型）
- 添付ファイル付きメッセージのキューイング（feat-chat-input-multi-attach.md と合流したら検討）
- キューの永続化（リロード生存）

## 起票元

2026-06-16 のチャットセッション。Airtable Automation 棚卸し中、ユーザーから「考え中の時にも Chat を続けて連投したいです。今後検討ください」と要望。
