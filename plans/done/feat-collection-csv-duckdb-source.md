# feat(collections): 外部データ (CSV) を実体とする read-only コレクション — DuckDB クエリエンジン

> **Status: 完了 — plans/done へアーカイブ（2026-07-18）**
>
> - **v1（read-only CSV dataSource + DuckDB store）: 実装済み**（2026-07-17、PR #2158。実装記録は v1 節）。
> - **v2（構造化集計 DSL + `queryItems` + `view-data/query`）: 実装済み**（2026-07-18、PR #2163 / #2165。
>   file-backed コレクションも enriched JSONL 経由で同一 DSL に対応済み — `jsonlQuery.ts`）。
> - **未実施のまま後続へ引き継いだ残件**: npx / Docker サンドボックスでの DuckDB install
>   マトリクス検証（v1 受け入れ基準の残件）。
> - **当初から別フェーズ**（未着手のままスコープ外として維持）: 一覧ページング、
>   リモート（phone）ビューへのクエリ露出、v3（xlsx 等フォーマット追加・ネイティブ昇格・
>   メトリクス定義）。
> - **後続プラン**: [plans/done/feat-collection-bi-extensions.md](../feat-collection-bi-extensions.md)
>   （時系列 bucketing / count distinct / xlsx / install 検証の引き継ぎ）。

Date: 2026-07-17
背景: ベータユーザーのフィードバック「データさえあれば可視化が作れる。Tableau も Looker もいらないのでは」。
BI ツール代替のユースケース（学校の生徒管理、HR 系データの分析等）を、Collections の自然な拡張として取り込む。

## ゴール

ユーザーが外から持ち込んだデータファイル（まず CSV）を**取り込み（コピー/変換）せず**、その上に
コレクションを定義できるようにする。実体はユーザーの CSV のまま、DuckDB がクエリエンジンとして
間を繋ぐ。**BI 向け read-only と割り切る** — UI からの編集口は閉じ、更新は「CSV を差し替える」か
「Claude にファイル編集として頼む」経路に一本化する。

体験: ユーザーが CSV をワークスペースに置いて「これ管理したい」→ Claude が CSV を覗いてスキーマ
（列の型・意味・キー列）を推論し、コレクション定義を書く → 既存のコレクション UI / custom view /
リモートビューがそのまま使える。列の意味を会話で訂正すればコレクション定義が育つ（self-improving）。

## 方針（会話で確定済み）

1. **別物ではなく同一抽象** — 「データの束 + スキーマ + ビュー」概念を 2 系統併存させない。
   既存のファイル実体コレクションと外部データ実体コレクションは、ストレージ層の 2 実装。
   micro-package 化をやめて core に集約した流れ（plans/done/refactor-shared-core.md）と同じ判断。
2. **read-only と割り切る**（フェーズ1）— 書き込み系の難所（atomic write、O_EXCL 競合、mutate、
   spawn、draft、kanban 移動）が全部消え、capability は実質 `readonly` 1 個に縮退する。
   Tableau/Looker の「データソースは read-only、更新は上流で」というモデルとも一致。
3. **read-only ≠ データ不変** — 真実の源は CSV。ユーザー/Claude がファイルを更新すれば
   ビューが追随する（file watch → `publishCollectionChange`）。
4. **将来 UI 編集が欲しくなったら**、CSV ソースに書き込みを足すのではなく
   「ネイティブコレクションへの昇格（取り込み）」で応える。同一抽象だから 1 操作で済む。

## UX 配置（会話で確定済み）

**第 3 の最上位概念は作らない。** CSV（および将来の read-only 取り込みデータ）は
Collections の中の 1 バリアントとして見せる。ユーザーから見た違いは「ここで編集できるか」の
1 ビットだけで、それ以外（一覧 / 詳細 / kanban / custom view / remote view）が同一であることが
本プランの価値そのもの。Feeds が独立サーフェスを持つのは schedule / ingest 状態という固有の
機構が見えるからで、CSV ソースの固有機構は実質ファイルパスのみ — バッジとツールバー差し替えで
足りる（Airtable の synced table と同じパターン）。Collections vs Feeds が既に
「似て非なるもの」である以上、第 3 の名詞は境界の混乱を掛け算する。

UI の具体的な出し分け:

- **カード / 詳細ヘッダに read-only チップ** + 「Source: `data/students.csv`」表示
  （クリックでファイルを開ける）。405 を踏ませる前に期待値を設定する。
