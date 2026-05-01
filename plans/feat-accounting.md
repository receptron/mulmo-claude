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
- **snapshots/** は月末締めの集計キャッシュ。月初に前月分を全 JSONL スキャンして書き出す。N 冊目を増やしたとき、snapshots を再生成すれば必ず journal から復元できる（snapshots は捨てて良いキャッシュ）。
- **config.json の `activeBookId`** は UI の「いまどの帳簿を見ているか」を保持。LLM 経由の `addEntry({bookId})` は明示の bookId が無ければ activeBook に書く。

## Domain modules

- `server/utils/files/accounting-io.ts` — 全 fs アクセスの単一窓口。
  - `readConfig()` / `writeConfig()`
  - `readAccounts(bookId)` / `writeAccounts(bookId, accounts)`
  - `appendJournal(bookId, entry)` ← `writeFileAtomic` で月ファイルに append（既存内容読み込み→ append→ atomic write）
  - `readJournal(bookId, period)`（period は "YYYY-MM" or 範囲）
  - `readSnapshot(bookId, period)` / `writeSnapshot(bookId, period, snapshot)`
  - 全 path は `WORKSPACE_PATHS.accounting` から組み立て（`server/workspace/paths.ts` に追加）。
- `server/accounting/journal.ts` — 仕訳の整合性検証（借方=貸方、勘定科目存在チェック、日付範囲）。
- `server/accounting/report.ts` — 残高試算表 / B/S / P/L / 勘定元帳の集計。snapshot を起点に、対象期間の JSONL を上から積む。

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
| `getReport` | `{bookId?, kind: "balance" \| "pl" \| "ledger", period, accountCode?}` | 集計結果を返す | コンパクト |

`bookId?` 省略時は `config.json.activeBookId` を使う。

LLM が呼び分ける指針は description で明示する：

- ユーザーが「家計簿開いて」「帳簿見せて」のような**閲覧 / 操作 UI を求めた**ら `openApp`。
- 「3 月の売上は？」「この仕訳を起こして」のような**特定の質問・操作**ならコンパクト系。AI が領収書画像を読んで仕訳化するような自動処理も `addEntry` 直叩き。

REST エンドポイント：`POST /api/accounting`（SSE は不要、JSON 同期で十分）。`server/api/routes/accounting.ts` を新設。**マウントされた `<AccountingApp>` は LLM を介さずこの REST を直接叩く**（タブ切替・フィルタ・仕訳入力など毎クリック）。MCP ツールの `manageAccounting` も内部的にはこの同じハンドラ群を呼ぶ薄いブリッジにする（ロジック重複を避ける）。

## Tool name registration

- `src/config/toolNames.ts` の `TOOL_NAMES` に `manageAccounting: "manageAccounting"` を追加。
- `src/tools/index.ts` にツール定義（description / schema / handler）を登録。
- `server/agent/mcp-server.ts` に MCP ブリッジを追加。
- **`src/config/roles.ts` の組み込み Role には追加しない**（ハード制約 1）。
- ただし `TOOL_NAMES` への登録自体は普通に行うので、カスタム Role 作成時の plugin-picker UI には自動的に並ぶ（ハード制約 4）。GUI からチェックを入れるか、`~/mulmoclaude/config/roles/accounting.json` を手書きするか、どちらの経路でも `availablePlugins: ["manageAccounting"]` を持つ Role を作れば Claude から呼べる。

## View — ツール結果レンダラー方式（ルート無し・フルアプリ）

会計 UI は専用ルートを持たず、`manageAccounting({action:"openApp"})` の戻り値を `dispatchResponse` 系の tool-result レンダラーが受け取って、canvas にフル機能の Vue コンポーネントをマウントする。`presentChart` / `presentSpreadsheet` と同じ枠で、こちらは「会計アプリ全体」を描く。

- **コンポーネント**：`src/components/AccountingApp.vue`（命名は「View」ではなく「App」、フル機能であることを示す）。サブコンポーネントは `src/components/accounting/` 配下にまとめる：
  - `AccountingApp.vue` — ルート、タブとヘッダー
  - `accounting/BookSwitcher.vue` — 帳簿スイッチャー（`[default ▼] + New book…`）
  - `accounting/JournalEntryForm.vue` — 仕訳入力
  - `accounting/JournalList.vue` — 仕訳一覧（期間フィルタ + 科目フィルタ）
  - `accounting/Ledger.vue` — 勘定元帳（科目ごとの T 字図 / 残高推移）
  - `accounting/BalanceSheet.vue` / `accounting/ProfitLoss.vue` — B/S / P/L サマリ
- **マウント経路**：`manageAccounting` の `openApp` action が、ツール結果として「accounting アプリを開け」というシリアライズ可能なペイロード（type 識別子 + 初期 props: `{bookId, initialTab}`）を返す。tool-result レンダラー（`presentChart` 等と同じ層）がそのペイロードの type を見て `<AccountingApp>` を `<Suspense>` でマウントする。
- **データ通信は直接 REST**：マウント後の `<AccountingApp>` は `apiPost("/api/accounting", { action, ... })` で `/api/accounting` を直接叩く。タブ切替・フィルタ変更・仕訳追加・残高再計算は LLM を介さない（ラウンドトリップ無し）。
- **状態管理**：ローカル状態は `<AccountingApp>` 内の reactive state。session を跨いだ「現在見ていた帳簿」は `config.json.activeBookId` をサーバ側に持つので、再度 `openApp` を呼んだときに自然に復元される。canvas の同じ tool-result が再レンダリングされても、サーバ状態から再構築できる（ローカル UI 状態は失われて良い）。
- **PluginLauncher の TARGETS には追加しない**（ハード制約 2）。**ルート登録もしない**（ハード制約 3）。`<AccountingApp>` は tool-result の文脈の外からはマウントされない。
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
  - snapshot ありとなしで集計結果が一致すること（snapshot を消しても再生成できる不変性の証明）。
- `multi-book.test.ts`
  - book A の仕訳は book B に漏れない。
  - `setActiveBook` 後に `bookId` 省略 API がそちらを向く。
  - `deleteBook` は最後の 1 冊では失敗。

### E2E (`yarn test:e2e`, Playwright)

- **隔離リグレッション**（default Role 環境で実行）：
  - PluginLauncher に accounting ボタンが**無いこと**を assertion。
  - `/accounting` への直接 navigate が**マッチしない**（ルートが存在しない）ことを assertion。
  - default Role のチャットから accounting に到達する手段が**無いこと**を確認（ツールが見えない）。
- **機能テスト**（カスタム Role を `e2e/fixtures/` で注入した環境で実行）：
  - チャットで「家計簿を開いて」相当のプロンプトを送る → `manageAccounting({action:"openApp"})` がモックで呼ばれる → `<AccountingApp>` が canvas にマウントされる。
  - マウントされたアプリ内で、帳簿作成 → 仕訳入力 → 一覧で確認 → B/S 表示の golden path。各操作が `/api/accounting` を直接叩いていること（LLM ラウンドトリップ無し）を network 観察で確認。
  - 帳簿スイッチャーで book を切替えると仕訳一覧が入れ替わる。
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

- [ ] `manageAccounting` ツール登録（toolNames / src/tools / mcp-server）— action 一覧に `openApp` を含む
- [ ] `/api/accounting` REST ルート + `accounting-io.ts` ドメインモジュール
- [ ] `WORKSPACE_PATHS.accounting` + 関連パス定数
- [ ] `<AccountingApp>` + サブコンポーネント一式（`src/components/accounting/`）
- [ ] tool-result レンダラーが `"accounting-app"` ペイロードを認識して `<AccountingApp>` をマウントする結線
- [ ] i18n 8 ロケール（`accounting.*` キー、launcher 用文字列は無し）
- [ ] Unit + E2E テスト一式（隔離リグレッション + 機能テストの両方）
- [ ] `docs/manual-testing.md` に試験運用手順
- [ ] `docs/ui-cheatsheet.md` に `<AccountingApp>` 区画を追加（GA 前でも、開発者向けに）。「ルート無し・tool-result 経由」の経路も明記。
- [ ] **隔離の再確認** — PR チェック項目として：
  - `git diff src/config/roles.ts` が空
  - `git diff src/components/PluginLauncher.vue` が空
  - `git diff src/App.vue` に `/accounting` ルート登録が無い

GA 化時（別 PR、試験運用後）：

- [ ] `/accounting` ルート登録（同じ `<AccountingApp>` を再マウント、tool-result 経路と並存）
- [ ] PluginLauncher TARGETS に追加 + i18n
- [ ] 適切な組み込み Role（個人会計向けに専用 Role 新設？ それとも general に追加？）に `manageAccounting` を入れる
- [ ] CHANGELOG エントリ
