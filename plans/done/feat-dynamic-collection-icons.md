# feat(collections): dynamic collection icons based on data state

Date: 2026-07-02
Issue: #1900 (beta-feedback)

## ゴール

コレクションのショートカットアイコンを、**データの状態に応じて動的に切り替える**。
例: 天気予報コレクションのアイコンが最新予報（晴れ/雨/曇り）で変わる。

## 現状マップ（実装の足場）

- **アイコン定義**: `CollectionSchema.icon`（Material Symbols 名の**静的文字列**）
  — `packages/core/src/collection/core/schema.ts:367-368`。
  スキルフォルダ内 `schema.json` に保存（`server/paths.ts` / `discovery.ts`）。
- **配信**: `CollectionSummary.icon = collection.schema.icon`
  — `packages/core/src/collection/server/discovery.ts:937`。
- **描画**: `src/components/PluginLauncher.vue:70`
  `<span class="material-symbols-outlined">{{ shortcut.icon }}</span>`。
  `shortcut.icon` は `config/shortcuts.json` の**キャッシュ**（`src/composables/useShortcuts.ts`）で、
  **Collections index を開いた時の `reconcile()` でしか更新されない**（pub/sub 未購読）。
- **データ変更通知**: 書き込み→`publishCollectionChange`→pub/sub `collection:<slug>`
  （`src/config/pubsubChannels.ts` の `collectionChannel`）→ ビューが再取得
  （`src/composables/collections/uiHost.ts:161` `subscribeChanges`）。
- **SQL-like 述語評価**: `where` / `matchesWhere`
  — `packages/core/src/collection/core/where.ts`（`dynamicIcon` 専用。単一フィールドの
  `when` / `CollectionWhen`（`actionVisible.ts`、fields/actions が使う）とは別物 — 混同しない）。
- **値→視覚トークンの前例**: enum値→色（`packages/core/src/collection/core/enumColors.ts`）。
- **導出の限界**: 既存 `derived`/`formula` は**数値専用・文字列/条件なし**（`derivedFormula.ts`）→ formula 拡張ではなく宣言的 mapping を新設。

## 設計（確定）

`dynamicIcon` は**任意**。無ければ従来どおり静的 `schema.icon`。使う場合は **`source` 必須**。

`source.where` / `rules[].where` は単一フィールドの `when` ではなく、**型付き条件の AND リスト**
（SQL の `WHERE a AND b AND c` 相当）。条件は `{ field, op, value }` で、`op` は
`eq | ne | in | gt | gte | lt | lte | contains`。空配列 `[]` は「常にマッチ」。
対象フィールドが記録に**存在しない**場合、`ne` は true（「値がない ⇒ Xとは異なる」で真）、
それ以外の `op` はすべて false になる。`gt`/`gte`/`lt`/`lte` は両辺を `Number()` に変換して比較し、
どちらかが `NaN`（数値化できない）なら false。

条件の比較値は、リテラル `value` の代わりに **`valueFrom`（他レコードの値参照）** でも指定できる:
`{ field, op, valueFrom: { record, field } }`（`value`/`valueFrom` は排他— どちらか一方必須、zod で強制）。
`valueFrom.record` は同じ `source.collection` 内のレコードID（`primaryKey` の値）、`valueFrom.field`
はそのレコードのフィールド名。ユーザごとの設定を持つ `_config` シングルトンレコードを参照すれば、
ハードコードした値ではなく「ユーザが設定したデフォルト値」に追従できる（例: 気象庁 (jma) 予報
コレクションで `office == _config.defaultCity` — ユーザが選んだ市区町村の予報だけを対象にする）。
参照先レコード/フィールドが存在しない場合（**未解決参照**）、その条件は `eq`/`ne` を含む**すべての
op で false** になる（壊れた参照が誤ってマッチすることは絶対にない）。