- **ツールバー差し替え**: Add record / Edit / Delete / kanban 移動を隠し、
  代わりに「Open CSV」（+ 将来「Replace file」）を出す。
- **`/collections` にフィルタチップ**（All / Editable / Data / Feeds 等）で混在リストを整理。
- **Contribute / Discover は dataSource コレクションでは非表示**
  （生徒名簿をレジストリに公開する流れは成立しない — サーフェスに関係なく抑止が必要）。
- **将来の再編**: v2 で集計/ダッシュボードの固有機構（保存クエリ、メトリクス定義）が
  生まれたら「Data」サーフェス新設を再検討する（その際は Feeds の統合も視野）。
  機構が存在する前にタクソノミーを先取りしない。
- **昇格（v3）との整合**: Collections 内バリアントなら、ネイティブ昇格は
  read-only チップが消えるだけで URL もナビゲーション位置も変わらない。

## 現状マップ（実装の足場）

- **アイテム I/O は 4 関数に完全集約**: `listItems` / `readItem` / `writeItem` / `deleteItem`
  — `packages/core/src/collection/server/io.ts:72,105,152,199`。全呼び出し側（約15箇所）は
  `collection.dataDir` を渡すだけで、「実体が `<dataDir>/<itemId>.json`」を知るのは io.ts の中だけ。
  - 呼び出し側: `server/api/routes/collections.ts:165,241,285,315,455,501,926`、
    `server/workspace/collections/remoteView.ts:138,166,169,274`、
    `server/remoteHost/handlers/getCollection.ts:28` / `getFeed.ts:31`、
    core 内 `manageTool.ts` / `mutate.ts` / `derive.ts:64` / `dynamicIcon.ts:46` / `spawn.ts:236`、
    `packages/core/src/collection-watchers/reconciler.ts:26`。
- **`source` は名前が既に使われている**: `LoadedCollection.source: CollectionSource`
  （`"user" | "project" | "feed"`、`packages/core/src/collection/core/schema.ts:88`）は
  スキルの出どころの意味。→ 新フィールドは **`dataSource`** と命名して衝突回避。
- **スキーマ**: zod 定義 `packages/core/src/collection/core/schemaZ.ts:709-710`
  （`dataPath` / `primaryKey` 必須）。`dataPath` は `resolveDataDir`
  （`packages/core/src/collection/server/paths.ts:106`）で workspace 封じ込め検証。
- **行 ID の制約**: `safeRecordId`（`paths.ts:32`）— 英数/ハイフン/アンダースコア/内部ドットのみ、
  `..`・パス区切り不可。詳細ビュー URL・リモートビューの item 参照がこの ID を前提にする。
- **計算列**: `deriveItems`（`server/derive.ts`）は `listItems` の**結果**にメモリ上で適用
  → 行の出どころが CSV でもそのまま動く。
- **変更通知**: 書き込み → `publishCollectionChange`（`server/host.ts`）→ pub/sub
  `collection:<slug>` → ビュー再取得。CSV ソースでは書き込み契機がないので、
  **ファイル監視**からこのイベントを発行する必要がある（collection-watchers に足場あり）。
- **read-only の前例なし**: UI / manageTool / ルートは全コレクションを書き込み可能と仮定している。

## 設計

### schema.json 追加（最小）

```jsonc
{
  "dataSource": {              // 任意。無ければ従来どおり dataPath の JSON ファイル群
    "type": "csv",             //   v1 は csv のみ。将来: xlsx | json | parquet | sqlite
    "path": "data/students.csv"  //   workspace 相対（resolveDataDir と同じ封じ込め検証）
  }
}
```

`dataSource` があるコレクションは:
- 自動的に **read-only**（capability として summary / detail に載せ、UI が出し分け）
- `dataPath` は不要（zod で `dataSource` と `dataPath` は排他 or `dataSource` 優先を明示）
- **行 ID の列は既存の `primaryKey` を再利用する**（決定済み — キー概念を 2 つ持たない）。
  `primaryKey` が「行 ID になる CSV 列名」を指す。Claude がスキーマ推論時に提案するのも従来どおりこのフィールド。
- `fields` は従来どおり宣言。CSV の列名 → フィールド名の対応はフィールド名一致を基本とする

### ストレージ抽象（io.ts の裏に 1 枚）

`CollectionStore` インターフェースを導入し、`storeFor(collection)` ファクトリで
ファイル実装 / DuckDB-CSV 実装を選ぶ:

