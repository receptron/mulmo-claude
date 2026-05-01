# ファイル変更通知 (per-file pub/sub) — 実装プラン

## 背景

`presentHtml` (#982) で「ファイル on-disk が単一の真実の源、`tool_use.data` には `filePath` だけ載せる」路線に切り替えた結果、保存後の UI 更新を「親 ToolResult を emit し直す」フローに頼れない場面が出てきた:

- presentHtml: そもそも `data.html` が無いので emit するものが存在しない。`feat/presenthtml-edit` で追加した Edit パネルは「Apply 後にローカルで `previewVersion` を bump して iframe を `?v=N` で reload」というパッチを当てているが、**自タブの中だけ**の反映で、別タブ・別ブラウザは置き去り
- markdown: `apiPut` 後に `emit("updateResult", ...)` で親に通知しているが、**別タブ/別ブラウザは置き去り**
- 同じファイルを表示する他の View(将来の wiki / spreadsheet など)も同期しない

ファイルの変更そのものを「サーバが publish、クライアントが subscribe」する単純な pub/sub にすれば、保存後の UI 更新も multi-tab/multi-browser 同期も同じ仕組みで解決する。プロジェクトの哲学(`workspace is the database; files are the source of truth`)とも素直に揃う。

## スコープ

**含む**

- 汎用ヘルパ: サーバの `publishFileChange(relPath)` / クライアントの `useFileChange(relPath)`
- presentHtml の `View.vue` 反映(iframe を `?v=<mtime>` でキャッシュバスト・リロード)
- markdown の `View.vue` 反映(コンテンツ再フェッチ、ローカル編集中は安全に skip / 通知)

**含まない**

- wiki / spreadsheet / files explorer などの他 View(後続 PR)
- `fs.watch` ベースの外部編集検知(明示 publish のみ)
- ファイル削除 / リネーム通知

## 全体構成

既存の Socket.IO pub/sub をそのまま使う:

- `server/events/pub-sub/index.ts` — `IPubSub.publish(channel, data)` / `socket.join(channel)` で room ベース
- `src/composables/usePubSub.ts` — `subscribe(channel, cb): () => void`(再接続時に listener 自動再 subscribe)
- `src/config/pubsubChannels.ts` — チャンネル名の単一情報源(既存)。ここに `fileChannel(relPath)` ファクトリと `FileChannelPayload` 型を足す

**チャンネル命名**: `file:<workspace-relative-posix-path>`

例: `file:artifacts/html/2026/04/foo.html`、`file:data/documents/2026/04/bar.md`

**ペイロード**:

```ts
interface FileChannelPayload {
  path: string;     // workspace-relative POSIX(チャンネル名末尾と一致)
  mtimeMs: number;  // 書き込み直後の stat().mtimeMs(キャッシュバスト + 順序保証)
}
```

## サーバ変更

### 1. ヘルパ追加: `server/events/file-change.ts`

`session-store` と同じ「モジュール singleton + init」パターン。

```ts
let pubsub: IPubSub | null = null;
export function initFileChangePublisher(instance: IPubSub): void { pubsub = instance; }

export async function publishFileChange(relativePath: string): Promise<void> {
  if (!pubsub) return;
  const absPath = path.join(workspacePath, relativePath);
  let mtimeMs: number;
  try {
    ({ mtimeMs } = await stat(absPath));
  } catch {
    mtimeMs = Date.now(); // 書き込み直後に削除されたなど稀なレース
  }
  pubsub.publish(fileChannel(relativePath), { path: relativePath, mtimeMs });
}
```

mtime は呼び出し側で計測せず、helper 内で `fs.stat` する設計。書き込み直後の正確な値が取れるし、呼び出し側は relativePath だけ知っていればよい。`server/index.ts` の `initSessionStore(pubsub)` の隣で `initFileChangePublisher(pubsub)` を呼ぶ。

### 2. publish 呼び出し点

| ルート | 変更 |
|---|---|
| `server/api/routes/presentHtml.ts` POST `/api/html/present` | `writeWorkspaceText` の後で `void publishFileChange(filePath)`(LLM が新規生成したとき) |
| `server/api/routes/presentHtml.ts` PUT `/api/htmls/update` | `overwriteHtml` の後で `void publishFileChange(relativePath)`(Edit パネルからの保存) |
| `server/api/routes/plugins.ts` PUT `/api/markdowns/update` | `overwriteMarkdown` の後で `void publishFileChange(relativePath)`(markdown Edit パネル + チェックボックス・トグル) |

`void` で fire-and-forget — publish 失敗(ws 接続エラーなど)で 200 レスポンスを遅らせない。後続 PR で wiki / spreadsheet の write 経路もここに揃える。

将来の汎用化は `writeFileAtomic` から publish する手もあるが、絶対パス → workspace 相対への逆引きが必要なので今回は触らない。

## クライアント変更

### 1. composable: `src/composables/useFileChange.ts`

```ts
import { ref, onUnmounted, type Ref } from "vue";
import { usePubSub } from "./usePubSub";

export interface FileChangeEvent {
  path: string;
  mtimeMs: number;
}

export function useFileChange(filePath: Ref<string | null>): { version: Ref<number> } {
  const version = ref(0);
  const { subscribe } = usePubSub();
  let unsub: (() => void) | null = null;

  function rebind(p: string | null): void {
    unsub?.();
    unsub = null;
    if (!p) return;
    unsub = subscribe(`file:${p}`, (data) => {
      const ev = data as FileChangeEvent;
      if (ev?.mtimeMs && ev.mtimeMs > version.value) version.value = ev.mtimeMs;
    });
  }

  // filePath が null → string へ変わるケース(ToolResult 切り替え)を考慮
  watch(filePath, rebind, { immediate: true });
  onUnmounted(() => unsub?.());
  return { version };
}
```

### 2. presentHtml `View.vue`

- 既存の同タブ専用 `previewVersion = ref(0)` + `applyHtml` 内の `previewVersion.value += 1` を削除し、composable の `version` で置き換える
- iframe の `:src` を `previewUrl + (version > 0 ? "?v=${version}" : "")` に(同じ式)
- `applyHtml` 成功後はローカル `sourceCache` をユーザが今書いたテキストで上書きしておく(自タブにイベントが戻ってきても **自分の write は再フェッチ不要**)
- 別タブからの write 時の挙動: `watch(previewVersion)` で `sourceCache[filePath]` を invalidate。エディタが開いている AND 未保存の差分が無い → fetchSource() で `editableHtml` を更新。差分がある → `editableHtml` は触らず `cachedSource` だけ更新(Apply で上書き保存できる状態を保つ)
  - 重要: invalidation の前に `wasDirty = hasChanges.value` をスナップショットしておく(`hasChanges` は `cachedSource` に依存するので、invalidation 後は false に振れてしまう)

### 3. markdown `View.vue`

- `watchedPath = computed(() => isFilePath(raw) ? raw : null)` で inline content には subscribe しない
- `watch(fileVersion, ...)` で:
  - `hasChanges` が `false` → `fetchMarkdownContent()` 静かに再実行
  - `hasChanges` が `true` → 再フェッチせず、ローカル編集を保護(後続 PR で "remote changed" バナーを足す)
- 自分の `apiPut` 直後にもイベントは届く(順序: PUT 完了 → publish → 自分が subscribe している channel に到達)。`hasChanges = false` 状態なので静かに再フェッチが走り、結果は同一 → 副作用なし

### 4. 廃止候補(本 PR 範囲外)

- markdown View の `emit("updateResult", ...)`: pub/sub 経由で View 自身が更新されるため大半は不要だが、`pdfPath: undefined` のクリア(content が変わったら PDF も無効化)に使われており、これは pub/sub では伝わらない。剥がすなら別の方法で表現する必要があるので、今回は残す
- "remote changed" バナー UX: i18n キー追加(8 ロケール × 2 キー × 2 plugin)が必要なので、UX 微調整含めて follow-up で扱う

## マルチタブ動作

- タブ A が `apiPut` → サーバが `file:<path>` に publish → タブ A・B 両方の subscribe が発火
- タブ A: 直前の save と同じ内容、`hasChanges = false` → 静かに refetch、no-op
- タブ B: subscribe 中なら version bump → markdown は refetch、html は iframe `?v=` で reload

ブラウザを跨いでも同じ(同一 workspace = 同一 Express → 同一 Socket.IO ルーム)。

## テスト

### 自動

- `test/config/test_pubsubChannels.ts` 拡張: `fileChannel(path)` の prefix / POSIX 正規化 / バックスラッシュ → スラッシュ / 連続セパレータ畳み込みを確認(publisher と subscriber が同じ正規化を経由するので、ここを厳しくしておけばチャンネル名のドリフトが起きない)
- composable / route の単体テストは見送り — pub/sub 自体が socket-level の I/O で、契約を unit で固める価値が低い。Playwright で multi-tab を回す follow-up で代替

### 手動

1. presentHtml で生成したスライドを開く(タブ A)
2. 同じセッションを別タブ(タブ B)で開いて同じ result を表示
3. タブ A の Edit パネルで HTML を編集 → Apply
   - タブ A: iframe が即 reload
   - タブ B: iframe が自動で reload
4. タブ A で agent に「タイトルを変えて再生成」 → 両タブの iframe が更新されること
5. markdown:
   - 同じく 2 タブ
   - タブ A の Edit パネルで本文を編集 → Apply → タブ B のレンダリング更新
   - タブ B でローカル編集中(`hasChanges = true`)にタブ A から PUT が来ても、タブ B の編集内容が破壊されないこと
6. 別ブラウザ(Chrome ↔ Safari)を 2 つ開いて同じシナリオ — Socket.IO ルームは origin 単位で broadcast するので動くはず

## 関連

- PR #982: presentHtml filePath-only(本変更の動機)
- PR #991: Safari CSP fix(別件、先行 merge 想定)
- 既存 pub/sub: `server/events/pub-sub/`、`src/composables/usePubSub.ts`、`src/config/pubsubChannels.ts`、`server/events/session-store/index.ts`(同パターン参考)
