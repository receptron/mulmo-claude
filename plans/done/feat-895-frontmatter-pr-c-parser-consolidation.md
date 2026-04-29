# #895 PR C: hand-rolled parser consolidation + Vue render sites

Issue: https://github.com/receptron/mulmoclaude/issues/895

## ゴール

PR A (#902) と PR B (#905) で land した `parseFrontmatter` / `serializeWithFrontmatter` / `mergeFrontmatter` の共通 util を、既存の hand-rolled parser に migration する。同時に PR A で繰越した Vue render site (NewsView / SourcesManager) の frontmatter strip を追加。これで #895 close。

## scope-1: server hand-rolled parser 統合 (3 件)

### `server/workspace/sources/registry.ts`

- `parseSourceFile` (regex + 自前 parser) → `parseFrontmatter` (server util) ベースに
- 既存の `Map<string, string | string[]>` 出力を維持 (buildSource の既存 signature と互換のため、shared util の `Record<string, unknown>` から adapter でブリッジ)
- `parseFields` / `parseLine` / `parseValue` / `unquote` (= 自前 YAML parser) は削除可
- `serializeSource` の `yamlScalar` / `yamlList` は **temporarily 維持** — 既存の RESERVED_KEYS の出力順 + 専用エスケープ規則 + 既存テストの round-trip 期待値を壊さないため。serialize 統合は別 PR (PR-D 候補)

### `server/workspace/skills/parser.ts`

- `parseSkillFrontmatter` 内の `extractFrontmatterFields` + `parseScalar` (line-by-line YAML パーサ) → `parseFrontmatter` 使用
- 取り出し対象は `description` / `schedule` / `roleId` の 3 フィールドのみ
- body の trim 処理 (LEADING_BLANK_LINES_PATTERN) は維持

### `server/api/routes/wiki/frontmatter.ts`

- `parseFrontmatterTags` の自前 frontmatter envelope 抽出 + tags 行検索 → `parseFrontmatter` 使用 + `meta.tags` 抽出
- `cleanTagToken` (tag 正規化、`#` prefix 除去 / lowercase) は維持
- flow / block list 両対応は js-yaml が自動 (FAILSAFE schema で配列値を保持)

## scope-2: Vue render sites (2 件)

### `src/components/NewsView.vue`

- 現状: `/api/news/items/:id/body` から取得した body を `marked()` でそのまま render
- 確認事項: news item body の format は server 側で何を書いているか? RSS パイプラインの出力に frontmatter が含まれる可能性
- 副作用ゼロ確認後、`useMarkdownDoc` で strip + (option) properties panel

### `src/components/SourcesManager.vue` (briefMarkdown)

- 現状: 集計の daily brief を `marked()` で render
- 確認事項: `briefMarkdown` content の出所、frontmatter を持つかどうか
- 副作用ゼロ確認後、`useMarkdownDoc` で strip

## scope-2 の事前調査 (実装前)

PR A 計画時の調査メモでは:

- NewsView: 🟡 medium risk — RSS 由来 body、`---` を含む可能性低いが副作用ゼロ証明できない
- SourcesManager: 🟡 medium risk — daily brief、構造化 markdown で frontmatter 通常無いが要検証

→ 実装前に server 側のパイプラインを grep で確認、frontmatter を含み得る場合のみ strip 追加。含まないと確認できれば「将来含むようになった時に robust」だけのために追加する判断 (副作用ゼロなら yes、そうでなければ skip)。

## テスト

### scope-1

- 既存テストが全て通る前提:
  - `test/sources/test_registry.ts` — 31 cases
  - `test/skills/test_schedule_parser.ts` + `test_discovery.ts` — skill parsing
  - `test/routes/test_wikiHelpers.ts` — `parseFrontmatterTags`

### scope-2

- 新規 e2e (NewsView / SourcesManager それぞれ frontmatter ありの fixture で render 確認)

## 完了条件

- [ ] sources / skills / wiki/frontmatter の 3 parser が共通 util 経由
- [ ] 自前 YAML parser ヘルパが削除 (sources の `unquote` / skills の `parseScalar` / wiki の `extractFrontmatterBody` 等)
- [ ] 既存テスト全 pass
- [ ] NewsView / SourcesManager の frontmatter 取り扱いを確認、必要なら strip
- [ ] `yarn typecheck && yarn lint && yarn build && yarn test` clean
- [ ] e2e regression なし

## Out of scope

- **scope-3 (PR D)**: editor identity disambiguation (LLM/user/system 振り分け、API contract 変更)
- `serializeSource` の YAML serializer 統合 — RESERVED_KEYS 順序や `yamlScalar` の挙動が既存テストとの相性で別判断必要、別 PR
- snapshot pipeline (#763 PR 2)、history UI (#763 PR 3)