```ts
interface CollectionStore {
  list(): Promise<CollectionItem[]>;
  read(itemId: string): Promise<CollectionItem | null>;
  readonly capabilities: { writable: boolean };
  // writable=true の store のみ:
  write?(itemId: string, item: CollectionItem, opts): Promise<WriteItemResult>;
  delete?(itemId: string): Promise<DeleteItemResult>;
}
```

- 既存 4 関数はファイル store の実装として残す（呼び出し側の移行は段階的でよい —
  `dataSource` 無しのコレクションは従来経路のまま動く）。
- 書き込み系ルート / manageTool / mutate / spawn は `capabilities.writable` を見て
  明確なエラー（HTTP 405 / MCP エラーメッセージ）を返す。**サーバー側で強制**
  （UI の出し分けだけに頼らない — singleton の refuseOverwrite と同じ思想）。

### DuckDB-CSV store（v1）

- **DuckDB を v1 から入れる**（決定済み — v2 の `query()` を待たない）。純 JS の CSV パーサで
  v1 を済ませる案は却下: ネイティブモジュールの install 問題は v2 で顕在化させるより v1 で
  洗い出す。→ **v1 の受け入れ基準に npm launcher（`npx mulmoclaude`）/ Docker sandbox の
  install マトリクス検証を含める**。
- `list()`: `SELECT * FROM read_csv('<path>')` → 列名→フィールドのマッピング → `CollectionItem[]`。
  `primaryKey` 列の値を `safeRecordId` に通し、通らない値の行はサニタイズ（後述 Open questions）。
- `read(id)`: `WHERE <primaryKey> = ?` の 1 行クエリ（プリペアドステートメント必須 — 文字列連結で SQL を組まない）。
- **文字コードは store 側で吸収する**（決定済み — ユーザーの CSV は一切書き換えない）。
  日本語 CSV は Shift_JIS がまだ現役だが、Excel から再エクスポートされれば再び Shift_JIS に
  戻るので「UTF-8 に変換して置き直す」は真実の源を壊す。store が読み込み時にエンコーディングを
  検知（BOM / ヒューリスティック）して iconv でデコードする。
- パス検証は `resolveDataDir` と同じ realpath 封じ込め（symlink 防御を含めて再利用）。
- 行数上限: v1 は `LIMIT`（例 5,000 行 + 超過 warn）。全件 materialize が前提の既存 UI を
  壊さないためのガード。大規模データは v2 の集計クエリで扱う（一覧ではなく集計を見せる）。

### 変更追随

- `dataSource.path` を collection-watchers の監視対象に追加 → 変更検知で
  `publishCollectionChange({ slug, op: "upsert" })`（全件再取得で十分、行差分は取らない）。
- CSV 差し替え → 開いているビューが自動更新、が受け入れ基準。

### 依存とパッケージ配置

- DuckDB は `@duckdb/node-api`（公式 Node バインディング）を **@mulmoclaude/core の server 専用
  サブパス**に置く（browser-safe surface に混ぜない）。プラグインからは core 経由（uphill 禁止）。
- ネイティブモジュールなので、npm launcher / Docker sandbox での install 検証が必要
  （→ Open questions。問題が出た検知/回避は `packages/core/assets/helps/error-recovery.md` に追記）。

## 実装ステップ

### v1（read-only CSV ソース）— **実装済み（2026-07-17）**

実装記録（計画との差分）:
- 行 ID エンコードは `id0x<utf8-hex>`。エンコード名前空間と生値が衝突しないよう、
  `id0x…` 形の生値も再エンコードする（単射）。`primaryKey` フィールド値は
  レコード ID で上書き（ファイル実体と同じ不変条件）。
- 文字コード: 先頭 1MB を UTF-8 検証（巨大ファイルを読み切らない）。非 UTF-8 は
  BOM で UTF-16 判定、それ以外は cp932 として iconv デコードし、
  `$TMPDIR/mulmoclaude-csv-utf8/` に (path, mtime, size) キーのキャッシュを書く。
  ユーザーのファイルは一切書き換えない。
- dataSource コレクションの `dataDir` は慣例パス `data/collections/<slug>/items`
  のファントム（削除/アーカイブ経路の整合用。レコードは置かれない）。
  `LoadedCollection.dataSourceFile` に解決済み CSV 絶対パス。
