# Plan: Accounting plugin (multi-book, file-system DB, opt-in only)

## Goal

複式簿記ベースの会計機能を MulmoClaude 上で動かす。データはファイルシステムに置き、API と View はプラグインとして提供する。

## Hard constraints (this is a testing rollout, not GA)

会計データは「壊れたらリカバリが大変」なので、十分にテストするまでは**標準機能としては表に出さない**。具体的には：

1. **デフォルト Role には追加しない** — `src/config/roles.ts` の `ROLES` 配列に登場する `general` / `office` / `news` 等、いずれの組み込み Role の `availablePlugins` にも `manageAccounting` を入れない。
2. **PluginLauncher（1列目のバー / 上部の toolbar）にボタンを追加しない** — `src/components/PluginLauncher.vue` の `TARGETS` 配列にも、`PluginLauncherTarget["key"]` の union にも `accounting` を入れない。i18n の `pluginLauncher.*` にも追加しない。
3. **専用ルートを持たない** — `/accounting` のような URL は作らない。App.vue / router にもエントリを追加しない。会計アプリへの唯一の入口は `manageAccounting` ツールの戻り値（後述「ツール結果レンダラー方式」）。これによってブラウザ URL を知っているだけでは到達不能になる。
4. **ユーザーが明示的にカスタム Role を作って `manageAccounting` を `availablePlugins` に入れたときだけ動く**。それ以外の経路では LLM もこのツールを呼べないし、UI からも見えない。
5. **カスタム Role の plugin-picker UI には `manageAccounting` を素直に出す** — 「試験中だから picker からも隠す」みたいな追加ガードは入れない。`TOOL_NAMES` に登録すれば `ALL_TOOL_NAMES` 経由で picker にも自動で並ぶ、その既定の挙動に乗る。試験運用したい開発者／早期ユーザーが、設定ファイル手書きでも picker GUI 経由でも、同じように `availablePlugins` に追加できる状態にする。

この設計の意図は「うっかり実運用で使われて壊れる」事態を防ぐこと。GA 化するときは (1)(2)(3) を解除すれば良い差分にする（ルートを足して同じコンポーネントを再マウントするだけ）。

## Single currency

最初は単一通貨。帳簿（book）ごとに通貨を持つが、跨いだ集計はやらない。多通貨は将来の独立フェーズ。

## Workspace layout

```text
~/mulmoclaude/data/accounting/
  config.json                    ← { activeBookId, books: [{id, name, currency, createdAt}] }
  books/
    default/                     ← デフォルトの 1 冊。N 冊目以降も同じ schema
      accounts.json              ← 勘定科目マスタ (chart of accounts)
      journal/
        YYYY-MM.jsonl            ← 月単位の仕訳 (append-only JSON Lines)
      snapshots/
        YYYY-MM.json             ← 月末締めキャッシュ（残高ロールアップ）
      meta.json                  ← 開設日 / 会計年度 / 補助メモ
    <other-book-id>/
      ...同じ構造
```

設計ポイント：

