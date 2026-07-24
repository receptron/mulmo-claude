# fix: Serialize bridge chat turns per external chat (#1878)

## User Prompt

> https://github.com/receptron/mulmoclaude/issues/1878 を確認

Issue #1878（作者: Alex / ag-linden）の対応。Open question（in-process キュー vs store側 compare-and-set）は、相談の結果 **in-process キュー** で実装する方針に決定。

## 問題

`packages/chat-service/src/relay.ts` の中継フローは「`store.getChatState` で state を読む → 無ければ `resetChatState` で新しい `sessionId` を生成・保存 → `handleCommand` → `startChat` → `collectAgentReply` → `setChatState`」という流れ。

同一外部チャットの「最初のメッセージ」が**同時に2通**到着すると、両方が `getChatState` で `null` を観測し、それぞれ `resetChatState` で**別々の `sessionId`** を生成して独立に走る。結果、1つの外部会話が複数の内部セッションに分裂する。`startChat` の busy ガードは生成済み `sessionId` 単位で効くため、別々の id を持つ2つはどちらもすり抜ける。

## 方針（in-process 直列化）

`(transportId, externalChatId)` 単位で中継ターン全体を直列化する。既存の `push-queue.ts`（in-memory・DI-free・単一サーバープロセス前提）の設計に揃える。store 側 CAS はファイルロック無しでは完全には防げず、現状の単一プロセスモデルにはオーバースペックなため採用しない。

- **`src/keyed-serializer.ts`（新規）**: per-key の promise-chain 直列化プリミティブ `createKeyedSerializer()`。同一キーのタスクは呼び出し順に1つずつ実行、異なるキーは並行。tail が settle したらキーのエントリを掃除して Map の無限成長を防ぐ。再利用可能・テスト可能な純粋プリミティブとして切り出し。
- **`src/relay.ts`**: `createRelay` で serializer を生成し、`relayMessage` は `(transportId, externalChatId)` をキーに本体 `processRelayMessage(deps, params)`（既存ロジックを抽出）をラップして直列実行する。キーは `JSON.stringify([transportId, externalChatId])` で曖昧さ無く合成。

## 変更ファイル

- `packages/chat-service/src/keyed-serializer.ts` … 新規（直列化プリミティブ）
- `packages/chat-service/src/relay.ts` … serializer でラップ + 本体を `processRelayMessage` に抽出
- `packages/chat-service/test/test_keyed_serializer.ts` … 新規（プリミティブ単体テスト）
- `packages/chat-service/test/test_relay_serialization.ts` … 新規（レース回帰テスト）

## テスト

- **serializer 単体**: 同一キーは直列・呼び出し順、異なるキーは並行、所要時間が違っても FIFO 維持、rejected タスクが後続を止めない、戻り値の伝播。
- **relay 回帰**: 非同期 I/O を 1ms 遅延でモックした store に対し、同一 `(transportId, externalChatId)` へ最初のメッセージを2通同時投入 → `resetChatState` がちょうど1回・両ターンが同じ `sessionId` を再利用することを検証。異なる外部チャットは並行に走り各自セッションを持つことも確認（直列化が必要以上にブロックしないこと）。
- chat-service の既存テスト含め全 93 件 pass。`lint` / `typecheck` / `build` も pass。

## 設計メモ

- in-process・単一プロセス前提。マルチプロセス化する際は `push-queue.ts` 同様に durable 実装へ差し替える前提（同インターフェース）。
- `@package-contract`: 直列化プリミティブは host 非依存・DI-free を維持。