- zod レベルで `dataPath`/`dataSource` は排他必須、`singleton`/`ingest`/`spawn`/
  mutate アクションは dataSource と共存不可（書き込み機構をスキーマ検証で根絶）。
- レジストリ Import / Contribute は dataSource スキーマを明示拒否（server 側 422 +
  UI で Contribute 非表示）。
- watcher: dataDir 監視ではなく CSV の親ディレクトリを監視（atomic replace で
  inode が変わるため）、300ms トレーリングデバウンスで `publishCollectionChange`。
- バンプ: @mulmoclaude/core 0.23.0（duckdb/iconv-lite 追加、helps 更新）、
  collection-plugin 0.12.0（core range ^0.23.0 ratchet）、launcher は dep range のみ。
- npx / Docker の install マトリクス検証は未実施（受け入れ基準に残る — 下記 8 の残件）。
1. `schemaZ.ts`: `dataSource` 追加（type/path、zod、`dataPath` との排他規則。行 ID 列は既存 `primaryKey`）。
2. `CollectionStore` 抽象 + ファイル store（既存 io.ts のラップ）+ `storeFor()`。
3. DuckDB-CSV store（list/read、プリペアドステートメント、封じ込め検証、行数ガード、
   エンコーディング検知 + iconv デコード）。純関数部（列マッピング、行→ID 変換）は
   切り出してユニットテスト。npm launcher / Docker sandbox での install 検証を含む。
4. 書き込み経路の capability ガード（routes / manageTool / mutate / spawn / remoteView）
   — read-only コレクションへの write は 405 / 明確な MCP エラー。
5. UI: capability を summary / detail に載せ、「UX 配置」の出し分けを実装 —
   read-only チップ + Source 表示、作成/編集/削除/kanban 非表示 + 「Open CSV」、
   `/collections` フィルタチップ、dataSource コレクションの Contribute/Discover 非表示。
6. watcher: `dataSource.path` の変更 → `publishCollectionChange`。
7. スキーマ推論スキル: 「CSV を読んで dataSource 付き schema.json を提案する」レシピを
   collection 作成フローの help / skill に追記（キー列の提案を含む）。
