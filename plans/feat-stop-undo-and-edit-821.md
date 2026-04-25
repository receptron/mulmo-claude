# Stop button as "undo & edit" (#821)

## ゴール

Stop ボタンを「送信を取り消して下書きに戻す」UX に変更する。具体的に:

1. キャンセルされたターンは chat 履歴から消える
2. そのときの user message テキストが入力フォームに戻る
3. exit 143 のエラーチャット表示は出ない

これにより `claudeSessionId` 早期捕捉や `--resume` 挙動検証なしで「cancel = そのターンは存在しなかった」を実現する。

## 背景

- PR #786 で Stop が入ったが merge 後の feedback で 2 件発覚
  - `[Error] claude exited with code 143` が表示される (SIGTERM 由来)
  - 1ターン目 cancel 後の次メッセージが context ゼロで Claude に届く
- 詳細議論は #821 参照

## 実装

### 1. 「中断バッファ」で user message テキストを保持

`App.vue` (or 新 composable):

- `sendMessage` で送る直前に `interruptBuffer` ref に `{ chatSessionId, text, attachments? }` を保存
- 自然完了時 (SSE close、`session_finished`) → buffer をクリア
- cancel 時 → buffer の text を input フォームに restore して buffer クリア

### 2. cancel 時に該当ターンの session state を巻き戻す

`cancelActiveRun` を拡張:

```
async function cancelActiveRun() {
  // 既存: cancel API を投げる
  // 追加:
  //   1. interruptBuffer から text/attachments を取り出す
  //   2. その chat session の最後の user turn (message + 後続の
  //      assistant blocks / toolResults) を session.toolResults /
  //      session.entries から trim
  //   3. input.value = buffer.text、attachments もリストア
  //   4. interruptBuffer.value = null
}
```

### 3. サーバ側: jsonl / session state の整合

- `cancelRun` 時にその turn を「キャンセルされた」とマーク
- `endRun` で cancel フラグが立っていれば、jsonl からその turn の events を truncate
- 具体的には: `beginRun` 時点を「ターン境界」として記録し、cancel された場合だけ「境界以降の events」を消す
- すでに永続化されている events を消すので、ファイル truncate を atomic に行う

### 4. exit 143 を error event として出さない

`server/agent/index.ts:133-138`:

```
// Before:
if (exitCode !== 0) {
  yield { type: EVENT_TYPES.error, message: ... };
}

// After:
if (exitCode !== 0 && !abortSignal?.aborted) {
  yield { type: EVENT_TYPES.error, message: ... };
}
```

`abortSignal` は `runAgent` の引数として既に渡っており、`readAgentEvents` まで伝搬する必要あり (現在 `readAgentEvents` は `proc` のみ受け取る)。signature を `(proc, opts: { abortSignal? })` に拡張。

### 5. クライアント: error event の追加 suppress

server 側で `abortSignal.aborted` 判定を入れたので、cancel 由来の error event は元から流れてこない。クライアント側の追加処理は不要。

## ファイル変更想定

| ファイル | 変更 |
|---|---|
| `server/agent/index.ts` | `readAgentEvents` に abortSignal 引数。aborted なら error event を yield しない |
| `server/api/routes/agent.ts` | cancel 時にターン境界を記録、`endRun` で events を truncate |
| `server/events/session-store/index.ts` | `beginRun` でターン境界マーカーを保持、`cancelRun` でフラグ |
| `src/App.vue` (or composable) | `interruptBuffer` の管理 + restore ロジック |
| `src/components/ChatInput.vue` | cancel 時 input.value 書き換え (emit ベースでも OK) |
| 既存 session 型 | turn-boundary 用に少しフィールド追加 |
| テスト | `formatElapsed` 系のように pure 部分は単体、composable はスモール |

## テスト

### Unit

- abortSignal aborted = true なら readAgentEvents が error event を yield しない
- abortSignal aborted = false の通常 exit !== 0 では error event を yield する (既存挙動 regression)
- session-store: cancelRun 後に endRun が呼ばれると events が truncate される

### E2E (Playwright)

- 1ターン目 send → Stop → input フォームにメッセージが復元、chat に user bubble が残らない、`[Error]` が出ない
- 2ターン目 send → Stop → 1ターン目は無傷、2ターン目だけ undo
- 自然完了 → input は空のまま (buffer がクリアされている)

## 注意点 / 設計判断

- 添付 (画像) の復元は v1 では text のみ。添付付きで cancel された場合は添付情報が消える (acceptable for v1)
- 部分出力 (assistant 途中まで) も全削除する。ChatGPT/Discord 等の同等機能と挙動を揃える方針
- 複数ターン目を cancel した場合「最後のターンだけ undo」を保証 (jsonl truncate を最後のターン境界以降に限定)
- 既に jsonl がディスクに persist されている部分の truncate は atomic な writeFile で安全に

## ロールアウトリスク

- 中。chat 履歴の削除を伴うので、誤って正常完了したターンが消えるバグが入ると致命的。Server 側の turn-boundary 管理を慎重に組む
- jsonl truncate の race (cancel 直後に新 send が来る) に注意 — endRun が完了するまで次 sendMessage を block する既存ガード (`activeSessionRunning`) があるので問題ないはず

## Items to Confirm / Review

- ターン境界をどこで切るか — `beginRun` 時点で「境界マーカー (= 現在の jsonl の末尾位置)」を保持し、cancel 時にそこまで truncate
- restored input が submit ガード (Enter 押下、IME 競合) と整合するか
- 自然完了 path で interruptBuffer がクリアされる順序 (race-free か)
