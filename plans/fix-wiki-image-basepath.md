# Wiki ページの画像参照が 404 になる問題の修正

## 概要

Wiki ページの Markdown 内で workspace 相対の画像参照（例: `![](../sources/foo/bar.png)`）が表示されない。`/api/files/raw` への解決パスが古いレイアウト（`wiki/...`）のままになっており、現行レイアウト（`data/wiki/...`）にファイルが存在するため 404 になる。

## 再現

- ページ: `data/wiki/pages/<slug>.md`
- 参照: `![](../sources/<slug>/slides/foo.png)`
- 実ファイル: `~/mulmoclaude/data/wiki/sources/<slug>/slides/foo.png` ✅
- ブラウザがリクエストする URL: `/api/files/raw?path=wiki/sources/<slug>/slides/foo.png` → **404**

## 原因

[src/plugins/wiki/View.vue:402](../src/plugins/wiki/View.vue#L402) の `basePath` が issue #284（workspace レイアウト変更: `wiki/` → `data/wiki/`）の更新から漏れていた。

```ts
// 現状（バグ）
const basePath = action.value === "page" ? "wiki/pages" : "wiki";
```

同ファイルの [L517](../src/plugins/wiki/View.vue#L517) には正しいプレフィックスを持つ `WIKI_BASE_DIR` がすでに存在する:

```ts
const WIKI_BASE_DIR = computed(() => (action.value === "page" ? "data/wiki/pages" : "data/wiki"));
```

`rewriteMarkdownImageRefs` の `basePath` 引数は `resolveWorkspacePath` で URL の `..` / `./` を解決する基準ディレクトリとして使われ、その結果が `/api/files/raw?path=...` の `path` パラメータになる（[src/utils/image/rewriteMarkdownImageRefs.ts](../src/utils/image/rewriteMarkdownImageRefs.ts)、[src/utils/image/resolve.ts](../src/utils/image/resolve.ts)）。`basePath` が `wiki/pages` だと `..` 解決後に `wiki/sources/...` が出力され、現行レイアウトに対しては必ず 404。

## 修正方針

`renderedContent` で使う `basePath` を `WIKI_BASE_DIR` と同じ値に揃える。L402 と L517 を同じ computed から派生させ、再発を防ぐ。

### 変更内容

[src/plugins/wiki/View.vue](../src/plugins/wiki/View.vue):

1. `WIKI_BASE_DIR` を `renderedContent` より前の位置に移動（または定義順を整える）
2. L402 を `const basePath = WIKI_BASE_DIR.value;` に置き換える
3. 古いコメント（"basePath = wiki/pages for individual pages"）を新しい値に合わせて更新

## テスト

### 手動確認

1. `~/mulmoclaude/data/wiki/pages/<slug>.md` に `![](../sources/foo/bar.png)` を含むページを開く
2. 画像が表示されることを確認
3. DevTools の Network タブで `/api/files/raw?path=data/wiki/sources/foo/bar.png` が 200 で返ることを確認
4. インデックスビュー（`action !== "page"`）で `![](sources/foo/bar.png)` のような相対参照も解決されることを確認

### 自動テスト

`rewriteMarkdownImageRefs` 自体は単体テスト済みのため、`basePath` の値を渡しているだけの View.vue 側はリグレッションを起こしにくい。E2E で wiki ページの画像が `200` を返すことを確認するテストの追加は任意（既存のスナップショット系テストで十分か検討）。

## 影響範囲

- 修正は `src/plugins/wiki/View.vue` の 1 行のみ
- 同ファイル内の他の参照（`WIKI_BASE_DIR`、`Create a wiki page about ... data/wiki/pages/` などの prompt 文字列）はすでに正しい
- サーバー側のルート / 他プラグイン（`markdown/View.vue`、`FilesView.vue`）は今回の修正とは独立

## 備考

- 過去の似た移行漏れに [`plans/fix-legacy-path-migration-773.md`](fix-legacy-path-migration-773.md) があり、issue #284 由来のレガシーパス整理が継続的に発生している。今回も同系統。