```jsonc
"dynamicIcon": {
  "source": {                    // 必須
    "collection": "weather",     //   必須（自身/他コレクションどちらも可＝クロスコレクション）
    "from": "latest",            //   任意・既定 latest(日付で最新) | first | when
    "orderBy": "date",           //   任意（latest の基準。既定は schema の date/datetime フィールド）
    "where": [                   //   任意（from="when" の絞り込み。AND条件のリスト）
      { "field": "region", "op": "eq", "value": "tokyo" }
    ]
  },
  "rules": [                     // where述語（AND条件リスト）の先勝ちリスト
    { "where": [{ "field": "condition", "op": "eq", "value": "rain" }], "icon": "rainy" },
    { "where": [{ "field": "temp", "op": "gt", "value": "30" }], "icon": "sunny" }
  ],
  "fallback": "partly_cloudy_day" // 任意・既定 schema.icon
}
```

`valueFrom` の例（jma-weather 風: ユーザが設定した市区町村の予報だけを対象にする）:

```jsonc
"dynamicIcon": {
  "source": {
    "collection": "jma-forecast",
    "where": [
      // office == _config.defaultCity（_config は同コレクション内のシングルトンレコード）
      { "field": "office", "op": "eq", "valueFrom": { "record": "_config", "field": "defaultCity" } }
    ]
  },
  "rules": [
    { "where": [{ "field": "condition", "op": "eq", "value": "rain" }], "icon": "rainy" }
  ],
  "fallback": "partly_cloudy_day"
}
```

### 評価ロジック（サーバ）
`discovery.ts` の summary 生成（`icon` セット箇所, :937）で:
1. `dynamicIcon` 無し → `schema.icon`。
2. あり → `source.collection` のレコード群から `from`(+`orderBy`/`where`) で対象1件を解決
   → `rules` を上から `where`（AND条件リスト）評価、最初に当たった `icon`。
3. どれも当たらない / 対象レコード無し / source コレクション未発見 → `fallback ?? schema.icon`。

クロスコレクション読み取りは discovery が全コレクションを走査済みなので追加コスト小。

## 実装ステップ

### v1（アイコン計算 + 既存契機で反映）
- `schema.ts`: `DynamicIconSpec`（`source` / `rules` / `fallback`）を型追加、`CollectionSchema.dynamicIcon?`。
  述語は `where.ts` の `Where`（`WhereCond[]`）— 単一フィールドの `CollectionWhen` とは別型。
- `discovery.ts`: zod に `dynamicIcon` を追加（`icon` の zod は :461 付近）。summary の `icon` 計算を上記ロジックに。
  - 対象レコード解決 + `rules` 評価は純関数に切り出し（`core/dynamicIcon.ts` が `core/where.ts` の
    `matchesWhere` を呼ぶ、ユニットテスト）。
- 反映タイミングは既存 `reconcile()`（Collections index 訪問 / shortcut 再照合）に乗る＝「次に Collections を見たら反映」。
- テスト: `matchesWhere`（op毎の true/false、欠損フィールド、NaN、AND、空配列）、
  `selectDynamicRecord`/`resolveIcon`（rule先勝ち / no-match→fallback / from=latest,first,when / 自身&他コレクション / レコード0件）。

### v2（ライブ更新・追加）
- `useShortcuts` / launcher を `collection:<source.collection>` に**購読**させ、変更時にその slug を再 reconcile → リアルタイム切替。
- 依存: dynamicIcon を持つショートカットの `source.collection` 一覧を購読対象にする（クロスコレクションも slug キーでそのまま乗る）。

## Open questions / 注意
- **決定的なレコード選択**: `listItems` は `readdir` 順（マシン依存で不定）。それを `computeCollectionIcon` で `primaryKey`（id）昇順にソートしてから選ぶ。これで `from:"first"`（=最小id）/ `orderBy` 未指定 `latest`（=最大id）/ `orderBy` 同値タイ（=最小id優先）が reconcile 間で一意に定まる（アイコンが揺れない）。
- `source.from` 既定 `latest` の `orderBy` 未指定時: schema に date/datetime フィールドが無いコレクションは id 順末尾にフォールバック。
- `rules[].icon` は Material Symbols 名のみ（既存と統一。任意画像は対象外）。
- `dynamicIcon` の妥当性検査（存在しない `source.collection`/`field`/icon名）は discovery 時に warn 
  （`packages/core/assets/helps/error-recovery.md` に診断を1項目追記するか検討）。

