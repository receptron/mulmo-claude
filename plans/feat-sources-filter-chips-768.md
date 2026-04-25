# Sources list — filter chips (#768)

## ゴール

`SourcesManager.vue` の sources 一覧の上に chip group を追加して、登録済みソースを fetcher kind / schedule で絞り込めるようにする。クライアントサイドのみ。

## 現状分析

- `src/plugins/manageSource/index.ts` の client-side `Source` 型:
  - `fetcherKind: "rss" | "github-releases" | "github-issues" | "arxiv"` (4 種)
  - `schedule: "daily" | "weekly" | "manual"` (3 種)
- 一方サーバ `server/workspace/sources/types.ts` は `web-fetch | web-search` と `hourly | on-demand` も持つが、これらは ephemeral 用で SourcesManager に登録される sources には現れない。issue の「Web-fetch / Web-search」chip は登録 sources の現実とずれているため v1 では入れない（ハードに分けるなら別 issue）
- 既存 `kindLabel` / `kindBadgeClass` (line 588 / 601) は 4 kind 対応の switch で、流用可

## v1 スコープ

### Chip categories (single-select)

| chip | filter |
|---|---|
| `all` | 全件（default） |
| `rss` | `fetcherKind === "rss"` |
| `github` | `fetcherKind === "github-releases" \|\| "github-issues"` |
| `arxiv` | `fetcherKind === "arxiv"` |
| `schedule:daily` | `schedule === "daily"` |
| `schedule:weekly` | `schedule === "weekly"` |
| `schedule:manual` | `schedule === "manual"` |

- single-select: 一度に 1 chip のみアクティブ。kind と schedule は同列に並べるが両方同時には選べない
- 各 chip にカウントバッジ（例 `RSS 12`）。カウント 0 の chip は非表示にして UI を簡潔に保つ
- `all` は常に表示し、選択中はハイライト

### UI / 表示

- 現状の `<ul>` 上、`actionMessage` バンナーの下に水平 chip 行を追加
- 既存の `kindBadgeClass` と同色パレットを流用してカテゴリ識別性を高める（active 時は背景濃く、inactive 時は淡く）
- `sources.length === 0`（presets state）では chip 行を非表示（フィルタ対象がない）
- フィルタ適用で 0 件になったら新しい empty state を表示: `pluginManageSource.filter.noMatching` + 「フィルタを解除」ボタン

### 純粋ロジック切り出し

`src/utils/sources/filter.ts` を新規作成:

```ts
export const SOURCE_FILTER_KEYS = ["all", "rss", "github", "arxiv", "schedule:daily", "schedule:weekly", "schedule:manual"] as const;
export type SourceFilterKey = typeof SOURCE_FILTER_KEYS[number];
export function matchesSourceFilter(source: Source, filter: SourceFilterKey): boolean { ... }
```

これでテストはピュアに書ける（Vue を読み込まず）。

### State / reactivity

- `const filterKey = ref<SourceFilterKey>("all")`
- `const filteredSources = computed(() => sources.value.filter((s) => matchesSourceFilter(s, filterKey.value)))`
- `const filterCounts = computed(() => /* { all, rss, github, arxiv, schedule:* } */)`
- 一覧は `v-for="source in filteredSources"` に変更

### i18n

`pluginManageSource.filter.*` を **8 ロケール lockstep** で追加:

- `all` / `rss` / `github` / `arxiv`
- `scheduleDaily` / `scheduleWeekly` / `scheduleManual`
- `noMatching` / `clearFilter`

### data-testid

- `sources-filter` (chip group root)
- `sources-filter-chip-${key}` (各 chip)
- `sources-filter-empty` (フィルタで 0 件時の wrapper)
- `sources-filter-clear` (フィルタ解除ボタン)

### テスト

- Unit: `test/utils/sources/test_filter.ts`
  - 全 chip キー × 各 fetcherKind / schedule の組合せ
  - all は全部マッチ
  - github が releases + issues 両方を捕まえる
  - schedule chip が kind を問わずに schedule で絞る
  - 不正な filter キーで false (defensive)

- E2E: `e2e/tests/sources-filter.spec.ts`
  - 4 種類のソース（rss × 2、github-releases、arxiv）を mock で seed
  - 起動時 `all` が active、全件表示
  - `RSS` chip クリック → 2 件、他の chip 選択で件数変化
  - `clearFilter` で `all` に戻る

## Out of scope (follow-up)

- Multi-select
- URL query 反映
- テキスト検索
- state-based フィルタ (失敗 / 未 fetch)
- Web-fetch / Web-search chip (登録 sources に出てこないので不要)

## 完了条件

- [ ] chip group 表示・件数バッジ・カテゴリ別絞り込み
- [ ] empty state + clear ボタン
- [ ] 8 locale i18n
- [ ] unit テスト
- [ ] E2E テスト
- [ ] `yarn typecheck / lint / format / test / build` clean
