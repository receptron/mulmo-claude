# #895 PR A: shared frontmatter parser (Vue side)

Issue: https://github.com/receptron/mulmoclaude/issues/895

## ゴール

server 側 (PR B) が `writeWikiPage` で `created`/`updated` を auto-inject し始める前に、Vue 側で frontmatter を robust に扱えるようにする。

PR A 単独でも価値あり: 4 つの hand-rolled parser を共通化し、`---` を含む md を render してた component (markdown plugin / manageSkills) の表示バグを解消。

## 含めるもの (副作用評価済)

### 新規 util

- `src/utils/markdown/frontmatter.ts`:
  - `parseFrontmatter(raw): { meta: Record<string, unknown>; body: string; hasHeader: boolean }`
  - `serializeWithFrontmatter(meta, body): string`
  - `mergeFrontmatter(existing, patch): Record<string, unknown>` — 未知キー保持、既知キー上書き
- 内部実装は `js-yaml` (browser/Node 両対応、YAML 仕様準拠)

### 新規 composable

- `src/composables/useMarkdownDoc.ts`:
  - 入力: `Ref<string>` (raw content)
  - 出力: `{ meta, body, hasHeader, fields }` — `fields` は `[{ key, value }]` 配列で properties panel render 用 (insertion order)

### 移行 (既に strip 済 → 新 util へ統一)

- `src/plugins/wiki/View.vue:416` — `extractFrontmatter` → `parseFrontmatter`
- `src/components/FileContentRenderer.vue` — `useContentDisplay` 経由で `extractFrontmatter` 使用 → 新 composable

### 新規 stripping 追加 (バグ fix or 副作用なし)

- `src/plugins/markdown/View.vue:151` — 🔴 raw render を strip + properties panel 化
- `src/plugins/manageSkills/View.vue:185` — 🟡 skill body に frontmatter (description/schedule/roleId) が漏れていた既存バグ fix
- `src/plugins/textResponse/View.vue` + `Preview.vue` — 🟡 chat content は通常 frontmatter 無し → strip は no-op、ただし将来 LLM が `---` で囲んだ何かを送ってきた時に robust

### 旧 util の扱い

- `src/utils/format/frontmatter.ts` の `extractFrontmatter` は新 util に置き換え後、export を残してもファイル削除どちらでも可
- 既存 test (`test/composables/test_useContentDisplay.ts`) は新 composable に書き換え

## 含めないもの (PR C へ繰越)

### Vue render site

- `src/components/NewsView.vue` — news item body の content shape が不明 (RSS 由来、`---` 含む可能性は低いが副作用ゼロ証明できない)
- `src/components/SourcesManager.vue` — `briefMarkdown` (集計の daily brief)、構造化 markdown で frontmatter 通常無いが要検証

### Server side

- `server/utils/markdown/frontmatter.ts` (server mirror) — **PR B**
- `writeWikiPage` の `created`/`updated` auto-inject — **PR B**
- 既存 hand-rolled parser (sources / skills / wiki tags) の migration — **PR C**

## 設計判断

### `js-yaml` 単体使用 (gray-matter 不採用)

- gray-matter は CJS / Node-specific (Buffer 依存) で browser ビルドが面倒
- js-yaml は browser/Node 両対応、API 直接で十分シンプル
- shared package 化はしない: 各側 5-10 行の薄い wrapper、コードコピーで保守容易

### `meta` の型は `Record<string, unknown>`

- YAML は scalar / array / object / null と多型
- 型 narrowing は呼び出し側で type guard or zod で

### `fields` (Vue 用 ordered array) の生成は composable で

- `Object.entries(meta)` は ES2020+ で insertion order 保証
- `js-yaml.load` も insertion order 保持
- 配列値は `Array.isArray` で判定して `value.join(", ")` 表示

## テスト

新規ユニットテスト `test/utils/markdown/test_frontmatter.ts`:

- `parseFrontmatter` happy path: header + body
- `parseFrontmatter` empty header
- `parseFrontmatter` no header (returns `hasHeader: false`, `meta: {}`)
- `parseFrontmatter` header-only (no body)
- `parseFrontmatter` malformed YAML (graceful: return as no-header)
- `parseFrontmatter` `\r\n` line endings (Windows)
- `parseFrontmatter` array values: inline `[a, b]` and block `- a\n- b`
- `serializeWithFrontmatter` round-trip
- `serializeWithFrontmatter` empty meta → no `---` block
- `mergeFrontmatter` overwrites known keys
- `mergeFrontmatter` preserves unknown keys
- `mergeFrontmatter` `null`/`undefined` patch values: skip vs delete (TBD)

新規 composable テスト `test/composables/test_useMarkdownDoc.ts`:

- header あり → meta + body 分離
- header なし → meta = {}, body = raw
- reactivity: input ref 変更 → re-parse

## 完了条件

- [ ] `js-yaml` を root deps に追加
- [ ] 新 util + composable + テスト
- [ ] 5 component 移行 (wiki/View, FileContentRenderer, markdown/View, manageSkills, textResponse)
- [ ] 既存 e2e に regression なし
- [ ] `yarn typecheck && yarn lint && yarn build && yarn test` clean

## Out of scope (繰越)

- PR B: server 側 mirror + `writeWikiPage` integration
- PR C: NewsView / SourcesManager / 既存 hand-rolled parser 統合