## DSL 汎用性検証（10 ユースケース）

DSL の骨格（すっきり保つための不変な形）:
**「source で 1 レコードを選ぶ → rules を先勝ちで評価 → icon。外れたら fallback」**
- `source = { collection, from?(latest|first|when), orderBy?, where? }`
- `where = WhereCond[]`（AND）。`WhereCond = { field, op, value | valueFrom }`、
  `op ∈ eq|ne|in|gt|gte|lt|lte|contains`、`valueFrom = { record?, field }`
  （`record` 有=別レコード＝設定追従 / 省略=同一レコード＝フィールド比較）。

| # | ユースケース | 設定の要点 | 判定 |
|---|---|---|---|
| 1 | 天気: 既定都市の当日予報 | `source.where: office eq valueFrom(_config.defaultCity) & source eq today`、rules は `weatherCode` の `gte` 帯 | ✅ |
| 2 | 株: 当日騰落 | 要約レコードを選び `dayChangePct gte 0 → trending_up` / fallback `trending_down` | ✅ |
| 3 | 個別銘柄アラート | `price gte valueFrom(_config.alertHigh)` / `lte valueFrom(_config.alertLow)` | ✅ |
| 4 | 予算: 使いすぎ | 同一レコード比較 `spent gt valueFrom(budget) → error` | ✅（同一レコード valueFrom） |
| 5 | フィットネス: 歩数目標 | `steps gte valueFrom(goal) → check_circle` | ✅（同一レコード valueFrom） |
| 6 | 読書: 今読んでる本 | `from:first where status eq reading`、genre で分岐 | ✅ |
| 7 | 習慣: 連続日数バッジ | `streak gte 30/7/1 →` 各アイコン（数値帯） | ✅ |
| 8 | メール: 未読有無 | 要約レコードの `unread gt 0 → mark_email_unread` | ✅（要約レコード） |
| 9 | タスク: 期限切れ有無 | **集約が必要**（どれか1件でも overdue）→ 要約レコード `overdueCount gt 0` | ⚠️→✅（要約） |
| 10 | カレンダー: 今日の予定 | **時刻依存**（today）→ データ側の today マーカー/`_today` 要約 | ⚠️→✅（マーカー） |

### この検証で判明したこと（＋加えた spec 変更）
- **B. 同一レコードのフィールド比較**（4,5）→ `valueFrom.record` を任意化（省略=同一レコード）。**実装済み**。
- **数値比較の穴**: `Number("")===0` で空文字が 0 と誤判定 → 空/空白は非数値(NaN)扱いに**修正済み**。
- **A. 集約（any/all/count）**（9）と **C. 動的 now/today**（10）は **DSL に入れない**。理由: 「1 レコード選択→写像」の骨格を崩すと一気に複雑化する。代わりに **データ層へ委譲**:
  - 集約 → **要約レコード**（`_summary.overdueCount` / `worstStatus` 等）をコレクション側（generator / `derived` フィールド）が持つ。
  - 時刻 → **マーカー**（天気の `source:today` と同発想 / `_today` 要約）でデータ側が表現。
  - これで DSL は小さく・宣言的・保守しやすいまま、実ユースケースを網羅できる。

### 設計原則（メンテのため）
- DSL は宣言的な **select-one → first-match rules → icon** のみ。集約・時刻・複雑な導出は**データ層**（要約レコード・`derived` フィールド・generator のマーカー）に委譲。
- `valueFrom` の 2 用途（別レコード=設定追従 / 同一レコード=フィールド比較）で「動的な閾値・都市・目標値」を宣言的にカバー。

## Out of scope（意図的に入れない＝複雑化回避）
- **集約演算子**（any/all/count）→ 要約レコードで表現。
- **`$now`/`$today` 等の時刻参照**→ データ側の today マーカーで表現。
- **OR / 入れ子 where**→ 今は AND のみ（必要になってから検討）。
- 数値formula の文字列/条件拡張（不要）。アイコン以外（色/バッジ）の動的化。v2 の細かいデバウンス最適化。