8. テスト: store 差し替えのユニット + read-only ガードのハンドラテスト。
   e2e-live は既存 collections カテゴリに 1 シナリオ追加を検討。
   - **フィクスチャは自作の小型 CSV をコミットする**（決定的・ライセンスクリーン）。
     [datablist/sample-csv-files](https://github.com/datablist/sample-csv-files) は
     ライセンス無し + 実ファイルは Google Drive 配布なので vendoring 不可 —
     大容量（〜200万行）での手動/perf テスト用にローカル DL して使う。
   - 壊れ CSV のケース一覧は同リポジトリ `src/broken_csv.py` の 12 分類を下敷きにする:
     Windows-1252 / Latin-1 エンコーディング、セミコロン/混在デリミタ、エスケープ漏れ引用符、
     閉じ忘れ引用符、非引用フィールド内改行、列数過不足（ragged rows）、BOM + 空白付きヘッダ、
     混在改行コード、重複ヘッダ。重複ヘッダと ragged rows は挙動を要決定
     （DuckDB `read_csv` 側の挙動確認込み）。
   - 日本語カバレッジは自作必須（datablist には無い）: Shift_JIS の名簿、
     日本語キー値の UTF-8（hex ID 経路）、キー重複。

### v2（BI の本丸: クエリ/集計）— **実装済み（2026-07-18、PR #2163 / #2165）**

**クエリ面は構造化 DSL（生 SQL は出さない）。** SQL は言語として CSV に
スコープされない（`read_csv`/`read_text`/`COPY TO`/`INSTALL httpfs` で
ファイルシステム全域 + ネットワークに届く）うえ、発行者（custom view /
エージェント）は untrusted コンテンツ（injected CSV セル、registry 由来
ビュー）に誘導されうる — DSL は構造的にエスケープを表現できない。
表現力が足りなくなったら、DuckDB の untrusted-SQL モード
（`enable_external_access=false` + `lock_configuration=true`、テーブルへの
事前ロード必須）を同じエンドポイント裏の逃げ道として後付けする。

**ダッシュボードはオンデマンド**（custom view がクエリエンドポイントを
叩いてチャートを描く）。名前付きメトリクス（セマンティックレイヤー）は
実利用で繰り返しが見えてから（v3）。

DSL の形（JSON、zod 検証、サーバー側で SQL にコンパイル。値は全て
プリペアドパラメータ、列名/エイリアスは識別子クオート）:

```jsonc
{
  "groupBy": ["Category"],                       // 任意
  "aggregates": { "total": { "op": "sum", "column": "Price" },
                   "n": { "op": "count" } },      // count/sum/avg/min/max
  "where": [{ "field": "Availability", "op": "eq", "value": "in_stock" }],
  "orderBy": [{ "field": "total", "dir": "desc" }], // groupBy 列 or 集計エイリアス
  "limit": 100                                    // clamp（default 1000 / max 10000）
}
```

実装項目:
- store にオプショナルな `query()` を追加。DuckDB store はネイティブ、
  ファイル store は非対応（明確なエラー）から始める。
  → **後続で全コレクション対応済み**: ファイル実体コレクションは
  `listItems`（symlink 防御込み）→ `enrichItems`（derived/rollup/toggle が
  実列になる）→ 一時 JSONL（0600）→ 同一コンパイル SQL の `read_json` で
  同じ DSL を実行（`jsonlQuery.ts`）。DuckDB が生レコードファイルに直接
  触れない設計（glob だと symlink 追随 + 計算列欠落の二重の罠）。
  空コレクションは DuckDB を経由せず `[]`。
- エージェント面: `manageCollection` に `queryItems` アクション。
- ビュー面: view-token（read）スコープの `POST …/view-data/query`
  エンドポイント + custom-view help への契約追記。
- **集計はフルスキャン（5,000 行キャップ非適用）** — 「切った上での集計は
  嘘」の解消。**一覧のページングは v2 から明示的に外す**（テーブル/検索/
  kanban の UI 契約全体に波及するため別フェーズ。一覧は現行キャップ+warn
  のまま = ブラウズ用途としては誠実）。
- リモート（phone）ビューへのクエリ露出も別フェーズ。

### v3 以降（このプランのスコープ外、方向だけ記録）
- フォーマット追加: xlsx / json / parquet / sqlite（DuckDB 拡張で読める）。
- ネイティブコレクションへの昇格（取り込み）操作。
- メトリクス定義（セマンティックレイヤー）のワークスペース内ファイル化。

## Open questions / 注意

- **キー列の値が `safeRecordId` を通らない場合**（日本語名、スペース、記号）: 候補は
  (a) 行を落として warn、(b) エンコード（hex 化）した ID を使い表示は displayField、
  (c) キー列なし時は行ハッシュ。**(b) を推奨** — 日本語データ（生徒名簿等）が主要ユース
  ケースなので落とすのは論外、行番号はソートで壊れる。詳細ビュー URL の見た目は劣化するが
  displayField で吸収できる。
- **キー列の重複値**: DuckDB で `COUNT(*) GROUP BY key HAVING > 1` を discovery 時に検査し、
  重複があれば warn + 後勝ち（それとも discovery エラーにする?）。
- **ネイティブモジュール（DuckDB）の配布**: npm launcher（`npx mulmoclaude`）と Docker で
  prebuilt binary が落ちるか。落ちない環境向けに「dataSource コレクションだけ無効化して
  他は動く」graceful degradation にする（core 全体を巻き込まない dynamic import）。
  検証は v1 の受け入れ基準（DuckDB-CSV store の節を参照）。
- **derive / dynamicIcon との合流**: どちらも `listItems` 結果ベースなのでそのまま動く見込みだが、
  行数ガードと組み合わせたときの意味（5,000 行に切った上での集計は嘘になる）は v2 で整理。
- MulmoTerminal もコレクションデータを共有する（@mulmoclaude/core のバンプ・公開が必要 —
  version skew はクロスアプリのデータバグになる）。

## Out of scope（意図的に入れない）

- **UI からの書き込み**（CSV への UPDATE/INSERT）— read-only の割り切りが本プランの骨格。
  編集ニーズは「Claude にファイル編集を頼む」+ 将来の「ネイティブ昇格」で受ける。
- **外部 DB 接続**（Postgres/MySQL アタッチ）— DuckDB 拡張で技術的には可能だが、
  「workspace is the database」の外に真実の源を持つ話は別プランで。
- **チャートビルダー UI / ドリルダウン設計 UI** — BI ツールが「対話できない」ことの補償機能。
  会話 + custom view で代替するのが MulmoClaude の差別化。
- **ダッシュボードの共有/権限管理ポータル**。
