# feat: Reference directories in file explorer (#472)

## Problem

Settings で設定した reference directories がファイルエクスプローラーから閲覧できない。

## Design: `@ref/<label>/path` prefix scheme

既存の `/api/files/dir`, `/content`, `/raw` エンドポイントを流用。
`@ref/` プレフィックスを検出したら reference dir の hostPath 配下で解決。
クライアント側は同じ `loadDirChildren` / `loadContent` が透過的に動く。

### Server changes

1. **`src/config/apiRoutes.ts`**: `files.refRoots` 追加
2. **`server/api/routes/files.ts`**:
   - `resolveRefPath(prefixedPath)` — `@ref/<label>/remainder` を解決
   - `/api/files/dir` — `@ref/` プレフィックス検出時に reference dir 内をリスト
   - `/api/files/content` — 同上でファイル内容を返す
   - `/api/files/raw` — 同上で生ファイルを返す
   - `GET /api/files/ref-roots` — reference dir 一覧を TreeNode[] として返す
   - 書き込みブロック: `@ref/` プレフィックスは全て read-only

### Client changes

3. **`src/components/FilesView.vue`**:
   - マウント時に `/api/files/ref-roots` をフェッチ
   - ツリーペインにワークスペースツリーの後に reference dir ツリーを表示
4. **`src/components/FileTree.vue`**:
   - `@ref/` パスのノードに read-only バッジ表示

### Security

- `resolveWithinRoot(realpathOfRefDir, remainder)` で traversal 防止
- `isSensitivePath()` フィルタ適用
- `getCachedReferenceDirs()` に登録されたパスのみアクセス可
- label injection: label はルックアップキーとしてのみ使用（fs パスに直接使わない）

### Tests

- `resolveRefPath` の正常系 / 不正 label / traversal / sensitive file
- E2E: reference dir ツリー表示（モック API）
