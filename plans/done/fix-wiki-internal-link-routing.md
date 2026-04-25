# fix: Wiki ページ内の内部リンクが /chat にリダイレクトされる

## 問題

Wiki ページ内のマークダウンリンク（`<a>` タグ）でワークスペース内ファイルを指すものをクリックすると、Router の catch-all (`/:pathMatch(.*)*` → `/chat`) にヒットして chat ページにリダイレクトされる。

### 再現手順

1. ソースファイルや出典リンクを含む wiki ページを開く
2. 出典セクションのソースファイルリンク（例: `../sources/<slug>.md`）をクリック
3. → `/chat` にリダイレクトされる（期待: `/files/data/wiki/sources/<slug>.md` で表示）

### 影響するリンクの例

- ソースファイル: `../sources/<slug>.md`
- セッションログ: `../../../conversations/chat/<session-id>.jsonl`

## 原因

Wiki View の `handleContentClick` は以下のみ処理している:

1. `[[Page Name]]` → wiki 内遷移（`navigatePage`）
2. 外部 URL（cross-origin http/https）→ 新タブで開く

**ワークスペース内部リンク（`../sources/...`, `../../../conversations/...`）のハンドラがない。**

textResponse View には `classifyWorkspacePath` + `navigateToWorkspacePath` による同等の処理が実装済み。

## 修正方針

### 変更ファイル

1. **`src/plugins/wiki/View.vue`** — `handleContentClick` にワークスペースパスの処理を追加
2. **`src/utils/path/workspaceLinkRouter.ts`** — 相対パス解決用のヘルパー追加（または View 側で解決）

### 実装詳細

`handleContentClick` のハンドラチェーンを拡張:

```text
wiki リンク → 外部リンク → ワークスペースパス（新規）→ ブラウザデフォルト
```

#### 相対パスの解決

Wiki ページ内のリンクはファイルシステム相対パス（`../sources/...`）で書かれている。
`classifyWorkspacePath` はワークスペースルート相対パスを期待するため、
クリック時に wiki ページの workspace 位置（`data/wiki/pages/`）を基準に解決してから渡す。

例:
- href: `../sources/my-source.md`
- 基準: `data/wiki/pages/<slug>`
- 解決後: `data/wiki/sources/my-source.md`
- 分類結果: `{ kind: "file", path: "data/wiki/sources/my-source.md" }`

### デグレリスク

- **低リスク**: 既存の wiki リンク・外部リンクハンドラには触れない
- 新規処理はチェーンの末尾に追加するだけ
- `classifyWorkspacePath` は純粋関数で実績あり（textResponse で使用中）
- 影響するのは「現在壊れている動作」のみ
