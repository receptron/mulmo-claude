# Slug 化ルールの統一 (#732)

## ゴール

`server/utils/slug.ts` の canonical 実装を全モジュールで使い、独自実装を撤廃する。互換性は捨てる (breaking 許容)。

## 背景

- PR #655 で wiki の path-based URL 化に伴い、canonical slug helper (`hasNonAscii`, `hashSlug`, `isValidSlug`, `slugify`) が `server/utils/slug.ts` に集約された
- しかし `server/workspace/journal/paths.ts` と `server/api/routes/todosColumnsHandlers.ts` は引き続き独自 `slugify` を保持しており、ルールが揃っていない:
  - **Journal**: 非ASCII を全削除して `"topic"` に潰す → 「プロジェクトA」「プロジェクトB」が同じファイル名に衝突
  - **Todo columns**: 区切り文字が `_` (canonical は `-`)
- Issue #732 はこの不整合の解消が目的

## 確定した判断

- **互換性維持なし**。journal の既存データは元々衝突で復元不能のため切り捨て。todo columns の既存 ID はファイルに永続化済なのでそのまま動く (新規列だけ新ルール、混在は許容)
- **migration スクリプトなし**。release notes に1行明記するだけ
- **legacy-read fallback なし**。canonical 一本に揃える

## 変更点

### 1. `server/workspace/journal/paths.ts`

- ローカル `slugify` 関数を削除
- canonical からの import に置換: `import { slugify as slugifyCanonical } from "../../utils/slug.js"`
- 呼び出し側を `slugifyCanonical(raw, "topic")` に統一 (フォールバックは引数で指定)
- `// Convert a free-form topic name into a filesystem-safe slug.` コメントブロックを削除 (canonical 側のドキュメントに集約)

### 2. `server/api/routes/todosColumnsHandlers.ts`

- ローカル `slugify` 関数を削除
- canonical を直接呼び出し: `slugify(label, "column")`
- `uniqueId` の suffix 区切りを `_` から `-` に変更 (`${base}_${suffix}` → `${base}-${suffix}`)
- `DEFAULT_COLUMNS` の `id: "in_progress"` を `id: "in-progress"` に更新
- `hasNonAscii` / `hashSlug` の import を `slugify` の import に置換 (ローカル `slugify` を消すと不要)

### 3. テスト更新

- `test/workspace/test_journal_paths.ts` (もしくは該当する journal slugify テスト) — 非ASCII 入力の期待値を変更:
  - 旧: `"プロジェクトA"` → `"topic"`
  - 新: `"プロジェクトA"` → `<16-char-base64url-hash>`
- `test/api/routes/test_todosColumnsHandlers.ts` (該当するテスト) — column ID の期待値を変更:
  - 旧: `slugify("My Column")` → `"my_column"`
  - 新: `slugify("My Column")` → `"my-column"`
  - DEFAULT_COLUMNS の `in_progress` → `in-progress`
- canonical テスト (`test/utils/test_slug.ts`) は既存のままで OK (canonical の挙動は変えない)

### 4. ドキュメント

- `docs/CHANGELOG.md` に Breaking change 1行追記:
  - `Slug rule unified across journal/todos/wiki — non-ASCII journal topics get hash-based filenames; new todo columns use hyphen separator (existing IDs preserved).`

## 影響を受けないこと

- Wiki / Files / Spreadsheet / Sources / Skills は既に canonical を使っているため変更なし
- 既存の `columns.json` に保存済の column ID (`in_progress` 等) はファイルから読み込まれた値がそのまま使われるため動作継続
- API スキーマ・URL 構造に変更なし

## ロールアウトリスク

- **Journal**: 非ASCII トピック名を持つ既存ユーザーは過去の summary ファイルが orphan 化。ただし summaries は会話ログから再生成される性質のものなので致命的ではない
- **Todo columns**: デフォルトワークスペースの新規作成時のみ `in_progress` → `in-progress` になる。既存ワークスペースは混在状態 (列追加すると新フォーマット) で動く
- 起動時 warning など追加の検知ロジックは入れない (シンプルさ優先)

## 作業手順

1. ✅ Issue #732 にコメントで方針合意
2. ✅ Plan ファイル作成 (この文書)
3. feature ブランチ作成: `feat/slug-unify-732`
4. 変更実装 (上記 1〜4)
5. `yarn format && yarn lint && yarn typecheck && yarn build && yarn test` 全 green を確認
6. PR 作成 (User Prompt セクション含む / Summary + Items to Confirm を最上部)
7. CodeRabbit / Codex のレビュー対応
8. CI 全 green 後マージ → plan を `plans/done/` に移動

## Items to Confirm (実装後レビューで重点確認)

- canonical `slugify` の `maxLength=60` がデフォルトとして妥当か (journal は元々長さ制限なし、todo column も同じ)
- `uniqueId` の `-` 区切り変更で `isValidSlug` を依然満たすか (`my-column-2` は valid)
- 既存テストで `in_progress` 文字列を直接使っているケースが他にないか (e2e含む)
