# feat(collections): BI クエリ拡張 — 時系列 bucketing / count distinct / xlsx

Date: 2026-07-18
先行プラン: [plans/done/feat-collection-csv-duckdb-source.md](done/feat-collection-csv-duckdb-source.md)
（v1 read-only CSV dataSource + v2 構造化集計 DSL、実装済み）

背景: 先行プラン完了時点の BI 観点評価（会話 2026-07-18）で、
「パーソナル BI の下半分（データ接続〜集計）は完成、しかし BI の中核ワーク
ロードが DSL にまだ無い」と整理した。ギャップの深刻度順:

1. **時系列集計**（最重要）— date bucketing が無く、「月別売上」が
   月列が既に CSV に無い限り表現不可。BI クエリの過半は「期間別 × 何か」。
2. **count distinct** — ユニークユーザー数等、集計の基本語彙の欠落。
3. **xlsx** — 学校/HR ユースケース（先行プランの起点フィードバック）の
   現実のファイルは CSV より xlsx が主流。DuckDB 拡張で読める。
4. **npx / Docker の DuckDB install マトリクス検証** — 先行プラン v1
   受け入れ基準の**未実施残件**をここで引き継ぐ。
5. （後続フェーズ）ref 1-hop join / named metrics — 下記「スコープ外」。

## ゴール

`queryItems` / `view-data/query` の同一 DSL・同一安全モデル
（構造化 JSON、生 SQL 不可、値は prepared パラメータ、識別子はクオート）の
まま、時系列集計と count distinct を表現可能にし、dataSource に xlsx を
追加する。DSL の安全性の骨格（`core/queryZ.ts` の zod 検証 →
`server/csvQuery.ts` の純関数コンパイル）は変えない。

## 設計

### ① 時系列 bucketing（groupBy の拡張）

`groupBy` の要素を「文字列（従来どおり列名）」または「オブジェクト」の
union にする:

```jsonc
{
  "groupBy": [{ "column": "enrolledAt", "dateTrunc": "month", "as": "month" }],
  "aggregates": { "n": { "op": "count" } },
  "orderBy": [{ "field": "month", "dir": "asc" }]
}
```

- `dateTrunc`: `"year" | "quarter" | "month" | "week" | "day" | "hour"`。
- `as` は**オブジェクト形式では必須**（SAFE_ALIAS_PATTERN 準拠）。結果キー・
  `orderBy` 参照名・SQL エイリアスを一意に固定し、既存の
  case-insensitive 衝突検査（groupBy 列 × aggregate エイリアス）に
  そのまま参加させる。素の列名を暗黙キーにする案は「同一列を粒度違いで
  2 回 bucketing」できず、衝突規則も複雑化するため不採用。
- コンパイル: `date_trunc('<unit>', TRY_CAST("col" AS TIMESTAMP)) AS "as"`。
  `TRY_CAST` は sniffer が VARCHAR に倒した日付列（混在値・和暦以外の
  非標準形式）を集計時に NULL へ落とすため — `sum`/`avg` の
  `TRY_CAST AS DOUBLE` と同じ「standard BI tolerance」。
  `<unit>` は zod enum からの写像でしか生成しない（ユーザー文字列を
  SQL に直接書かない）。GROUP BY 句はエイリアスではなく式を繰り返す
  （DuckDB はエイリアス参照可だが、SELECT との対応を明示的に保つ）。
- `where` は今回拡張しない。日付範囲フィルタは既存の
  `gte`/`lt` + ISO 文字列で表現できる（列が VARCHAR でも辞書順 = 時系列順）。

### ② count distinct（aggregate op の追加）

- `op: "count_distinct"`（`column` 必須 — zod refine を
  「`count` のみ column 省略可」から「`count` / `count_distinct` で分岐」に）。
- コンパイル: `count(DISTINCT "col")`。

### ③ xlsx dataSource

```jsonc
{ "dataSource": { "type": "xlsx", "path": "data/students.xlsx", "sheet": "2026年度" } }
```

