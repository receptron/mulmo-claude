# feat(collections): `flag` フィールド — 汎用 computed boolean と completion の一般化

Date: 2026-07-18
起点 issue: [#2174](https://github.com/receptron/mulmoclaude/issues/2174)（テーブルビューの hide-completed トグル）

背景: #2174 は `completionField` / `completionDoneValues` 駆動の「完了を隠す」
トグルの提案。しかし設計議論（会話 2026-07-18）で、「この行は完了か」という
述語が現状ヘルパー関数（`itemIsDone`、
`packages/core/src/collection-watchers/reconciler.ts:67`、server-only subpath）
にしか存在しないことが根本問題だと整理した。さらに done は特別ではない —
isVisited / isPassed / isQualified など「record の状態を要約する boolean」は
汎用に欲しい。よって **isDone を特別扱いせず、汎用の computed boolean
フィールド（`flag`）をスキーマ DSL に足し、completion をその一消費者に
一般化する**。フィールドになれば、既存のフィールド駆動機構
（テーブル表示・detail view・getItems enrichment・エージェントの絞り込み）が
すべて無改修で拾う。

既存の資産を最大限使う:

- 述語語彙は **`WhereZ`**（`schemaZ.ts:538`、`eq/ne/in/contains/gt/gte/lt/lte`
  + 同一 record の field-to-field 比較 `valueFrom`）。dynamicIcon が既に使って
  おり、純評価器 `matchesWhere`（`core/where.ts`、zod-free・browser-safe）も
  実装済み。`gte` があるので「score ≥ 60 → isPassed」も初日から表現できる。
- 評価は **`deriveAll`**（`core/deriveAll.ts`）の saturation loop に統合。
  server（`collection/server/derive.ts`）と client が単一実装を共有する
  既存構造にそのまま乗る。
- `derived` formula 言語は**拡張しない**。rollup と同じ「structured field で
  表現し、formula evaluator の no-string-literals 境界を守る」パターン。

## ゴール

スキーマで宣言した boolean 述語フィールド（`flag`）が、保存されず・
server/client 同一実装で計算され、テーブルビューの絞り込みチップと
completion 判定（通知クリア）の両方を駆動する。`flag` を宣言しない
コレクションでは挙動・UI とも一切変わらない。

## 設計

### ① `flag` フィールド型（schemaZ）

```jsonc
"fields": {
  "status":   { "type": "enum", "label": "状態", "values": ["todo", "doing", "done", "canceled"] },
  "score":    { "type": "number", "label": "点数" },
  "isDone":   { "type": "flag", "label": "完了", "where": [{ "field": "status", "op": "in", "value": ["done", "canceled"] }] },
  "isPassed": { "type": "flag", "label": "合格", "where": [{ "field": "score", "op": "gte", "value": "60" }] }
}
```

- `FlagFieldZ = { type: "flag", ...fieldBase, where: WhereZ }`。値は boolean、
  **never stored**。`COMPUTED_TYPES`（`schema.ts:107`）に追加 — これだけで
  edit form からの除外と mutate action `set` の対象外化は既存 refine が
  自動でカバーする。
- refine: `where` 各 cond の `field` は宣言済み top-level field であること
  （typo 検出 — `completionField` の existence refine と同型）。
- refine: `valueFrom.record`（cross-record 参照）は flag では**禁止**。
  `deriveAll` は per-row 評価で自コレクションの `recordsById` を持たず、
  UNRESOLVED → never-match の罠になるため、shape で防ぐ。`record` 省略形
  （同一 record の field-to-field、例 `spent > budget`）は許可。
- flag が flag / derived を参照するのは許可（下記②の saturation が解決）。
- 名前衝突問題は設計上存在しない — flag は `fields` 内の宣言なので、
  同名の stored field と共存しようがない（1 名前 = 1 フィールド）。

### ② 評価 — `deriveAll` の saturation loop に統合

- loop 内で `field.type === "flag"` なら
  `matchesWhere(field.where, enriched)` → boolean を書く。derived と同じ
  loop に入れることで、flag が derived 値を読める
  （`total` → `isOverBudget`）し、flag が flag を読める
  （`matchesWhere` は値を stringify するので `eq "true"` で合成できる）。
- `maxPasses` は derived + flag の合計数に更新。
- base からの **strip も derived と同型**: record JSON に stale/偽造の
  flag キーが保存されていても、computed output が host-truth。
- 呼び出し側は無改修で追随: server の getItems enrichment
  （`collection/server/derive.ts:159`）、client のテーブル/フォーム表示、
  remoteHost の `collectionPage.ts` はすべて `deriveAll` 経由。

### ③ completion の一般化 — `itemIsDone` の移設と flag 対応

- `completionField` が **flag フィールドを指す**ことを許可。その場合
  `completionDoneValues` は**省略必須**（implied `["true"]`）。既存 refine
  「両方 or 両方なし」を「flag を指すなら values 禁止 / それ以外は両方必須」
  に更新。
- `itemIsDone` を `collection-watchers/reconciler.ts` から
  `collection/core`（例: `core/completion.ts`）へ移設し、
  `collection-watchers` からは re-export で互換維持（#1795 の
  「plugin/上位から core へ引き抜く」パターンの watchers 版）。
  browser-safe になり、④の Vue 側からも import できる。
- flag 対応の判定: 対象 field が flag なら `matchesWhere(where, item)` を
  **直接評価**する。reconciler はファイル上の生 record を読むため
  （`deriveAll` を経ない）、materialize 済みの値には依存しない。
  legacy（enum 直指し + `completionDoneValues`）は従来どおり
  stringified 値の membership 判定 — 既存コレクションは無改修で動く。

### ④ テーブルビュー — flag 絞り込みチップ（#2174 の一般化）

- 検索ボックス付近に、絞り込みチップを表示:
  - **flag フィールドごとに 1 チップ**、tri-state（すべて → 隠す → のみ）を
    クリックで循環。ラベルは flag の `label`（schema 由来なので i18n 不要）。
  - **legacy completion pair のみ**（flag 未宣言で
    `completionField`+`completionDoneValues` 宣言）のコレクションには、
    `itemIsDone` を述語とする「完了」チップを 1 つ合成 — #2174 の要求を
    既存コレクション無改修で満たす。`completionField` が flag を指す場合は
    その flag のチップが兼ねるので、二重には出さない。
- `filteredItems`（`CollectionView.vue:1066`、検索フィルタ）にチップ状態の
  述語を AND で追加。カラムソートとは独立に併用可。
- 永続化はテーブルソートの localStorage パターン踏襲
  （`storedSortFor` / `sortState`、per-collection、リロード後も維持）。
  default は全チップ「すべて」= 既存の見え方不変。
- 件数サマリ（`collectionsView.searchSummary`、`CollectionView.vue:313`）は
  絞り込みで隠れている件数が分かる表示に。
- flag セルの表示: read-only のチェック表示（`toggle` の read-only 版に
  相当）。テーブルセル・detail view の両方。

### ⑤ i18n / docs

- チップの状態文言（「隠す」「のみ」等）を 8 locale lockstep で追加
  （[docs/i18n.md](../docs/i18n.md)）。
- DSL リファレンス [`packages/core/assets/helps/collection-skills.md`](../packages/core/assets/helps/collection-skills.md)
  に `flag` と completion-via-flag を追記（assets/helps 変更なので
  `@mulmoclaude/core` bump 必須）。

## 実装ステップ

1. **PR-1（core）**: `FlagFieldZ` + refines / `COMPUTED_TYPES` /
   `deriveAll` 統合 / `itemIsDone` 移設 + flag 対応 / unit tests
   （schemaZ の refine 網羅、deriveAll の saturation・strip、
   completion 両形式）/ collection-skills.md 追記。
   `@mulmoclaude/core` **minor** bump。
2. **PR-2（plugin）**: CollectionView チップ UI + `filteredItems` 統合 +
   localStorage 永続化 + 件数サマリ + flag セル表示 + i18n 8 locale。
   collection-plugin bump（core range の ratchet はこの real bump に同乗 —
   [plans/done 参照: plugin→core range ratchet 方針]）。
3. e2e: mock e2e にチップの表示条件（flag あり/なし/legacy pair）と
   永続化のケースを追加。

**MulmoTerminal port**: schema parser は core 共有なので、MulmoTerminal 側は
core の version bump 追随のみで新 type を受理する（engine contract の
追加的変更）。ただし MulmoTerminal 独自にフィールド type で分岐する表示が
あれば unknown type の fail-soft を確認すること — publish は本体マージ後、
明示指示があってから。

## スコープ外（意図的に入れない — 方向だけ記録）

- **カレンダー / カンバン / Day ビュー**への絞り込み適用（#2174 と同じ判断。
  カンバンは列分けで既に緩和されている）。
- **dataSource（CSV/DuckDB）クエリでの flag 参照**: flag は computed で
  SQL 側のファイルに列が存在しないため、BI DSL
  （[feat-collection-bi-extensions.md](feat-collection-bi-extensions.md)）の
  `where`/`groupBy` からは参照不可。必要になったら「flag の where を
  SQL CASE 式にコンパイルして materialize する」案から検討する。
- **`WhenZ`（単一フィールド membership）の拡張・置換**: 既存の 7+ 消費者
  （visibility / action require / notifyWhen / spawn.when / …）は据え置き。
  flag が richer な述語の受け皿になるので、WhenZ を太らせる圧力を逃がす。
- **cross-record `valueFrom`（`record` 指定形）**: ①で禁止。per-row 評価に
  自コレクション全 record を供給するコスト設計が必要になったら別プラン。
- **legacy completion pair の deprecation**: 両形式を恒久サポート。
  移行の強制はしない。