- **1 冊目から `books/default/` 配下に置く**。1 冊目だけ path schema が違うと、N 冊目を追加した瞬間にマイグレーションが要る。
- **journal は月単位 JSONL の append-only**。途中行を書き換えない（訂正は逆仕訳 + 訂正仕訳）。`writeFileAtomic` で全置換ではなく、append 用ヘルパを `server/utils/files/accounting-io.ts` に新設。
- **snapshots/** は月末締めの集計キャッシュ。月初に前月分を全 JSONL スキャンして書き出す。N 冊目を増やしたとき、snapshots を再生成すれば必ず journal から復元できる（snapshots は捨てて良いキャッシュ）。**過去への書き込み（後述の opening 修正、過去日付 `addEntry`、`voidEntry`）が起きたら、その日付以降のスナップショットを全削除し、次回 `getReport` 時に遅延再生成する**（後述「Snapshot cache invalidation」参照）。
- **config.json の `activeBookId`** は UI の「いまどの帳簿を見ているか」を保持。LLM 経由の `addEntry({bookId})` は明示の bookId が無ければ activeBook に書く。

## Domain modules

- `server/utils/files/accounting-io.ts` — 全 fs アクセスの単一窓口。
  - `readConfig()` / `writeConfig()`
  - `readAccounts(bookId)` / `writeAccounts(bookId, accounts)`
  - `appendJournal(bookId, entry)` ← `writeFileAtomic` で月ファイルに append（既存内容読み込み→ append→ atomic write）
  - `readJournal(bookId, period)`（period は "YYYY-MM" or 範囲）
  - `readSnapshot(bookId, period)` / `writeSnapshot(bookId, period, snapshot)` / **`invalidateSnapshotsFrom(bookId, fromPeriod)`**（`fromPeriod` 以降のスナップショットファイルを削除）
  - 全 path は `WORKSPACE_PATHS.accounting` から組み立て（`server/workspace/paths.ts` に追加）。
- `server/accounting/journal.ts` — 仕訳の整合性検証（借方=貸方、勘定科目存在チェック、日付範囲）。`kind: "opening"` の特別仕訳に対しては追加検証（B/S 科目限定、asOfDate 以前に他の仕訳が無いこと）。
- `server/accounting/openingBalances.ts` — 期首残高（opening balances）専用の処理：既存 opening の検出 / void / 新規 opening の append。書き込み後、`invalidateSnapshotsFrom(bookId, asOfMonth)` を呼ぶ。
- `server/accounting/snapshotCache.ts` — スナップショットの**非同期バックグラウンド再生成**と無効化制御。
  - `getOrBuildSnapshot(bookId, period)` ← 存在すれば返す、無ければ前月スナップショット + その月の journal から構築して書き出して返す（lazy fallback、後述）。
  - `scheduleRebuild(bookId, fromPeriod)` ← 書き込みハンドラから呼ばれる。in-process queue（`Map<bookId, Promise>`）で同一 book の rebuild を直列化し、各月完了ごとに `accountingBookChannel(bookId)` に `{kind: "snapshots-ready", period}` を publish。
  - 全書き込み系パス（`addEntry` / `voidEntry` / `setOpeningBalances` / `upsertAccount` で科目区分が変わるケース）は同期で `invalidateSnapshotsFrom` を呼んだ後、`scheduleRebuild` を発火して即時 return する。
- `server/accounting/eventPublisher.ts`（または既存の pub/sub 層を直接 import）— `accountingBookChannel(bookId)` / `PUBSUB_CHANNELS.accountingBooks` への publish ヘルパ。書き込みハンドラはここ経由で publish し、payload type を間違えないようにする。
- `server/accounting/report.ts` — 残高試算表 / B/S / P/L / 勘定元帳の集計。`snapshotCache.getOrBuildSnapshot` を起点に、対象期間の JSONL を上から積む。`kind: "opening"` エントリは B/S・元帳には自然に含まれるが、「アクティビティ一覧」「P/L」からはフラグで除外。

## Plugin API surface

新規 MCP ツール **`manageAccounting`** を 1 個追加。action discriminator で以下を捌く（`manageWiki` / `manageTodoList` と同じパターン）。戻り値は **2 系統** に分かれる：

- **アプリマウント系** — フル機能の `<AccountingApp>` を canvas に展開する指示を返す（後述「ツール結果レンダラー方式」）。
- **コンパクト結果系** — チャットターンに残る要約／確認メッセージを返す。

| action | 入力 | 効果 | 戻り値の種類 |
|---|---|---|---|
| `openApp` | `{bookId?, initialTab?}` | フル機能の会計アプリを canvas に展開 | アプリマウント |
| `listBooks` | — | `books[]` を返す | コンパクト |
| `createBook` | `{name, currency}` | 新しい book を作成し、初期 chart of accounts をコピー | コンパクト |
| `setActiveBook` | `{bookId}` | activeBookId を切替 | コンパクト |
| `deleteBook` | `{bookId, confirm: true}` | 帳簿削除（最後の 1 冊は不可、削除確認必須） | コンパクト |
| `listAccounts` | `{bookId?}` | 勘定科目一覧 | コンパクト |
| `upsertAccount` | `{bookId?, account}` | 勘定科目の追加/更新 | コンパクト |
| `addEntry` | `{bookId?, date, lines: [{accountCode, debit, credit, memo}]}` | 仕訳の追加（借方=貸方を検証） | コンパクト |
| `voidEntry` | `{bookId?, entryId, reason}` | 逆仕訳 + 元仕訳に void マークを追記（journal は append-only なので元行は残す） | コンパクト |
| `listEntries` | `{bookId?, from, to, accountCode?}` | 指定期間/科目の仕訳を返す | コンパクト |
| `getOpeningBalances` | `{bookId?}` | 現在設定されている期首残高を返す（未設定なら null） | コンパクト |
| `setOpeningBalances` | `{bookId?, asOfDate, balances: [{accountCode, debit?, credit?}]}` | 期首残高を設定（既存があれば void してから差し替え）。Σ借方 = Σ貸方を検証、B/S 科目（資産・負債・純資産）のみ参照可、`asOfDate` より前に他の仕訳が無いことを検証。`kind: "opening"` フラグ付き仕訳として journal に append。 | コンパクト |
| `getReport` | `{bookId?, kind: "balance" \| "pl" \| "ledger", period, accountCode?}` | 集計結果を返す | コンパクト |
| `rebuildSnapshots` | `{bookId?, from?}` | 管理用：`from` 月以降（省略時は全期間）のスナップショットを削除し、ゼロから再生成。journal を直接編集した後の手動リカバリ用。 | コンパクト |

`bookId?` 省略時は `config.json.activeBookId` を使う。

LLM が呼び分ける指針は description で明示する：

- ユーザーが「家計簿開いて」「帳簿見せて」のような**閲覧 / 操作 UI を求めた**ら `openApp`。
- 「3 月の売上は？」「この仕訳を起こして」のような**特定の質問・操作**ならコンパクト系。AI が領収書画像を読んで仕訳化するような自動処理も `addEntry` 直叩き。

REST エンドポイント：`POST /api/accounting`（SSE は不要、JSON 同期で十分）。`server/api/routes/accounting.ts` を新設。**マウントされた `<AccountingApp>` は LLM を介さずこの REST を直接叩く**（タブ切替・フィルタ・仕訳入力など毎クリック）。MCP ツールの `manageAccounting` も内部的にはこの同じハンドラ群を呼ぶ薄いブリッジにする（ロジック重複を避ける）。

## Opening balances（期首残高 / 引き継ぎ）

既存の帳簿から MulmoClaude に乗り換えるユーザーや、年の途中／月の途中から導入するユーザーは、過去の仕訳を全部入力するのではなく **「ある時点の B/S」だけを入力して始める**のが普通。これを期首残高として扱う。

設計方針：

- **journal に書き込む 1 件の特別仕訳として表現する**。別ファイル（`opening.json` 等）にしない。journal を唯一の真実とすることで、レポートロジックが分岐しない／履歴が append-only に残る。
- **エントリ形式**：`kind: "opening"`、`asOfDate` がそのまま entry.date。lines は B/S 科目のみ（資産・負債・純資産）。Σ借方 = Σ貸方を満たす必要があり、差額は初期 chart of accounts に含めておく「Retained Earnings」（または「Opening Balance Equity」）に吸収させる。
- **検証ルール**（`server/accounting/openingBalances.ts`）：
  - lines の各 accountCode が B/S 科目（type: "asset" / "liability" / "equity"）であること。損益科目は不可。
  - Σ借方 = Σ貸方。
  - `asOfDate` より前に既存の仕訳が一切無いこと（あれば「先に void してください」エラー）。
  - 既に `kind: "opening"` のエントリが存在する場合は、新規 `setOpeningBalances` 呼び出し時に既存をまず void してから差し替える（履歴は残る）。
- **修正フロー**：opening を直したいときは `setOpeningBalances` を再度呼ぶだけ。内部で「既存 opening を void → 新 opening を append → 当月以降の snapshot を invalidate」を 1 トランザクションで行う。
- **レポートでの扱い**：
  - **B/S**：opening エントリを含めて当然集計（それが始点）。
  - **P/L**：損益科目だけが対象なので opening は元々入らない。
  - **元帳 / アクティビティ一覧**：`kind: "opening"` フラグで「期首残高」として 1 行目に区別表示し、通常の仕訳と視覚的に分ける。

UI（`src/plugins/accounting/`）：

- `View.vue` のタブに「**期首残高**」を追加。
- `createBook` 直後に opening 未設定なら、`View.vue` トップに「期首残高を入力してください」のバナーを出し、ワンクリックで該当タブへ遷移。
- `components/OpeningBalancesForm.vue` を新設：B/S 科目を asset / liability / equity でグルーピング、各行に借方／貸方欄、リアルタイムにアンバランス額（Σ借方 - Σ貸方）を表示し、ゼロになるまで保存ボタン無効化。
- 保存時は `setOpeningBalances` を REST 直叩き。差し替えの場合は確認ダイアログ。

## Architecture principle: file system is truth, view is reactive

このプラグインの基本方針は MulmoClaude のアーキテクチャそのまま：

- **ファイルシステムが唯一の真実**。journal JSONL と `accounts.json` / `config.json` がそれ。snapshots/ はあくまでキャッシュ。
- **キャッシュの整合性管理は全てサーバ側**。書き込みに伴う無効化と非同期再生成は、書き込みを起こした API ハンドラの責務。View は一切関与しない。
- **View はサーバが返す現在のデータを描画するだけ**。ローカルでの楽観的更新（optimistic update）も、ローカルキャッシュ管理もしない。
- **変化は pub/sub で View に通知される**。View は購読し、通知を受けたら自分が表示中のデータだけ refetch する。これによってマルチウィンドウ・別プロセス・将来のリレー越しでも勝手に整合性が取れる。

既存の `presentHtml` / `markdown` の View が `useFileChange(filePath)` でファイル書き込みを購読しているのと同じ流儀。

### Pub/sub channels

`src/config/pubsubChannels.ts` に以下を追加：

```ts
/** "Some accounting data in this book changed — refetch what you're
 *  showing." One channel per book. Publishers: every write path in
 *  server/api/routes/accounting.ts (addEntry / voidEntry /
 *  setOpeningBalances / upsertAccount), plus the background snapshot
 *  rebuilder. Subscribers: src/plugins/accounting/View.vue (one
 *  subscription per mounted instance, scoped to the active bookId).
 */
