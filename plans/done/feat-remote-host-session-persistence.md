# feat: RemoteHost Firebase セッションのブラウザ永続化 — Phase 1 (@mulmoclaude/core)

tracking: receptron/mulmoserver#50（決定=案A' ブラウザ localStorage 保存）

## 背景

`@mulmoclaude/core/remote-host/server` の `createRemoteHostFirebase` は `getAuth`
（in-memory persistence）を使うため、**ホスト（mulmoterminal / mulmoclaude）サーバー
再起動でセッションが消え、再 Google サインインが必要**。案A' では、サーバーが得た
Firebase セッション（refresh token 含む blob）を**ブラウザ localStorage に保存**し、
再接続時に送り返して復元する（popup 不要）。terminal/サーバーのディスクに秘密を置かない。

Phase 1 は core の土台のみ。**追加的（非破壊）** に実装し、既存 API は維持。
consumer 配線（mulmoterminal / mulmoclaude 自身）は Phase 2/3。

## 難所（Issue より）

1. **auth 初期化は app ごとに1回・persistence を init 時に1回だけ読む。** blob は boot 後に
   届くので、init を lazy 化し、seed 済み persistence で init する。再 open のたびに
   **fresh な Firebase app**（unique name）を作り、前 app は `deleteApp`。
2. **refresh token は routine では回転しない**（sign-out / 失効時のみ変わる）。よって
   ブラウザ同期は「毎 refresh」ではなく **稀イベント時のみ**でよい。`onChange` は
   persistence の `_set/_remove` 発火（＝トークン更新で blob が変わった時）に呼ぶ。
3. **serialized user JSON を手でパースしない。** SDK の `Persistence`（`_get/_set/_remove`）
   にそのまま載せ、blob は「SDK が書いた内容を不透明に持ち回る」（Map 全体を JSON 化）。

## 実装（Phase 1）

### 新規 `sessionPersistence.ts`
- `createHostSessionPersistence()` → `{ persistence, seed(blob), exportBlob(), onChange(cb), clear() }`
- 内部 `Map<string, PersistenceValue>` が Firebase の internal persistence を実装
  （`type:'LOCAL'` / `_isAvailable→true` / `_get/_set/_remove` / `_addListener/_removeListener`
  は Node では no-op）。`_set/_remove` で `onChange` を発火（payload = `exportBlob()`）。
- `seed(blob)`: JSON.parse → Map に投入（`initializeAuth` の**前**に呼ぶ）。
- `exportBlob()`: 空なら null、そうでなければ `JSON.stringify(Object.fromEntries(map))`。
- **フル単体テスト可能**（Firebase 不要）。

### `firebase.ts` に追加（既存 `createRemoteHostFirebase` は維持）
- `createRemoteHostSession(config)` → controller:
  - `open(seedBlob?): Promise<{ auth, firestore, storage, uid: string|null }>`
    前 app を `close()` → `initializeApp(config, uniqueName)` → 必要なら `persistence.seed`
    → `initializeAuth(app, { persistence })` → `auth.authStateReady()` → firestore/storage/uid。
  - `close(): Promise<void>` → `deleteApp` + persistence.clear。
  - `exportSession(): string | null` → persistence.exportBlob()
  - `onSessionChange(cb): () => void` → persistence.onChange(cb)
  - unique name は単調カウンタ（`remote-host-<n>`、乱数不要）。

### `lifecycle.ts` に追加（非破壊）
- `RemoteHostDeps.restore?: (sessionBlob: string) => Promise<string>`（blob→uid）
- `RemoteHostLifecycle.reconnect(sessionBlob): Promise<RemoteHostStatus>`
  connect と同じく **非破壊 + serialized**（restore 成功後に旧 runner を止めて再開始；
  失敗時は既存セッション維持）。`restore` 未注入なら明示エラー。

### `index.ts` に export 追加
- `createRemoteHostSession` / 型、`createHostSessionPersistence` / 型。

## テスト
- `test/remote-host/test_sessionPersistence.ts`（新規）:
  seed→export round-trip / onChange 発火（set/remove）/ 空は null / listener 解除 / clear。
- `test/remote-host/test_lifecycle.ts` を拡張: reconnect が restore→runner 開始、
  restore 失敗時は非破壊、serialized、restore 未注入時エラー。

## 既知の制約（案A' の宿命・ドキュメント化）
- ブラウザが1つも開いていない状態で再起動 → blob を渡す相手がいない → ブラウザが開くまで
  再接続不可（`npx` 起動時にブラウザが開くので通常問題なし）。ディスク無停止が要るなら案A。
