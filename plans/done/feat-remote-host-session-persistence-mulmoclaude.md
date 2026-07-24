# feat: RemoteHost セッションのブラウザ永続化 — mulmoclaude 配線 (Phase 3, #2075)

tracking: receptron/mulmoserver#50（案A'）。Phase 1（#2073, core API）はマージ済み。

## 目的

mulmoclaude サーバー再起動で RemoteHost の Firebase セッションが消える問題を、
Phase 1 の core API（`createRemoteHostSession` / `reconnect`）を使って解消する。
セッション blob をブラウザ localStorage に保存し、再接続時に送り返して復元（popup 不要）。

## 設計

core の `createRemoteHostSession.open()` は (re)connect ごとに fresh app を作るため、
`auth/firestore/storage/uid` が open ごとに変わる。現行 consumer（index/onExpire/ingest）は
固定インスタンスを import していたので、**現在の handles を返す getter** に切替える。

### server
- `session.ts`（新規・handles ホルダ）:
  - `remoteHostSession = createRemoteHostSession(firebaseConfig)`、`handles` を保持。
  - `signIn(idToken)`: `open()` → handles 更新 → `createRemoteHostAuth(handles.auth).signInHost`。
  - `restore(blob)`: `open(blob)` → handles 更新 → uid 無ければ throw（非破壊 reconnect）。
  - `signOut()`: `signOutHost` → `session.close()` → handles=null。
  - `currentUid()` / `currentFirestore()` / `currentStorage()` / `exportSession()` / `onSessionChange`。
- `firebase.ts` / `auth.ts` を削除（session.ts に統合。他 importer は無い）。
- `index.ts`: `createRemoteHost` に session の signIn/restore/signOut/currentUid をバインド、
  `startRunner` は `currentFirestore()` を使用。`connect/reconnect/disconnect/status` と
  `exportSession` を export。
- `onExpire.ts` / `ingestAttachments.ts`: 固定 `storage` → `currentStorage()`。
- route (`remoteHost.ts`): `POST /reconnect { session } → { status, session }` を追加。
  `/connect` `/status` レスポンスに現在の blob（`exportSession()`）を含める。
- `apiRoutes.ts`: `reconnect` を追加。

### front (`RemoteHostControl.vue`)
- レスポンスの `session`（blob）を localStorage（`remoteHost.session`）に保存/削除。
- `onMounted`: refreshStatus → 未接続 かつ localStorage に blob なら `/reconnect` 自動実行。
  失敗（blob 失効）は静かに localStorage を破棄して通常の connect にフォールバック。
- connect 成功で blob 保存、disconnect で削除。

## 既知の制約
- ブラウザ未オープン時の再起動は blob の渡し手がなく、ブラウザが開くまで再接続不可
  （`npx` 起動でブラウザが開くので通常問題なし）。
- blob は refresh token を含む。localStorage は localhost 同一マシン前提で受容（#50 の合意）。

## テスト
- server: 既存 remoteHost テストが green のまま（handlers 系は stub 依存で影響なし）。
- 型/ビルド: `yarn typecheck` / `yarn build` green。