export function accountingBookChannel(bookId: string): string {
  return `accounting:${bookId}`;
}

export interface AccountingBookChannelPayload {
  kind:
    | "journal"              // addEntry / voidEntry が走った
    | "opening"              // setOpeningBalances が走った
    | "accounts"             // upsertAccount が走った
    | "snapshots-rebuilding" // 過去無効化、バックグラウンド再構築開始
    | "snapshots-ready";     // 再構築完了
  period?: string; // YYYY-MM、関係する場合
}
```

加えて `PUBSUB_CHANNELS` に static で 1 本：

```ts
/** "The book list changed" — createBook / deleteBook / setActiveBook.
 *  Subscribers: BookSwitcher.vue (re-fetch dropdown contents). */
accountingBooks: "accounting:books",
```

### Snapshot cache invalidation（async, server-driven）

スナップショットはあくまで**キャッシュ**で、journal が単一の真実。過去への書き込みが起きたら、それ以降のキャッシュは無効化して**バックグラウンドで再生成**する。View はキャッシュの存在自体を気にしない。

書き込みハンドラの典型フロー：

1. **同期**: 入力検証 → journal append（atomic）→ `invalidateSnapshotsFrom(bookId, fromPeriod)` でスナップショットファイル削除 → `accountingBookChannel(bookId)` に `{kind: "journal" | "opening" | …, period}` を publish → ハンドラ即時 return。
2. **同期 publish**（無効化直後）: `{kind: "snapshots-rebuilding", period: fromPeriod}` を publish。View はこれを見て「集計が一時的にゆっくりかも」というインジケータを出すなら出す（出さなくてもいい）。
3. **非同期（background）**: 削除されたスナップショットを最古から順に再構築（前月スナップショット起点のインクリメンタル）→ 各月完了ごとに、または最終完了時に `{kind: "snapshots-ready", period: fromPeriod}` を publish。View はこれを受けて、現在表示中のレポート期間に該当すれば再 fetch。
4. **安全網（lazy fallback）**: もし View が rebuild 完了前に `getReport` を呼んでスナップショットが無ければ、サーバはその場で journal フルスキャンから集計して返す（遅いが必ず正しい）。バックグラウンド rebuild は別途進行し、完了したらキャッシュ書き出し。

無効化トリガ：

| 操作 | `fromPeriod` | publish する payload kind |
|---|---|---|
| `addEntry({date})` | `date` の月 | `journal` |
| `voidEntry` | 元仕訳の月 | `journal` |
| `setOpeningBalances({asOfDate})` | `asOfDate` の月（実質全期間） | `opening` |
| `upsertAccount` で科目区分（type）が変わる場合 | 当該科目が初登場した月（保守的に最古へ） | `accounts` |
| `rebuildSnapshots({from?})` | 明示の `from`（省略時は全期間） | `snapshots-rebuilding` → `snapshots-ready` |

実装の指針：

- **背景 rebuild の起動方式**：書き込みハンドラ内で `setImmediate` / `queueMicrotask` で発火する単純な in-process queue で十分。同一 bookId に対する rebuild は直列化（後の書き込みで上書きされた古い rebuild を無駄に走らせない）— `Map<bookId, Promise>` で「いま走っている rebuild」を追跡し、新規書き込みがあったら現行を待ってから次を起動、または現行を中断して新規で再起動する。
- **インクリメンタル構築**：前月スナップショットを起点に当月 journal を積む。前月も無ければ再帰的に最古へ遡る。最古まで無いケースは「空の B/S を起点に最古から積む」。
- **不変性の自己検証**（テスト）：snapshot ありのレポート結果と、snapshot を全部消してから取った結果が**バイト一致**すること。
- **管理ツール**：`rebuildSnapshots` action を MCP / REST で公開。journal を直接手で編集したケースや、開発中にロジックが変わってフォーマット差分が出たケースで使う。`View.vue` の設定タブにも「スナップショット再構築」ボタンを置く（試験運用フェーズのデバッグ用）。

### View 側の購読パターン

`View.vue` および各サブコンポーネント（`JournalList.vue` / `BalanceSheet.vue` / `Ledger.vue` 等）は、自分が表示しているデータが何の変化で動くかを宣言的に書く：

```ts
// View.vue 概念コード
const { activeBookId } = useAccountingState();
usePubSub(
  computed(() => accountingBookChannel(activeBookId.value)),
  (payload: AccountingBookChannelPayload) => {
    // 自分が表示中のタブ・期間に関係する変化だけ refetch
    if (payload.kind === "journal" || payload.kind === "snapshots-ready") {
      if (payload.period === currentPeriod.value) refetchReport();
      refetchJournalList();
    } else if (payload.kind === "opening") {
      refetchOpening();
      refetchReport(); // 全期間に影響
    } else if (payload.kind === "accounts") {
      refetchAccounts();
    }
    // "snapshots-rebuilding" は表示用フラグだけ立てる、実害無し
  },
);
```

`BookSwitcher.vue` は `PUBSUB_CHANNELS.accountingBooks` を購読して、ドロップダウンの中身を最新化。

ローカル編集中の入力フォーム（`JournalEntryForm.vue` / `OpeningBalancesForm.vue`）は購読しない（自分の入力が他からの通知で吹き飛ばされないよう）。submit 後はサーバから帰ってきた成功レスポンスでフォームを閉じ、購読側の View が pub/sub で更新を受け取る。

## Tool name registration

- `src/config/toolNames.ts` の `TOOL_NAMES` に `manageAccounting: "manageAccounting"` を追加。
- `src/tools/index.ts` にツール定義（description / schema / handler）を登録。
- `server/agent/mcp-server.ts` に MCP ブリッジを追加。
- **`src/config/roles.ts` の組み込み Role には追加しない**（ハード制約 1）。
- ただし `TOOL_NAMES` への登録自体は普通に行うので、カスタム Role 作成時の plugin-picker UI には自動的に並ぶ（ハード制約 4）。GUI からチェックを入れるか、`~/mulmoclaude/config/roles/accounting.json` を手書きするか、どちらの経路でも `availablePlugins: ["manageAccounting"]` を持つ Role を作れば Claude から呼べる。

## View — ツール結果レンダラー方式（ルート無し・フルアプリ）

会計 UI は専用ルートを持たず、`manageAccounting({action:"openApp"})` の戻り値を `dispatchResponse` 系の tool-result レンダラーが受け取って、canvas にフル機能の Vue コンポーネントをマウントする。`presentChart` / `presentSpreadsheet` と同じ枠で、こちらは「会計アプリ全体」を描く。

既存の `src/plugins/<name>/` 構造（`chart` / `spreadsheet` 等で採用）にそのまま乗る。各プラグインは `View.vue`（canvas 全面）と `Preview.vue`（チャットインライン）の 2 段構えを既に持っており、これが我々の「アプリマウント系 vs コンパクト結果系」と 1:1 で対応する。

- **配置**：`src/plugins/accounting/`
  - `definition.ts` — MCP ツール定義 / 入力 schema / Preview vs View の出し分けロジック
  - `index.ts` — プラグイン登録
  - `View.vue` — `openApp` の戻り値を受けたときのフル機能アプリ（タブ・帳簿スイッチャー・各サブビューを統括）
  - `Preview.vue` — `addEntry` / `getReport` 等のコンパクト結果のインライン描画
  - `components/` — サブコンポーネント
    - `BookSwitcher.vue` — 帳簿スイッチャー（`[default ▼] + New book…`）
    - `JournalEntryForm.vue` — 仕訳入力
    - `JournalList.vue` — 仕訳一覧（期間フィルタ + 科目フィルタ）
    - `OpeningBalancesForm.vue` — 期首残高入力（B/S 科目のみ、リアルタイム balance 検証）
    - `Ledger.vue` — 勘定元帳（科目ごとの T 字図 / 残高推移）
    - `BalanceSheet.vue` / `ProfitLoss.vue` — B/S / P/L サマリ
- **マウント経路**：`manageAccounting` の `openApp` action が、ツール結果として「accounting アプリを開け」というシリアライズ可能なペイロード（type 識別子 + 初期 props: `{bookId, initialTab}`）を返す。tool-result レンダラー（`presentChart` 等と同じ層）がそのペイロードの type を見て `View.vue` を `<Suspense>` でマウントする。コンパクト結果の戻り値は同じディスパッチで `Preview.vue` に流れる。
- **データ通信は直接 REST**：マウント後の `View.vue` は `apiPost("/api/accounting", { action, ... })` で `/api/accounting` を直接叩く。タブ切替・フィルタ変更・仕訳追加・残高再計算は LLM を介さない（ラウンドトリップ無し）。
- **データの真実はファイルシステム、変化は pub/sub で知る**：View は楽観的更新もローカルキャッシュ管理もしない。サーバが書き込み後に `accountingBookChannel(bookId)` に publish し、View は `usePubSub` で購読して該当データだけ refetch する（後述「Architecture principle」セクション参照）。
- **状態管理**：UI 状態（現在のタブ・フィルタ・スクロール位置）だけが View 内の reactive state。データ自体はサーバから取ったものをそのまま描画する。session を跨いだ「現在見ていた帳簿」は `config.json.activeBookId` をサーバ側に持つので、再度 `openApp` を呼んだときに自然に復元される。canvas の同じ tool-result が再レンダリングされても、サーバ状態から再構築できる（ローカル UI 状態は失われて良い）。
- **PluginLauncher の TARGETS には追加しない**（ハード制約 2）。**ルート登録もしない**（ハード制約 3）。`View.vue` は tool-result の文脈の外からはマウントされない。
- **i18n**：`src/lang/en.ts` に `accounting.*` のキー（タブ名、フォームラベル、エラー文言、確認ダイアログ等）を追加し、**8 ロケール全部**に同じキーを入れる（CLAUDE.md の i18n ルール）。Launcher 用文字列は不要（ボタン無し、ルート無し）。

### LLM 経由 vs UI 直接の責務分担

| 操作 | 経路 |
|---|---|
| アプリを開く | LLM → `openApp` → アプリマウント |
| アプリ内のタブ切替・フィルタ操作・閲覧 | UI → `/api/accounting` 直接 |
| アプリ内の仕訳手入力 / 帳簿作成 / 削除 | UI → `/api/accounting` 直接 |
| 「3 月の売上は？」のような単発質問 | LLM → `getReport` （アプリは開かない） |
| 「この領収書から仕訳起こして」 | LLM → `addEntry`（コンパクト確認のみ、または続けて `openApp`） |
| AI に任せる集計・要約・カテゴリ分類 | LLM 主導、必要なら結果を踏まえて `openApp` |

## Centralized constants additions

- `server/workspace/paths.ts` に `WORKSPACE_PATHS.accounting` / `WORKSPACE_DIRS.accountingBooks` などを追加。raw string concat 禁止（CLAUDE.md ルール）。
- `src/config/apiRoutes.ts` の `API_ROUTES` に `accounting: "/api/accounting"` を追加（REST エンドポイントの定数）。**UI ルート（router の path）は追加しない**（ハード制約 3）。
- `src/config/pubsubChannels.ts` に `accountingBookChannel(bookId)` ファクトリと `AccountingBookChannelPayload` 型、および `PUBSUB_CHANNELS.accountingBooks` static を追加（既存の `fileChannel` / `sessionChannel` と同パターン）。
- ツール結果レンダラーが識別する payload type（例: `"accounting-app"`）を `src/types/toolResults.ts`（または既存のレンダラー判定箇所）に登録。type は `as const` で集中管理し、生文字列の散在を防ぐ。
- 時間定数は使用箇所が出たら `server/utils/time.ts` から import。

## Testing strategy（最重要）

会計データは「黙って壊れる」のが一番怖いので、テストファースト気味に書く。

### Unit tests (`yarn test`, node:test)

- `accounting-io.test.ts`
  - 空 workspace → `listBooks` で空配列、`createBook` で `default` が物理的にできる。
  - `appendJournal` を 100 連発してファイル破損しないこと（`writeFileAtomic` 経由を確認）。
  - 不正 JSON が混じったら読み込み時に該当行を skip + 警告ログ（壊れた 1 行で全停止しない）。
- `journal.test.ts`
  - 借方≠貸方の仕訳は reject。
  - 存在しない勘定コードは reject。
  - `voidEntry` 後に `listEntries` で元仕訳が「void フラグ付きで」見えること、`getReport` の集計から除外されること。
- `report.test.ts`
  - 既知の仕訳セット → 期待される B/S / P/L / 元帳残高（黄金マスタ的に小さい fixture を `test/fixtures/accounting/` に置く）。
  - snapshot ありとなしで集計結果が**バイト一致**すること（snapshot を消しても再生成できる不変性の証明）。
- `openingBalances.test.ts`
  - 損益科目を含む opening は reject。
  - Σ借方 ≠ Σ貸方 の opening は reject。
  - `asOfDate` より前に既存仕訳があると reject。
  - 既存 opening を `setOpeningBalances` で差し替えると、元 opening が void になり新 opening が当該月に append され、両方が `listEntries` から（void フラグ付きで）見える。
  - opening 設定後の B/S が期首残高を始点にした値を返す。
- `snapshotCache.test.ts`
  - 過去日付 `addEntry` → 該当月以降のスナップショットファイルが**同期で**消える。
  - バックグラウンド rebuild が完走して、該当月以降のスナップショットファイルが書き戻る。
  - rebuild 完走前に `getReport` を呼ぶと lazy fallback（journal フルスキャン）で正しい結果が返る。
  - `setOpeningBalances` 差し替え → 全期間のスナップショットが一旦消え、rebuild 後に書き戻る。
  - `voidEntry` → 元仕訳の月以降のスナップショットが消える / 戻る。
  - `rebuildSnapshots({from})` で明示再構築できる。
  - 同一 bookId に書き込みが連発しても rebuild が直列化される（Promise キュー検証）。
- `eventPublisher.test.ts`
  - `addEntry` 後に `accountingBookChannel(bookId)` に `{kind: "journal", period}` が 1 回だけ publish される。
  - rebuild 完走後に `{kind: "snapshots-ready", period}` が publish される。
  - `setOpeningBalances` で `{kind: "opening"}` と `{kind: "snapshots-rebuilding"}` の順序を検証。
  - `createBook` で `PUBSUB_CHANNELS.accountingBooks` に publish されること。
- `multi-book.test.ts`
  - book A の仕訳は book B に漏れない（snapshot キャッシュも独立）。
  - `setActiveBook` 後に `bookId` 省略 API がそちらを向く。
  - `deleteBook` は最後の 1 冊では失敗。

### E2E (`yarn test:e2e`, Playwright)

- **隔離リグレッション**（default Role 環境で実行）：
  - PluginLauncher に accounting ボタンが**無いこと**を assertion。
  - `/accounting` への直接 navigate が**マッチしない**（ルートが存在しない）ことを assertion。
  - default Role のチャットから accounting に到達する手段が**無いこと**を確認（ツールが見えない）。
- **機能テスト**（カスタム Role を `e2e/fixtures/` で注入した環境で実行）：
  - チャットで「家計簿を開いて」相当のプロンプトを送る → `manageAccounting({action:"openApp"})` がモックで呼ばれる → `<AccountingApp>` が canvas にマウントされる。
  - マウントされたアプリ内で、帳簿作成 → 期首残高入力（OpeningBalancesForm が balance 0 まで保存ボタン無効）→ 仕訳入力 → 一覧で確認 → B/S 表示の golden path。各操作が `/api/accounting` を直接叩いていること（LLM ラウンドトリップ無し）を network 観察で確認。
  - 帳簿スイッチャーで book を切替えると仕訳一覧が入れ替わる。
  - **Pub/sub 反映**：仕訳を追加すると、（手動 refetch 操作なしに）pub/sub 経由で B/S と仕訳一覧が自動更新される。サーバ側からテスト用に直接書き込んでも同様に更新される（マルチライター想定）。
  - 期首残高を一度入れた後に修正 → 再度同じ画面に戻ると新しい opening の値が出る（古い値が残らない）。
  - チャットで「先月の売上は？」相当のプロンプトを送る → `getReport` のコンパクト結果がチャットに inline 表示される（アプリは開かない）。

### Manual / soak

- `docs/manual-testing.md` に「accounting プラグインの試験運用手順」を追記。1〜2 ヶ月、開発者が個人帳簿で実運用してみる期間を取る。GA 化（デフォルト Role 追加 + launcher ボタン）はそれを通過してから。

## Out of scope (this PR / phase)

- 多通貨 / 為替評価
- 税計算 / 消費税区分
- 外部会計ソフト（freee / MFクラウド / QuickBooks）連携・インポート
- レポートの PDF / Excel 出力（最初は画面表示と JSON のみ）
- 監査ログの暗号署名（必要になったらフェーズ 2）
- 銀行明細の取り込み・自動仕訳

## Rollout checklist

PR landing 時：

- [ ] `manageAccounting` ツール登録（toolNames / src/tools / mcp-server）— action 一覧に `openApp` / `setOpeningBalances` / `getOpeningBalances` / `rebuildSnapshots` を含む
- [ ] `/api/accounting` REST ルート + `accounting-io.ts` ドメインモジュール（`invalidateSnapshotsFrom` 含む）
- [ ] `server/accounting/{journal,openingBalances,snapshotCache,report,eventPublisher}.ts`
- [ ] `WORKSPACE_PATHS.accounting` + 関連パス定数
- [ ] `src/config/pubsubChannels.ts` に `accountingBookChannel(bookId)` + payload 型 + `PUBSUB_CHANNELS.accountingBooks` を追加
- [ ] `src/plugins/accounting/{definition,index,View,Preview}.vue` + `components/` サブコンポーネント一式（`OpeningBalancesForm.vue` 含む）。View 側は `usePubSub` 購読で refetch、楽観的更新は禁止。
- [ ] tool-result レンダラーが `"accounting-app"` ペイロードを認識して `View.vue` をマウントする結線（既存の plugin 登録パターンに乗る）
- [ ] i18n 8 ロケール（`accounting.*` キー、launcher 用文字列は無し）
- [ ] Unit + E2E テスト一式（隔離リグレッション + 機能テスト + opening + snapshot invalidation + pub/sub 反映）
- [ ] `docs/manual-testing.md` に試験運用手順
- [ ] `docs/ui-cheatsheet.md` に accounting プラグインの `View.vue` 区画を追加（GA 前でも、開発者向けに）。「ルート無し・tool-result 経由」の経路も明記。
- [ ] **隔離の再確認** — PR チェック項目として：
  - `git diff src/config/roles.ts` が空
  - `git diff src/components/PluginLauncher.vue` が空
  - `git diff src/App.vue` に `/accounting` ルート登録が無い

GA 化時（別 PR、試験運用後）：

- [ ] `/accounting` ルート登録（同じ `src/plugins/accounting/View.vue` を再マウント、tool-result 経路と並存）
- [ ] PluginLauncher TARGETS に追加 + i18n
- [ ] 適切な組み込み Role（個人会計向けに専用 Role 新設？ それとも general に追加？）に `manageAccounting` を入れる
- [ ] CHANGELOG エントリ
