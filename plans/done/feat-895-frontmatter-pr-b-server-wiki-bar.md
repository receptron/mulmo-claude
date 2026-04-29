# #895 PR B: server frontmatter mirror + writeWikiPage integration + wiki metadata bar

Issue: https://github.com/receptron/mulmoclaude/issues/895

## ゴール

PR A (#902, merged) で Vue 側 frontmatter 共通化と markdown plugin View の properties panel が land 済。PR B では:

1. **server 側に同形 util を追加** (`js-yaml` ベース、PR A の `src/utils/markdown/frontmatter.ts` と shape 揃え)
2. **`writeWikiPage` で `created` / `updated` を auto-inject** (lazy-on-write、bulk migration なし)
3. **`wiki/View.vue` に 1 行 metadata bar 追加** (PR B 議論で追加スコープ — created/updated/editor を視覚化)
4. **tags 統合** (frontmatter `tags` と `index.md` 由来 tags を共通表示)

## 含めるもの

### 新規 server util

- `server/utils/markdown/frontmatter.ts` — Vue 側と同形:
  - `parseFrontmatter(raw): { meta, body, hasHeader }` (FAILSAFE_SCHEMA)
  - `serializeWithFrontmatter(meta, body): string`
  - `mergeFrontmatter(existing, patch): Record<string, unknown>`

### `writeWikiPage` integration

- 既存 `appendSnapshot` no-op stub の手前で frontmatter merge を実行:
  ```ts
  const oldContent = await readTextSafe(absPath);
  const existingMeta = oldContent ? parseFrontmatter(oldContent).meta : {};
  const now = (opts.now ?? (() => new Date()))();
  const merged = mergeFrontmatter(existingMeta, {
    created: existingMeta.created ?? toIsoDate(now),
    updated: now.toISOString(),
    editor: meta.editor,
  });
  const finalContent = serializeWithFrontmatter(merged, parseFrontmatter(content).body);
  await writeFileAtomic(absPath, finalContent, { uniqueTmp: true });
  ```
- `now` injection を opts に追加 (テスト可制)
- caller が body を渡す前提だが、frontmatter を含む raw を渡してきても parse して body を取り出して merge

### wiki/View.vue metadata bar

- 上部に 1 行 bar:
  ```
  Created 2026-04-26 · Updated 2026-04-27 14:32 · Editor: llm
  ```
- frontmatter から取得、無いキーは省略 (まだ frontmatter 持たない既存 wiki page 互換)
- tags: `useMarkdownDoc` の `meta.tags` (frontmatter 由来) と `entry.tags` (index.md 由来) を Set で union、既存の chip 表示位置に統合

### Tests (server)

- `test/utils/markdown/test_frontmatter.ts` (server 版) — Vue 側とほぼ同じ 23 ケース
- `test/workspace/wiki-pages/test_io.ts` 拡張:
  - 既存 frontmatter なしファイル + write → `created`/`updated`/`editor` 付与
  - 既存 frontmatter ありファイル + write → `updated` のみ更新、`created` 維持、unknown キー保持
  - `now` injection で時刻固定
  - body のみ渡しても OK / frontmatter 含む raw でも OK
  - 同一 content の 2 度書き → `updated` は変わるが他は維持 (`appendSnapshot` 条件は変えない、別関心)

### Tests (Vue / e2e)

- `wiki/View.vue` の metadata bar 表示テスト (e2e)
- header なし wiki page → bar 出ない (regression guard)

## 含めないもの (PR C / 後続)

- editor identity の LLM/user 分離 (今は call site 全部 `"user"` placeholder のまま、disambiguation は別 PR)
- 既存 hand-rolled parser 統合 (sources/registry, skills/parser, wiki/frontmatter)
- NewsView / SourcesManager の frontmatter 対応
- `appendSnapshot` 本体実装 (これは #763 PR 2)

## 設計判断

### `created` の意味

- "First time `writeWikiPage` saw this file" — 既存ファイルの birth time は使わない (FS によって信頼できない、cross-platform で不揃い)
- 既存 frontmatter に `created` があれば維持
- 既存 frontmatter になければ、初回 write 時の date を採用 (ISO `YYYY-MM-DD` のみ、時刻なし)

### `updated` の format

- ISO 8601 with time (`2026-04-27T14:32:56.789Z`) — `created` の date-only より細かい解像度
- 同一秒内の 2 書き込みは ms 込みで区別

### `editor` の placeholder 保持

- PR A と同じく `meta.editor` を call site で渡す
- 今は wiki.ts → `"user"`, files.ts → `"user"`, wiki-backlinks → `"system"`
- LLM 経路の `"llm"` への分離は別 PR (frontend / API contract 変更が必要)

### body-only vs raw input の柔軟性

- caller (manageWiki MCP / frontend save / wiki-backlinks) は通常 body のみ渡す
- ただし frontmatter 込みの raw を渡してきても `parseFrontmatter` で body 取り出し、frontmatter は merge 入力として吸収
- これにより既存 manageWiki tool が frontmatter 込みで送ってきても正しく動く

### Vue 側 metadata bar の視覚設計

- 控えめ: gray-500 text-xs、page title 直下、border-b でなく単独行
- 順序: Created → Updated → Editor (時系列 + 識別)
- 値が無い key は表示しない (existing wiki pages without frontmatter で空 bar にならない)

## 完了条件

- [ ] server util + 23 unit cases
- [ ] `writeWikiPage` `created`/`updated` injection + 6 拡張テスト
- [ ] wiki/View.vue metadata bar + tags 統合
- [ ] e2e: frontmatter ある wiki page で bar 表示 / ない wiki page で bar なし
- [ ] 既存 wiki / wiki-backlinks / files PUT テスト全 pass
- [ ] `yarn typecheck && yarn lint && yarn build && yarn test` clean

## Out of scope (繰越)

- PR C: NewsView / SourcesManager / 既存 hand-rolled parser 統合
- editor identity disambiguation (LLM vs user)
- snapshot 機能本体 (#763 PR 2)
