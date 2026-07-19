# Firestore collection backend — collection 単位のバックエンド選択

**Status**: 計画
**Issue**: #2196 (tracking: #2197)
**Last updated**: 2026-07-20

JSON collection は JSON のまま一切変更せず、records が Firestore に載る
collection を **collection 単位で排他的に**選べるようにする。ミラーリング・
双方向同期・二重書き込みはしない。狙いは `onSnapshot` によるライブ同期で、
複数デバイスから同じ collection を触っても即座に反映される状態。

```
collection A (既存) ──> local JSON     変更なし
collection B (既存) ──> sqlite         変更なし
collection C (新規) ──> Firestore      onSnapshot でライブ同期
```

## 前提が整った経緯

当初 (#2196 起票時) は「エージェント経路が唯一の本質的ブロッカー」だった。
main の storage virtualization (#2203/#2204) と #2200 でその前提が変わった:

- `CollectionStore` に `write?` / `delete?` が入り、writer は全て `storeFor`
  経由になった (#2195 完了)
- `manageCollection` に `deleteItems` が入り、生ファイル unlink に頼らない
  削除手段ができた (#2194 完了)
- **sqlite backend が「非ファイルバックエンドを足す実例」になった** — 本計画は
  その型をなぞる

## 型 — sqlite backend が示した追加手順

新バックエンド1つにつき、触る場所は5つ:

| 場所 | sqlite の場合 | Firestore で必要なこと |
| --- | --- | --- |
| `core/schema.ts` `CollectionStorageKind` | `"sqlite"` を追加 | `"firestore"` を追加 |
| `core/schemaZ.ts` `StorageZ` | `type: z.literal("sqlite")` | **判別共用体に変える**（下記） |
| `server/discovery.ts` | `storage.path` をワークスペースパスとして解決＋封じ込め | **ファイルパスではないので分岐が要る**（下記） |
| `server/store.ts` `storeFactories` | `["sqlite", sqliteStoreFor]` | `["firestore", firestoreStoreFor]` |
| `test_storeContract.ts` | 4本目の fixture | 5本目の fixture（フェイク注入） |

加えて watcher（`fs.watch` ではなく `onSnapshot`）と docs/helps。

## 設計上の判断

### 1. Firestore ハンドルは host が注入する（依存方向）

`storeFactories` は **core** にある（`store.ts` のコメント: "Factories live in
CORE (dependency-direction rule — never plugin-registered)"）。一方 Firestore の
認証済みハンドルを持っているのは **host** (`server/remoteHost/session.ts`)。
core は `server/` を import できない。

したがって `CollectionHost` (`collection/server/host.ts`) に optional な
アクセサを足し、host が `configureCollectionHost` で注入する:

```ts
export interface CollectionHost {
  // ...既存
  /** 認証済み Firestore ハンドルと、その uid。remote-host 未接続なら null。
   *  firestore backend 以外は一切参照しない。 */
  firestore?: () => { db: Firestore; uid: string } | null;
}
```

**テストはここにフェイクを注入する。**（テスト戦略の決定事項 — 下記）

`firebase` は core の **optional peerDependency** に既に入っているので依存追加はない。

### 2. 未接続時は「構築時に throw」ではなく「メソッドが明確に失敗」

`storeFor(collection)` は同期で、`ontology` / `validate` / routes など至る所から
呼ばれる。ここで throw すると Firestore collection が1つ存在するだけで無関係な
画面が壊れる。

**sqlite の先例をなぞる**: `sqliteStore.ts` は `node:sqlite` を
メソッド内で lazy load し、Node < 22.5 では *メソッドが* 明確なエラーで reject
する（`sqliteStore.ts:57-64`）。Firestore も同じ形にする:

- `firestoreStoreFor()` は同期でストアを返す（接続確認しない）
- 各メソッドが `host.firestore?.()` を呼び、null なら
  「remote-host に接続してください」という**行動につながるエラー**で reject
- **黙って空配列を返してはいけない** — データが無いのか未接続なのか区別が
  つかなくなる（#2196 のコメントで確定済み）

`ontology.ts` / `validate.ts` は既に store の失敗を fail-soft で受けるので、
未接続でも一覧は壊れない。

### 3. `StorageZ` を判別共用体にする

現状は単一形状:

```ts
export const StorageZ = z.object({ type: z.literal("sqlite"), path: z.string().min(1) });
```

sqlite の `path` は**ワークスペース相対のファイルパス**で、`discovery.ts:87` が
`resolveDataDir` で封じ込めチェックする。Firestore に `path` は無く、あるのは
Firestore 上のコレクション位置だけ。混ぜると型が嘘になるので分ける:

```ts
export const StorageZ = z.discriminatedUnion("type", [
  z.object({ type: z.literal("sqlite"), path: z.string().min(1) }),
  z.object({ type: z.literal("firestore") }),   // 位置は uid + slug から導出
]);
```

**Firestore 側にユーザー指定のパスを持たせない**のが要点。ドキュメント位置は
`users/{uid}/collections/{slug}/items/{id}` と host が決める。理由は2つ:

- **セキュリティルールを変えずに済む** — デプロイ済みルールが
  `users/{uid}/{document=**}` の再帰ワイルドカード。この配下にいる限りルール変更も
  デプロイも不要。ルール本体は別リポジトリ (`../mulmoserver`) にあり、ここからは
  変更できない
- 任意パスを許すと、ルールの効かない場所を指せてしまう

`discovery.ts` は `schema.storage.type === "sqlite"` のときだけ `storageFile` を
解決するよう分岐する（Firestore は解決すべきファイルが無い）。

### 4. onSnapshot は既存のイベント契約に載せる

`publishCollectionChange({ slug, ids, op })` はパスもレコード本体も含まない
**バックエンド非依存**の再取得 ping。ブラウザ側には Firestore が一切無く
(`src/` は `firebase/app` と `firebase/auth` のみ)、Firestore は全てサーバ経由。
したがって**ブラウザから直接 onSnapshot はしない**:

```
Firestore → (サーバ側 onSnapshot) → publishCollectionChange({slug, ids, op})
          → 既存 WebSocket collection:${slug} → UI は今まで通り再取得
```

**UI コードは無変更。** watcher (`collection-watchers/watcher.ts`) に
file / dataSource / storage に続く第4の分岐として登録する。

流用元: `remote-host/server/hostRunner.ts:154-184` に**本番稼働中の onSnapshot
実装**がある。特に持ち帰るべき知見:

- `snapshot.docChanges()` で差分だけ処理（全件スキャンしない）
- **`orderBy` の罠** — `orderBy("createdAt")` は当該フィールドを持たない
  ドキュメントを**黙って除外する**。`hostRunner.ts:158-169` はこれを避けるため
  意図的にメモリ内ソートしている
- **onSnapshot のエラーは復帰不能** — リスナーが死んだら死んだまま。
  `hostRunner.ts:174-183` は `onClosed` を呼んで諦める設計。再接続/バックオフは
  コードベースに存在しない（本計画のリスク項参照）

### 5. 未決だったもの → 確定

- **remote-host 接続への依存は受け入れる**（#2196 コメントで確定）。Firestore
  collection は remote-host 接続中のみ読み書き可能。認証セッションを分離する
  作業はしない
- **エージェント指示** — #2200 で `deleteItems` が入り、生ファイル I/O に頼らない
  CRUD が全て揃った。Firestore collection には触るべきファイルが無いので、
  ヘルプに「storage backend の collection は `manageCollection` 経由のみ」と
  明記する。**JSON collection の記述は変えない**（生ファイル I/O は引き続き
  サポートされた escape hatch）

## 段階

### Stage 1 — スキーマと配線（バックエンドはまだ無い）

1. `core/schema.ts`: `CollectionStorageKind` に `"firestore"` を追加
2. `core/schemaZ.ts`: `StorageZ` を判別共用体化。既存の sqlite スキーマが
   そのまま通ることをテストで固定（後方互換の回帰）
3. `server/discovery.ts`: `storageFile` の解決を `type === "sqlite"` に限定
4. `server/host.ts`: `CollectionHost` に optional `firestore` アクセサ

この時点で `storeFor` は firestore kind に factory が無く throw する。
Stage 2 まで `StorageZ` の firestore バリアントは**スキーマ検証で拒否**しておく
（中途半端に受理して壊れるより明確に落とす）。

### Stage 2 — ストア実装

5. `server/firestoreStore.ts` — `CollectionStore` を実装:
   - `list()` / `page()` — `ORDER BY` は**ドキュメント ID 昇順**（契約の
     STABLE ORDER 要件。`orderBy` の罠を避けるためフィールドでは並べない）
   - `read(id)` / `write(id, item, opts)` / `delete(id)`
   - `write` の `refuseOverwrite` は Firestore トランザクションで
     存在チェック＋作成（`hostRunner.ts:64-72` の CAS が参考）
   - `capabilities`: `{ writable: true, nativeQuery: false, nativePaging: true }`
   - `query` は**実装しない**。DuckDB の集約に相当するものが無く、
     呼び出し側は `query` の不在を既に処理できる（`store.ts:33-36`）ので
     エンジン側フォールバック (`runCollectionQuery`) が働く
   - publish は**この実装の責務**（ストアが slug を通す契約。#2195 参照）
6. `server/store.ts`: `storeFactories` に登録

### Stage 3 — ライブ同期

7. `collection-watchers/watcher.ts`: firestore collection に `onSnapshot` を
   張る第4分岐。`docChanges()` → `publishCollectionChange`
8. リスナーのライフサイクル（`stopCollectionWatchers` での unsubscribe、
   エラー時の扱い）

### Stage 4 — テスト

9. **Firestore フェイクを注入して契約テストに5本目の fixture を足す**
   （テスト戦略の決定。下記）
10. `StorageZ` 判別共用体の回帰テスト（sqlite 既存スキーマが通る／
    firestore バリアントが Stage 1 では拒否され Stage 2 で通る）
11. 未接続時に**明確なエラーになる**（空配列を返さない）ことのテスト

### Stage 5 — ドキュメント

12. `assets/helps/collection-skills.md` — storage backend のセクションに
    firestore を追加。「storage backend は `manageCollection` 経由のみ」を明記
13. `assets/helps/error-recovery.md` — 未接続時のエラーからの復帰手順
    （CLAUDE.md の規則: 実行時に踏みうる失敗モードは必ずここに書く）
14. `docs/collections-data-operations.md` — バックエンド表を更新
15. `@mulmoclaude/core` の bump（`assets/helps/*` が変わるため）

## テスト戦略（決定済み）

**Firestore フェイクを `CollectionHost.firestore` 経由で注入する。**

- 契約テスト (`test_storeContract.ts`) に5本目の fixture を追加し、
  **CI で常時 green** にする（sqlite と同じ扱いに揃う）
- Firebase emulator は採らない: CI に Java ランタイムが増え、3プラットフォーム
  matrix (ubuntu/windows/macos) 全てで動かす必要があり、ルールは別リポジトリ
  管理との二重管理になる

**この選択の限界を明記しておく**（レビュー時に見えるように）:

- フェイクの忠実度が上限。特に `onSnapshot` / `docChanges` の挙動は自前再現で、
  本物との乖離はテストでは捕まらない
- したがって **Stage 3 のライブ同期は手動検証が要る**。`docs/manual-testing.md`
  に手順を追加する

## リスクと既知の落とし穴

| リスク | 対処 |
| --- | --- |
| **onSnapshot のエラーは復帰不能** — リスナーが死ぬと無音で古いまま | 最低限、死亡を検知してログ＋UI に伝える。再接続/バックオフはコードベースに前例が無いので、本計画では**やらない**（別 issue）。無音で壊れるのが最悪なので、死亡の可視化は必須 |
| `orderBy` がフィールド欠落ドキュメントを黙って除外 | ドキュメント ID 昇順のみ使う。フィールドで並べない |
| 1ドキュメント約 1MiB 上限 | 超過時は明確なエラー。前例: 添付は Storage に逃がす (`onExpire.ts:45`) |
| `ontology` の件数取得が毎回ネットワーク往復 | `page({limit:0}).total` が Firestore では count クエリになる。`ontology.ts` は既に fail-soft だが、**コスト特性が local backend と違う**ことを docs に明記 |
| データが共有プロジェクト `mulmoserver` に載る | `users/{uid}/` 配下限定で他ユーザーから不可視。ルール変更不要 |
| 未接続時に無関係な画面が壊れる | ストア構築では throw せず、メソッドが失敗する形にする（設計判断 2） |

## やらないこと（スコープ外）

- **JSON / sqlite collection への変更** — 一切触らない
- ミラーリング / 双方向同期 / 二重書き込み
- ブラウザから直接 Firestore を購読する経路
- onSnapshot の自動再接続・バックオフ（別 issue）
- オフライン永続化 (`enableIndexedDbPersistence`)
- Firestore collection の `deleteCollection` アーカイブ — sqlite は `.db` を
  アーカイブできるが Firestore は export が要る。**Stage 1 で明確に拒否**し、
  別途対応する（黙って records を残すのが最悪）