- `sheet` 任意（省略時は最初のシート）。値は prepared パラメータではなく
  `read_xlsx` の named parameter — **quoteLiteral 経由の文字列リテラル**で
  埋める（read_csv の `types={...}` struct キーと同じ扱い）。
- DuckDB の `excel` 拡張（`read_xlsx`）を使う。**拡張のロード方式が
  最大の調査項目**: `INSTALL excel` は実行時ネットワークを要する。
  (a) `@duckdb/node-api` 同梱/バンドル可否、(b) 初回オンライン取得 +
  キャッシュ、(c) 非対応環境では xlsx dataSource のみ graceful に無効化
  （CSV は影響なし）— の順で検討。結論と検知/回避手順は
  `packages/core/assets/helps/error-recovery.md` に追記（CLAUDE.md ルール）。
- エンコーディング検知/iconv 経路は不要（xlsx は zip+XML で常に Unicode）。
  一覧の行キャップ・primaryKey→行 ID エンコード（`id0x…`）・watcher
  （親ディレクトリ監視 + デバウンス）は CSV store と共通化する。
- registry Import/Contribute 拒否・書き込み 405 等の read-only ガードは
  dataSource 共通判定なので追加作業なし（テストで確認のみ）。

### ④ npx / Docker install マトリクス検証（先行プランからの引き継ぎ残件）

- `npx mulmoclaude`（npm launcher）と Docker sandbox で
  `@duckdb/node-api` の prebuilt binary が解決されるかを検証。
- 落ちる環境では「dataSource コレクションだけ無効化して他は動く」
  graceful degradation（dynamic import）を確認、検知/回避を
  `error-recovery.md` に追記。③ の拡張ロード検証と同時にやると 1 往復で済む。

## 実装ステップ

1. `core/queryZ.ts`: groupBy union（文字列 | `{column, dateTrunc, as}`）、
   `count_distinct` op、衝突検査 refine の更新。isomorphic なので
   custom view（ブラウザ）側は zod 更新だけで新形を送れる。
2. `server/csvQuery.ts`: `compileQuery` の SELECT/GROUP BY/ORDER BY を
   新 groupBy 形に対応、`aggregateExpr` に `count_distinct`。
   純関数ユニットテスト（コンパイル結果 SQL の snapshot 的検証）。
3. `server/csvStore.ts`: xlsx 分岐（`read_xlsx` + sheet、拡張ロード）、
   `schemaZ.ts`: `dataSource.type` に `"xlsx"`、`sheet` フィールド。
4. help 更新: `collection-skills.md` の queryItems 節（bucketing /
   count_distinct の例）と dataSource 節（xlsx）。custom-view help の
   クエリ契約にも新形を追記。
5. ④ の install マトリクス検証 + `error-recovery.md` 追記。
6. バンプ: `@mulmoclaude/core`（minor — DSL 追加は後方互換）、
   collection-plugin range ratchet は plugin 側の次の実バンプで
   （plugin→core range ratchet ルール）。MulmoTerminal 側は
   エンジン契約変更ではない（DSL 追加のみ）が、queryItems を叩く
   backends があれば追随を確認。

## スコープ外（意図的に入れない — 方向だけ記録）

- **ref 1-hop join**: `getOntology` が関係を知っているのに `queryItems` が
  辿れない断絶は認識済み。ただし join は DSL の安全モデル（単一ファイルに
  バインドされた 1 プレースホルダ）を壊す設計変更なので別プラン。
  当面はエージェント側合成（ontology → 複数 queryItems → メモリ内結合）を
  help のレシピとして明文化する程度に留める。
- **named metrics（セマンティックレイヤー）**: 「売上」の定義をワークスペース
  内ファイルに固定する話。実利用で繰り返しが見えてから（先行プラン v3 のまま）。
- **一覧ページング / リモート（phone）ビューへのクエリ露出**: 先行プランで
  別フェーズとした判断を維持。
- **外部 DB 接続 / スナップショット履歴**: BI 評価で挙がったが
  「workspace is the database」の外の話。必要になったら別プラン。
