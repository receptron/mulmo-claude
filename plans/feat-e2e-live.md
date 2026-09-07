# feat: e2e-live — 実 LLM を叩く総合テスト skill 群

## 🔝 最優先方針 (2026-05-30): L-JOURNEY-* (主要機能の正常系 user journey) を最優先で埋める

> 詳細仕様は §「未確定事項 / TODO (active)」 の **L-JOURNEY-*** エントリ、 進捗は §「実装ステータス」 を参照。 ここは着手順を決める起点としての宣言。

`L-HAPPY-TOUR` は各 View / route が **mount するか (壊れていないか)** までしか見ておらず、 「**この機能が実際に動く** (setup → 副作用 → UI / disk への反映が観測できる)」 を end-to-end で確かめるネットが各機能に 1 本ずつ要る。 これを **L-JOURNEY-\<feature\>** として最優先で埋める。

**設計原則 — e2e-live の journey は「LLM 経由 add」を優先する**:

- e2e-live の存在意義は **実 LLM dispatch 経路の検証**。 UI ボタンをクリックするだけの add → 反映テストは mock e2e でも書けるので、 e2e-live では **たとえ UI に add ボタンがあっても、 add を chat (実 LLM) からツール dispatch させる経路を優先**して組む。
- 具体形: chat で「〜を追加して」 と指示 → role-gate された manage 系ツール (`manageTodoList` / `manageCalendar` / `manageAccounting` 等) が dispatch → その mutation が **View に反映される** ところまで観測 → edit / delete の lifecycle を UI or LLM で踏む → reload で永続化を確認。
- 純 UI add 版 (例: 既存 `L-JOURNEY-TODO`) も価値はあるが、 これは下層 (mock e2e) と被るため **LLM add 版を上に積む**。

**今回バッチ (2026-05-30) で実装するもの** — いずれも LLM add 起点:

| journey | role / tool | add 経路 | lifecycle |
|---|---|---|---|
| **L-JOURNEY-CAL** | Personal / `manageCalendar` | LLM「〜にイベント追加」 | grid に反映 → delete |
| **L-JOURNEY-ACCT** | Accounting / `manageAccounting` | LLM「帳簿作成 / 仕訳追加」 | UI に反映 → report 描画 |
| **L-JOURNEY-TODO-LLM** | Personal / `manageTodoList` | LLM「todo 追加」 | `/todos` card に反映 → check → reload |

**今回バッチの follow-up (個別 PR で実装)** — **LLM-add 可否は機能ごとに異なる** ので個別に記録する (詳細 cover 表は §「未確定事項 / TODO (active)」 の L-JOURNEY-* 表):

- **L-JOURNEY-COLLECTION** — ✅ **実装済** (journey-llm.spec.ts、 後続 PR)。 当初は「`presentCollection` (slug 指定) で inline 編集カードを mount」 を想定していたが、 実機確認の結果 **collection には add 用の manage* ツールが無い** ことが判明 — `presentCollection` は表示専用 (`collectionSlug` + optional `itemId`)。 add は **mc-clients preset skill** が agent に「id を derive して `data/clients/items/<id>.json` を `Write`」 と指示する **skill 駆動の file-write**。 よって本 journey は manage* dispatch 系と違う経路 (skill が workspace JSON を書く → host の `<CollectionView>` が同ファイルを読んで描画) を初めて net する。 形: Personal role で chat → mc-clients skill で client add → `/collections/mc-clients` (standalone route) の `collections-row-*` が marker (name) で visible → UI delete (`collections-row` → `collections-detail` → `collections-detail-remove` → ConfirmModal `host-confirm-ok`) → row 消失。 必要 testid は全て既存 (source 変更なし)。
- **L-JOURNEY-ROLE** — ✅ **実装済** (journey-llm.spec.ts、 後続 PR)。 `manageRoles` はどの built-in role の `availablePlugins` にも無く LLM dispatch 不可なので **UI-add journey として割り切った**。 ただし create-form を Playwright で driving するのは pure-UI → REST で **mock e2e 領域** (LLM 不要) — e2e-live の価値は「**workspace 定義の custom role が live selector に出現し、 実 LLM ターンを回し、 削除できる**」点 (built-in role しか踏まない既存 roles.spec.ts (L-06〜L-09) の gap)。 そこで create / delete は form ではなく **`POST /api/roles/manage` を authed で叩く** deterministic な setup/teardown とし (新 helper `postAuthedJsonViaPage`)、 test 本体は selector 反映 + 実 LLM ターンに集中。 形: REST で custom role 作成 → `setupRoleSession(page, customId)` で切替 (= `role-option-<id>` クリック + `data-role` assert なので selector 反映 net 兼任) → 「greeting を返して」 で実 LLM 1 ターン → REST delete → `GET /api/roles` で id 消失を fail-closed poll (selector は transient chrome なので source-of-truth で確認、 L-JOURNEY-ACCT と同思想)。 testid 追加なし。 残: create-form 自体の UI 回帰は mock `e2e/` 側で別途張れる。
- **L-JOURNEY-SOURCE / -NEWS** — `manageSource` も role-gate 無し。 加えて RSS fetch は外部ネット依存で flake リスクが高い。 別途インフラを整えてから。

## 背景

直近 1 ヶ月の内部バグ報告約 50 件（Appendix 参照）から、**実 LLM を通さないと検出できない回帰**が複数発生していることが判明した。特に B-18（path-traversal 副作用による presentHtml の画像 404）は影響が大きく、PDF DL や mulmoScript 動画 DL でも同根の不具合が発生。

既存の `e2e/` は `mockAllApis(page)` 前提の mock ベースで、実 LLM 経路の検証はゼロ。

調査結果（2026-04-29）:

| 領域 | カバー状況 |
|---|---|
| Files View 画像 (B-17) | ✅ `files-html-preview.spec.ts` |
| **presentHtml 画像 (B-18)** | ❌ **未カバー** |
| **画像入り PDF DL (B-19/20)** | ❌ **未カバー** |
| **mulmoScript 動画 DL (B-21)** | ❌ **未カバー** |
| 各ロール sample query (B-15/41) | ❌ 未カバー |
| Wiki 内部リンク (B-23〜26) | 部分（一部 e2e あり） |
| Docker 環境特有のバグ (B-01〜08) | ❌ 未カバー |

→ 実 LLM 経路を通す **e2e-live** スイートを新規構築する。

## ゴール

- `/e2e-live` skill 1 発で全シナリオ実行 → 結果サマリ Markdown 出力
- カテゴリ単位 `/e2e-live-<category>` で部分実行可能
- リリース前ではなく **定期手動実行**（開発スピードが速いため、リリース直前検出だと PR 特定が困難）
- 既存 `e2e/`（mock）と完全に棲み分け
- **QA 担当者が画面で動作を見られる**（headed mode + slowMo）

## 既存 e2e との棲み分け

| 項目 | `e2e/` (mock) | `e2e-live/` (real) |
|---|---|---|
| API | `mockAllApis(page)` で全モック | 実 Claude API + 実ファイル I/O |
| 用途 | UI ロジック・ルーティング・状態管理・ガード | 生成系・E2E 経路・LLM 応答品質 |
| 実行頻度 | CI（毎 PR） | 手動・定期（週次想定） |
| 実行環境 | headless | **通常**: headless / **デバッグ**: `HEADED=1` で headed |
| 失敗時の確認 | trace なし | trace + video + HTML レポートで動画リプレイ |
| 出力先 | `test-results/`, `playwright-report/` | `test-results-live/`, `playwright-report-live/`（共に gitignore） |
| 実行時間 | 数十秒 | 数分〜数十分 |
| timeout | 短（30s） | 長（生成系で 5 分） |
| trigger | `yarn test:e2e` | `yarn test:e2e:live` or `/e2e-live` skill |

## 機能別 unit test / mock e2e との分担

e2e-live にシナリオを追加する前に、 まず以下の 2 層で取れないか確認する。 「実 LLM を通さないと検出できない」 ものだけが e2e-live の責務。

| 層 | 場所 | カバー範囲 | e2e-live を選ぶべきでないケース |
|---|---|---|---|
| **機能別 unit test** | `test/<feature>/` (agent / api / chat-index / news / plugins / roles / routes / skills / sources / system / tool-trace / tools / utils / wiki-backlinks / workspace 等) | 純粋関数 / route handler / config builder / parser / validator。 input → output が決定論的なもの | サーバ起動を伴わない単体ロジック検証は **すべてここ** に乗せる |
| **mock e2e** | `e2e/tests/*.spec.ts` (50+ spec、 `mockAllApis(page)` 前提) | UI ロジック / ルーティング / ガード / localStorage / DOM 状態遷移 / plugin View の seeded fixture mount。 LLM 応答は mock | UI 検証は **基本ここ**、 実 LLM の答えを見る必要がない限り |
| **e2e-live** | `e2e-live/tests/*.spec.ts` | LLM dispatch 経路 / Claude CLI 認証 / Docker sandbox / preset skill 実走 / 多 plugin tool selection / 実生成 (画像 / 動画 / PDF) | — |

**e2e-live に乗せて良い基準**:

- mock e2e で再現できない: 実 LLM の dispatch を経由しないと検出できない経路
- unit test で再現できない: サーバ起動 + 実ファイル I/O + 認証 + (場合により) Docker sandbox の組合せ
- 「LLM が convention 違反した時に検出する」 タイプ (例: L-01 self-repair guard、 L-18 i18n raw key)

**e2e-live に乗せるべきでないもの** (典型的な誤判断パターン):

- 関数の純粋 logic 退行 → unit test
- UI の DOM 状態遷移 / router guard → mock e2e
- backend HTTP route の status code / body shape → integration test (`test/api/`)
- 既に fix された crash の 「再発しないこと」 を見る tautology — 修正済 PR の unit test cover で十分 (L-29 が該当 — 「未実装シナリオの再評価」 参照)

### 規律: バグ軸ではなく能力軸で増やす

e2e-live は放っておくと **「内部バグ ID → L-XX」 1:1 写像** で線形に肥大する (現状 30 シナリオ → バグが報告されるたびに +1 増える非対称)。 これを避けるために、 シナリオは **2 つの軸** で分類して扱う:

| 軸 | 性質 | 増え方 | 例 |
|---|---|---|---|
| **能力軸 (capability)** | 製品が持つ機能境界に対応 (実 LLM dispatch / Docker sandbox / preset skill chain / 実生成 / first-run UX) | 製品の機能境界が増えた時のみ → **天井あり** | L-FRESH-BOOT, L-HAPPY-TOUR, L-21 系 (deferred-tool dispatch) |
| **バグ軸 (regression)** | 過去の具体的バグ ID をピン留め | バグ数だけ増える → **天井なし** | L-LINKIFY-CODESPAN, L-SETTINGS-EFFORT 等の個別 ID |

**運用ルール**:

1. 新しいバグが来たら、 まず **下層 (unit / mock e2e / integration) で取れないか** 確認する (上記判定フロー)。 e2e-live は最終手段
2. やむを得ず e2e-live に乗せる場合も、 **既存の能力軸シナリオの assertion を 1 行足すだけで済まないか** を先に検討する (例: happy-tour で同じ View を踏んでいるなら、 そこに assertion を足す)
3. それでも独立 spec が必要なら L-XX として追加。 ただし **「未実装シナリオ詳細」 セクションの定型 metadata 行** (重要度 / Docker / 画像 と並べて) に **`軸: 能力 / バグ`** を必ず明記する。 既存 30+ シナリオの retro 付与は行わない (新規追加分から ratchet)
4. バグ軸シナリオは **降格候補** として扱い、 後から下層で同等 cover ができたら e2e-live から外す (`/audit-e2e-live` 構想 — 「未確定事項 / TODO」 参照)

**wall-time budget**: `/e2e-live` 全実行を **30 分以内** に収めることを hard constraint とする。 越えそうになったら追加時に降格 / 統合 / drop を検討する義務が生じる (= 圧力として効かせる)。

## ディレクトリ構造

```text
e2e-live/
  fixtures/
    live-chat.ts            ← 実 chat fixture（mockAllApis を使わない）
    images/
      sample.png            ← src/assets/mulmo_bw.png のコピー（L-01 が workspace に配置。 L-02 は textResponse 経由で workspace 配置不要）
  tests/
    media.spec.ts           ← 画像/PDF/動画（L-01 / L-02 実装済）
    roles.spec.ts           ← ロール別 sample query（未実装）
    session.spec.ts         ← セッション/履歴（未実装）
    wiki.spec.ts            ← Wiki/Router（未実装）
    ui.spec.ts              ← UI/通知/プラグイン（L-17 / L-18 / L-19 / L-20 実装済）
    skills.spec.ts          ← Skill/Tool（未実装）
    docker.spec.ts          ← Docker 環境特有のバグ検証（未実装）
  playwright.config.ts      ← 別 config（headless 既定 + HEADED=1、 workers=3 + parallel、 trace 常時）

.claude/skills/
  e2e-live/SKILL.md           ← 親（全カテゴリ実行）
  e2e-live-media/SKILL.md
  e2e-live-roles/SKILL.md
  e2e-live-session/SKILL.md
  e2e-live-wiki/SKILL.md
  e2e-live-ui/SKILL.md
  e2e-live-skills/SKILL.md
  e2e-live-docker/SKILL.md    ← Docker 環境特有
```

## skill 一覧と対応 spec

| skill | spec | テスト数 | カバーする内部バグ ID |
|---|---|---|---|
| `/e2e-live` | 全 spec | 30 | 全部 |
| `/e2e-live-media` | media.spec.ts | 5 | B-17, B-18, B-19, B-20, B-21, B-46 |
| `/e2e-live-roles` | roles.spec.ts | 5 | B-15, B-41 |
| `/e2e-live-session` | session.spec.ts | 3 | B-13, B-14, B-16 |
| `/e2e-live-wiki` | wiki.spec.ts | 7 | B-23〜B-27, #1297 |
| `/e2e-live-ui` | ui.spec.ts | 4 | B-30, B-31, B-34, B-50 |
| `/e2e-live-skills` | skills.spec.ts | 4 | B-08, B-22, B-41, post-#1298 bridge |
| `/e2e-live-docker` | docker.spec.ts | 8 (うち 2 は L4) | B-01〜B-08 |

## Docker 依存度フラグ（凡例）

各シナリオに以下のフラグを付ける：

| フラグ | 意味 |
|---|---|
| `both` | Docker on / off のどちらでも動くべき（大半） |
| `docker-only` | Docker サンドボックス起動状態でしか発生しないバグの検証 |
| `manual-l4` | 自動化困難（OS 依存等）、人手チェックリストへ |

## シナリオ一覧 (索引)

全シナリオ ID + タイトル + 状態の俯瞰用。 実装済シナリオの **初期設計仕様** は [`plans/done/feat-e2e-live-history.md`](done/feat-e2e-live-history.md) の 「設計仕様 archive」、 **実装結果の詳細** (採用 assertion / helper / 罠) は 「実装ステータス」 表もしくは spec ファイル本体が正規ソース。 未実装シナリオの設計詳細は次セクション 「未実装シナリオ詳細」 を参照。

| ID | カテゴリ | タイトル | 状態 |
|---|---|---|---|
| L-01 | media | presentHtml の画像が描画される ★最重要 | ✅ |
| L-02 | media | Markdown 応答を PDF DL | ✅ |
| L-03 | media | mulmoScript 生成 → 動画 DL 成功 | ✅ |
| L-04 | media | mulmoScript animation:true で映像生成失敗しない | ✅ |
| L-05 | media | generateImage プラグインで実画像が返る | ✅ |
| L-06 | roles | General ロールで sample query → 完走 | ✅ |
| L-07 | roles | Office ロールで sample query → 完走 | ✅ |
| L-08 | roles | Tutor ロールで sample query → 完走 | ✅ |
| L-09 | roles | Storyteller ロールで sample query → 完走 | ✅ |
| L-10 | roles | Gemini key 未設定でも General が disabled にならない | 未実装 |
| L-11 | session | 新規セッション → 1 ターン → reload → 履歴復元 | ✅ |
| L-12 | session | 古いセッションを resume → LLM が文脈保持 | ✅ |
| L-13 | session | サーバ再起動後も bridge が再接続できる | 未実装 |
| L-14 | wiki | Wiki ページ生成 → 内部リンクを踏める | ✅ |
| L-15 | wiki | 日本語タイトルの Wiki ページ → URL slug が壊れない | ✅ |
| L-16 | wiki | Wiki index から各ページへのリンクが機能 | ✅ |
| L-WIKI-PIPE | wiki | `[[slug\|alias]]` クリック後 URL 清浄性 | ✅ |
| L-WIKI-LINT-PIPE-CLEAN | wiki | lint レポートで `[[slug\|alias]]` が broken link に出ない | ✅ |
| L-WIKI-LINT-EMPTY-TARGET | wiki | lint レポートで `[[\|alias]]` が "empty target" 診断 | ✅ |
| L-WIKI-LINT-NON-ASCII | wiki | lint レポートで bare `[[日本語]]` が `<題名>.md not found` 診断 (#2940) | ✅ |
| L-WIKI-LINT-BROKEN | wiki | lint レポートで `[[bogus-slug]]` が broken link 診断 | ✅ |
| L-WIKI-LINT-ORPHAN | wiki | lint レポートで index 不在 page が orphan 診断 | ✅ |
| L-WIKI-LINT-MISSING | wiki | lint レポートで index 参照不在 file が missing 診断 | ✅ |
| L-WIKI-LINT-TAG-DRIFT | wiki | lint レポートで frontmatter / index tag drift 診断 | ✅ |
| L-17 | ui | bridge-origin agent run はベルバッジを点灯させない (B-50) | ✅ |
| L-18 | ui | presentForm 表示時に i18n キーが直接出ない | ✅ |
| L-19 | ui | stack-rehydrate on reload (元 Tool Call History reload を発展) | ✅ |
| L-20 | ui | Files view `/files?path=` → `/files/` rewrite | ✅ |
| L-21 | skills | chart deferred-tool dispatch | ✅ |
| L-21B | skills | encore defineEncore deferred-tool dispatch (#1437 / #1440 / #1441 / #1443) | ✅ |
| L-22 | skills | 自作 skill end-to-end 実行 (B-08) | ✅ |
| L-23 | docker | X MCP が Docker 内で .env から key を読める | ✅ |
| L-24 | docker | `yarn sandbox:login` 前に image build (plan 再定義要) | 廃止 (L-FRESH-SANDBOX-BUILD に統合) |
| L-25 | docker | sandbox 内ファイル所有者 non-root (Linux のみ) | manual-l4 |
| L-26 | docker | Docker sandbox 上で session resume できる | ✅ |
| L-27 | docker | Mac keychain credential 渡し (macOS のみ) | manual-l4 |
| L-28 | docker | Docker 内で git/gh 認証通る | ✅ |
| L-29 | docker | Docker 環境で MCP server crash しない | 対象外推奨 |
| L-30 | docker | skill symlink が Docker 内で dangling にならない | ✅ |
| L-31 | skills | mc-manage-skills bridge dispatch canary (post-#1298) | ✅ |
| L-32 | skills | end-to-end skill landing + Run canary (post-#1298) | ✅ |
| L-EDIT | mulmo | beat 編集永続化 (#1074) | ✅ |
| L-LINKIFY-CODESPAN | wiki/files | inline-code workspace path auto-linkify (#1300) | ✅ |
| L-SETTINGS-EFFORT | settings | Settings → Model effortLevel 双方向同期 (#1323) | ✅ |
| L-SETTINGS-EFFORT-SPAWN | settings | settings.json → claude `--effort` 引数到達 (#1323) | ✅ |
| L-W-S-03 | wiki | `<picture><source srcset>` rewriter (#1275) | ✅ |
| L-FRESH-BOOT | fresh-user | 新規ユーザー: 空 workspace + 空 HOME から起動して 1 ターン完走 | ✅ |
| L-FRESH-SANDBOX-BUILD | fresh-user | 新規ユーザー: sandbox image 不在から auto-build 経由で起動 | 未実装 |
| L-FRESH-PRESET-SKILL | fresh-user | 新規ユーザー: preset skill が catalog → `.claude/skills/` に bridge mirror | 未実装 |
| L-HAPPY-TOUR | happy-tour | 主要 View / route を一通り踏んで 「壊れていない」 を確認する正常系 sweep | ✅ 実装済 (happy-tour.spec.ts) |
| L-GCAL-01〜08 | google | Collection → Google Calendar push を実カレンダーで検証 (#2602) | ✅ 実装済 (calendar-push.spec.ts) |

> `L-GCAL-*` は LLM もブラウザも使わない第三のカテゴリ。 実 Google の OAuth grant と
> 使い捨てカレンダー id (`E2E_LIVE_GOOGLE_CALENDAR_ID`) が要り、 無ければ skip する。
> `MULMOCLAUDE_FAKE_AGENT` / `E2E_LIVE_NO_LLM` とは無関係なので no-LLM matrix にも入れない。
> 設計は [`plans/test-2602-calendar-push-live.md`](test-2602-calendar-push-live.md)、
> 運用は [`docs/e2e-live-testing.md`](../docs/e2e-live-testing.md) の
> 「Specs that need a live Google account」。

## 未実装シナリオ詳細

> 未実装 (L-10 / L-13) + manual-l4 (L-25 / L-27) + 対象外推奨 (L-29) + 廃止 (L-24、 L-FRESH-SANDBOX-BUILD に統合) + fresh-user smoke (L-FRESH-BOOT / L-FRESH-SANDBOX-BUILD / L-FRESH-PRESET-SKILL) を本セクションでカバー。 各シナリオの現在の評価は 「未実装シナリオの再評価 (2026-05-23)」、 次に着手する順は 「実装順 (2026-05-23 時点)」 を参照。 実装済シナリオの初期設計仕様は [`plans/done/feat-e2e-live-history.md`](done/feat-e2e-live-history.md) の 「設計仕様 archive」 を参照。 (L-17 は ui.spec.ts の bridge-origin agent run canary として実装済 — `/api/agent` を `origin: "bridge"` で直接 POST して PR #818 が commented out した agent.ts publishNotification gate を踏ませる形)

凡例:
- 重要度: **S** = 致命級, **A** = 高, **B** = 中
- 画像: 「fixture」= repo 既存ファイル参照、「生成」= 実 generateImage 経由、「不要」= 画像を扱わない

### roles

#### L-10: Gemini key 未設定でも General ロールが disabled にならない

- カバー: B-15
- 重要度: **A** / Docker: `both` / 画像: 不要
- 操作: GEMINI_API_KEY を一時 unset → General 選択
- 検証: 入力欄が enabled、警告バナー表示、generateImage 以外の機能は動く

### session

#### L-13: サーバ再起動後も bridge が再接続できる

- カバー: B-13
- 重要度: **B** / Docker: `both` / 画像: 不要
- 操作: bridge 接続中にサーバ再起動 → 再接続待機
- 検証: 固定 token で再接続成功

### ui

#### L-17: bridge-origin agent run はベルバッジを点灯させない (B-50) — ✅ 実装済

- カバー: B-50
- 重要度: **B** / Docker: `both` / 画像: 不要
- 元シナリオ: bridge から外部メッセージを送信 → 通知 bell バッジは更新されず、history バッジのみ更新
- 実装上の整形: 「実 bridge WebSocket 接続を張る」 は infra 重いので回避。 代わりに **/api/agent が元から `origin` body parameter を受け取る** (server/api/routes/agent.ts:121, 219) ことを利用して、 Playwright から直接 `origin: "bridge"` で POST し、 PR #818 が commented out した `publishNotification(...)` の gate (agent.ts:985 付近、 `if (params.origin !== SESSION_ORIGINS.human)`) を踏ませる
- 実装: (a) `e2e-live/fixtures/live-chat.ts` に `startBridgeOriginAgentRun(page, message, roleId)` 追加 — `/api/agent` を bearer auth 付きで直接叩いて `origin: "bridge"` を渡す helper、 (b) 既存の `waitForSessionIdle` を export 化 (bridge run 完了待ちで使用)、 (c) `listNotifierEntries` + `clearNotifierEntry` (active.json snapshot + 後始末)、 (d) `e2e-live/tests/ui.spec.ts` の L-17 spec: baseline entry id 集合 → bridge-origin agent run → idle 待ち → post entry 集合 → **baseline に無い かつ `pluginPkg === "agent"` かつ `pluginData.sessionId === bridgeSessionId` の entry が 0 件** を assert (PR #818 commented block が uncomment された時のみ現れる precise shape、 Encore/ghost-bell 等の background publishers は session id mismatch で除外される — Codex iter-1 review でこの narrowing が入った) → finally で spurious entries clear + session delete
- catch する regression: 誰かが agent.ts の `publishNotification(...)` block を uncomment する (or 等価コードを再導入する) と、 bridge / scheduler / skill 経路で bell が tick する。 L-17 spec の assertion **「baseline に無い かつ `pluginPkg === "agent"` かつ `pluginData.sessionId === bridgeSessionId` の entry が増えていない」** がこれを catch する (PR #818 commented block が `publishNotification({ kind: NOTIFICATION_KINDS.agent, sessionId: chatSessionId })` を発火する → `legacyKindToPluginPkg("agent") === "agent"` + `LegacyNotifierPluginData.sessionId = chatSessionId` という precise shape を作る、 background publishers はこの shape にならない)
- production 追加面: **ゼロ**。 production code path (`/api/agent` の origin 処理) をそのまま使う。 HTTP route / notifier engine には何も追加していない (`00f4a740` の trust boundary 維持)
- env 要件: **無し**。 `yarn dev` (real LLM) でも CI fake-echo でも env なしで走る — 検証対象 (agent.ts の origin gate) は LLM 種別の上流にあるので、 backend は何でも良い
- 関連 testid: `[notification-bell]` のみ (entry count assertion は API 経由なので bell の visual state は事前 mount 確認だけ)
- 残課題: 実 WebSocket bridge 接続経由の end-to-end は scope 外。 必要になったら「test 専用 dev server spawn infra」 (Phase 2 #4) の上で別 L-XX として作る

### docker

#### L-24: ~~`yarn sandbox:login` 前に image が build されている~~ — **廃止 (L-FRESH-SANDBOX-BUILD に統合)**

- 元カバー: B-02
- 廃止理由:
  1. **ID 重複**: `e2e-live/tests/workspace-link-routing.spec.ts:134` で `L-24` (wiki ページ内 Markdown リンク → Files 経路) が既に使用済。 plan 起票時の docker 用予約 ID と衝突。 spec 側の rename は本 plan の scope 外、 follow-up TODO に記載
  2. **plan 解釈と現実装の乖離**: 現 `yarn sandbox:login` (`package.json:63`) は `security find-generic-password ... > ~/.claude/.credentials.json` の keychain export スクリプトで docker image チェックロジックを持たない。 B-02 の元症状 (image 不在エラー) は別経路 (server boot → `ensureSandboxImage` in `server/system/docker.ts`) で発火する
  3. **検証対象の代替経路あり**: image 不在 → auto-build の正しい検証は **L-FRESH-SANDBOX-BUILD** (fresh-user smoke 群) でカバーされる。 同シナリオは `MULMOCLAUDE_SANDBOX_IMAGE` env で test 専用 image 名を指定 → `ensureSandboxImage` の auto-build 経路を host の `mulmoclaude-sandbox:latest` を消さずに踏ませる
- 後継: **L-FRESH-SANDBOX-BUILD** (「未実装シナリオ詳細 → fresh-user」 を参照)

#### L-25: sandbox 内のファイル所有者が non-root（**Linux のみ**）

- カバー: B-03
- 重要度: **B** / Docker: `manual-l4`（Playwright で再現困難）
- 扱い: `docs/manual-testing.md` のチェックリストに追加

#### L-27: Mac keychain credential が container に渡る（**macOS のみ**）

- カバー: B-05
- 重要度: **A** / Docker: `manual-l4`（OS 依存、Playwright で再現困難）
- 扱い: `docs/manual-testing.md` のチェックリストに追加

#### L-29: Docker 環境で MCP server が crash しない

- カバー: B-07
- 重要度: **A** / Docker: `docker-only` / 画像: 不要
- 操作: Docker サンドボックス起動 → 各 MCP tool を順次呼ぶ
- 検証: MCP server が crash せず最後まで応答
- 注: PR #429 で fix 済、 現コードで再現不能。 unit test (`test/agent/test_agent_config.ts` の `buildDockerSpawnArgs`) で構造的退行は cover 済。 e2e-live への移植は tautology spec で 「対象外推奨」。 「未実装シナリオの再評価」 を参照

#### L-30: skill symlink が Docker 内で dangling にならない

- カバー: B-08
- 重要度: **A** / Docker: `docker-only` / 画像: 不要
- 操作: `~/.claude/skills` を symlink で管理した状態で Docker 起動 → skill 一覧確認
- 検証: skill が表示され、各 sample query が実行可能
- 注: 階層 1 (spec scope 局所 seed) で再現可能 — host `~/.claude/skills/` を触らず、 共有 workspace の `.claude/skills/<test-nonce>` を broken symlink で seed → finally で削除。 「未実装シナリオの再評価」 + 「環境を壊さず再現する設計指針」 を参照

### fresh-user (新規ユーザー smoke)

> 既存ユーザー / tester の host 環境 (`~/mulmoclaude/` / `~/.claude/skills/` 等) を一切汚さずに、 「mulmoclaude を初めて起動するユーザー」 が体験する first-run 経路を e2e-live で検証する枠。 個別の boot 経路 (sandbox image build / preset skill mirror / 認証 token 注入 等) は unit / integration test で部分 cover されているが、 これらが **連動して 1 つの flow として動く** ことを保証する net がない。

#### 再現の設計指針 (fresh-user 共通)

階層 2 (test 専用 dev server) + 階層 3 (env 新設) の組合せ:

1. **HOME + workspace env で host を隔離** — `HOME=/tmp/mc-fresh-home MULMOCLAUDE_WORKSPACE_PATH=/tmp/mc-fresh-ws MULMOCLAUDE_PORT=5176 yarn dev:server &` で別 port + 別 workspace + 別 HOME の test 専用 dev server を spawn。 `os.homedir()` (`server/system/docker.ts:20` の `assertClaudeFiles`、 `server/agent/config.ts:479` の `homeDir` デフォルト) は Node.js の規約上 `HOME` env を first priority で読むため、 host の `~/.claude/` / `~/mulmoclaude/` は一切触られない
2. **認証は host から copy で持ち越し** — `~/.claude/.credentials.json` を `/tmp/mc-fresh-home/.claude/.credentials.json` に pre-test で copy。 spec 内で `claude login` を再現不能なので、 host で認証済の credential を read-only 流用
3. **cleanup** — dev server kill (`MULMOCLAUDE_PORT=5176` で識別) + `/tmp/mc-fresh-*` 削除

前提となる infra は Docker on/off 案 C (test 専用 dev server spawn 機構) と artifact mode (`/e2e-live-pre-release`) と launcher 抽象化を共有する。 1 つの `/e2e-live-matrix` skill が dev mode / artifact mode × Docker on/off × fresh-user の 3 軸を捌く形が最終形 (未着手、 別 PR で詰める)。

#### L-FRESH-BOOT: 空状態から起動して 1 ターン完走

- カバー: first-run UX 全体 (boot path 連動性)
- 重要度: **A** / Docker: `both` / 画像: 不要
- 操作: 空の `/tmp/mc-fresh-{ws,home}` を作る → host `~/.claude/.credentials.json` を copy → test 専用 dev server を上記設計で spawn → SPA に navigate → 新規セッション 1 ターン (`Reply with the single word: ok-<nonce>`) 送信
- 検証: (a) `/api/health` が応答、 (b) workspace dir 構造が auto-init される (`conversations/` / `data/wiki/` / `artifacts/` / `config/settings.json` が存在)、 (c) SPA index.html serve 時に `<meta name="mulmoclaude-auth">` token が注入されている、 (d) 1 ターン response の最終 assistant message に `ok-<nonce>` が含まれる、 (e) cleanup 後に host `~/mulmoclaude/` / `~/.claude/skills/` の mtime が test 前と変わらない (副作用なしの sanity)
- 前提: HOME override の全 path 検証 (mulmoclaude 起動経路で `HOME` env が伝播するか — `os.homedir()` 経由は OK と推測、 hardcode 経路がないか実機検証必要)、 test 専用 dev server spawn infra

#### L-FRESH-SANDBOX-BUILD: sandbox image 不在から auto-build 経由で起動

- カバー: B-10 / B-11 系の 「image 不在 → 自動 build 失敗」 退行
- 重要度: **B** / Docker: `docker-only` / 画像: 不要
- 操作: L-FRESH-BOOT と同じ HOME / workspace 隔離 + `MULMOCLAUDE_SANDBOX_IMAGE=mulmoclaude-sandbox-e2e-fresh` env で image 名を test 専用名に差し替える (= 「image が存在しない」 状態を host の `mulmoclaude-sandbox:latest` を消さずに疑似再現) → dev server 起動 → 1 ターン送信
- 検証: (a) `docker images mulmoclaude-sandbox-e2e-fresh` が起動後に存在、 (b) `ensureSandboxImage` の auto-build 経路 (`server/system/docker.ts:86`) が走ったログを確認、 (c) 1 ターン response が成立、 (d) cleanup: spec 終了時に `docker rmi mulmoclaude-sandbox-e2e-fresh`
- 前提: **`MULMOCLAUDE_SANDBOX_IMAGE` env 新設** (現在 `server/system/docker.ts:13` と `server/agent/config.ts:553` でハードコード)。 build は分単位かかるので timeout 余裕、 通常 CI には載せず手動 skill 推奨

#### L-FRESH-PRESET-SKILL: preset skill が catalog → `.claude/skills/` に bridge mirror

- カバー: preset skill seed → discovery → dispatch の chain (L-32 が同 chain の中盤を見るのに対し、 L-FRESH-PRESET-SKILL は first-boot 起点の rehydrate を見る)
- 重要度: **B** / Docker: `both` / 画像: 不要
- 操作: L-FRESH-BOOT と同じ隔離で空 workspace を起動 → `data/skills/catalog/preset/` 配下に preset skill (`mc-cooking-coach` 等) が auto-seed される (server boot 時の `migratePresets` 経路) → bridge hook で `.claude/skills/<slug>/SKILL.md` に mirror → SPA `/skills` に navigate
- 検証: (a) `/api/skills` 取得結果に preset slug が含まれる、 (b) `data/skills/catalog/preset/<slug>/SKILL.md` が存在、 (c) `.claude/skills/<slug>/SKILL.md` も存在、 (d) `/skills` UI で row が visible

### happy-tour (正常系の網羅 sweep)

> バグ軸 L-XX が個別バグの再発を防ぐのに対し、 happy-tour は **「製品の主要 View / route が一通り壊れずに mount するか」 だけを 1 spec で薄く広く touch** する能力軸スイート。 「`npx mulmoclaude@latest` で起動したら ToDo が読み込み失敗する」 (preset plugin bundle 漏れ、 2026-05-25 報告) のような **「個別 spec で見ていない領域でアプリ全体が破綻する」** クラスの退行を捕まえる net。 fresh-user との違い: fresh-user は boot path の連動性 (auto-init / token 注入 / 1 ターン) を見る、 happy-tour は **boot 後の各 View / endpoint が個別に生きているか** を見る。

#### L-HAPPY-TOUR: 主要 View / route を一通り踏んで 「壊れていない」 を確認する正常系 sweep

- カバー: 各 preset plugin の registration / 各標準 View の mount / 起動時 WARN log の有無 / 主要 API endpoint の応答。 個別 spec で見ている深い assertion は **意図的にしない** (深掘りは既存 spec の責務)
- 軸: **能力** / 重要度: **A** / Docker: `both` / 画像: 不要 / LLM: 最小限 (1 ターンのみ、 no-LLM gate でも可)
- 操作: dev server 起動 (既存 host の `yarn dev` でも `spawnIsolatedDevServer` でもどちらでも) → SPA に navigate → 各主要 route を順に踏む
- 検証ステップ (例):
  1. `/api/health` 200
  2. `/api/plugins/runtime` で `registered > 0` かつ各 preset plugin (`@mulmoclaude/todo-plugin` / `@mulmoclaude/spotify-plugin` / `@mulmoclaude/debug-plugin` / `@mulmoclaude/edgar-plugin`) が含まれる ← **2026-05-25 のバグはここで赤になる**
  3. server 起動 log に `WARN [plugins/preset] preset package not resolvable` が無い
  4. `/` ヘッダが mount、 sidebar 表示
  5. `/chat` 1 ターン送信 → assistant 応答が返る (LLM 必要; no-LLM mode では skip)
  6. `/todos` View が mount、 「読み込みに失敗」 文言が出ない
  7. `/calendar` View が mount、 今月が描画
  8. `/wiki` index が表示、 1 ページ navigate
  9. `/files` workspace tree が表示
  10. `/skills` preset skill list が 1 件以上 visible
  11. `/sources` list が mount
  12. NotificationBell に起動時 WARN diagnostic が出ていない
- 設計指針:
  - 各ステップは **「壊れていないこと」 のみ assertion**、 深い内容検査はしない (例: `/calendar` で 「今月の日付セル一覧」 までは見るが、 イベント表示の正しさは見ない)
  - LLM を要するのは step 5 のみ。 他は `E2E_LIVE_NO_LLM=1` でも回せるよう設計し、 fresh-boot と同じく **doctor CLI / pre-release smoke でも assertion を再利用** できる構造にする (前提: assertion を `e2e-live/lib/health-checks.ts` 等の pure 関数に切り出す)
  - 失敗時の原因特定を容易にするため、 各 step を独立した `test.step()` でラップする
  - 実行時間目標: **3 分以内** (wall-time budget の中で正常系 sweep は薄く保つ)
- 前提: 既存 `spawnIsolatedDevServer` infra を再利用可能。 doctor CLI 構想 (前提 PR の別話題) と assertion を share する設計を採用する場合は `lib/health-checks.ts` の新設が必要

## メンテ skill 化済 — `/make-e2e-live` を起点にする

このスイートを継続メンテするための skill `/make-e2e-live` を `.claude/skills/make-e2e-live/SKILL.md` に用意した。 次セッション以降、 未実装シナリオの追加・main 動向への追従（webkit project, self-repair 緩和等）・既存 spec 修正は **このファイルを起点にして** Phase 1〜6 のフロー（状況把握 → 着手項目合意 → ブランチ → 実装 → PR → plans 反映）で進める。 1 PR の規模は 1〜3 シナリオ or 1 config 改善に絞ること。 実行用 `/e2e-live` skill とは別物（実行 = 既存スイートを回す、 メンテ = スイートを育てる）。

## 実装ステータス

| シナリオ | 状態 | 備考 |
|---|---|---|
| **L-01** presentHtml 画像描画 | ✅ 実装済 | media.spec.ts、fixture 画像を workspace に配置 → naturalWidth > 0、self-repair guard (readImgRepairAttempted) 追加済 |
| **L-02** PDF DL | ✅ 実装済 | media.spec.ts、textResponse の PDF ボタン経由 |
| **L-03** mulmoScript 動画 DL | ✅ 実装済 | media.spec.ts、 fixture json (`e2e-live/fixtures/mulmo/l03-two-beat.json`) を `artifacts/stories/e2e-live-l03-<project>.json` に seed → LLM に filePath 指示 → Generate Movie ボタン → Download Movie ボタン → MP4 `ftyp` magic bytes 検証 (B-21)。 全 beat `text: ""` + textSlide で TTS / image API 呼ばず、 ffmpeg 不在時は `which ffmpeg` で `test.skip`。 worker 衝突回避のため fixture 名に project slug を埋める |
| **L-04** mulmoScript animation:true | ✅ 実装済 | media.spec.ts、 fixture json (`e2e-live/fixtures/mulmo/l04-animation.json`) は 1 beat / `text: ""` / `duration: 2` / `image.type: html_tailwind` + `animation: true` で TTS / 画像生成 API ともに 0 呼出に保ったまま per-frame Puppeteer screenshot + ffmpeg compose 経路 (B-46 が壊した path) を踏ませる。 L-03 と同じ `sendL03FilePathPrompt` → `waitForMulmoScriptViewReady` → `generateAndDownloadMovieWithTimeout` の枠で動かし、 timeout は L-03 (8 分) より絞った 6 分。 worker 衝突回避は L-03 同様 fixture 名に project slug を埋める |
| **L-05** generateImage 実画像描画 | ✅ 実装済 | media.spec.ts、 「猫の絵」 prompt + `generateImage ツールを使ってください` 指示で tool 呼出 → `[generate-image-view]` testid を `src/plugins/generateImage/View.vue` に追加 → `<img>` の src が `/artifacts/images/...` で始まること + `naturalWidth > 0` を assert (decode を待つため `expect.toPass`)。 `GEMINI_API_KEY` は server 側に必要 (test process 側では skip 判定しない、 dotenv が test runner で動かないため) |
| **L-06** General role 1 ターン | ✅ 実装済 | roles.spec.ts、 `Reply with the single word: hello` で 1 ターン → role-selector が "General" + user-input enabled (B-15) + session id が払い出される (B-41) を検証 |
| **L-07** Office role 1 ターン | ✅ 実装済 | roles.spec.ts、 `selectRole(page, "office")` で role 切替 → `data-role="office"` 確認 → 同じ single-word prompt で 1 ターン (B-41 canary)。 `runRoleSampleTurn` ヘルパ経由で L-08/L-09 と共有 |
| **L-08** Tutor role 1 ターン | ✅ 実装済 | roles.spec.ts、 `runRoleSampleTurn(page, "tutor")` (B-41 canary、 L-07 と同型) |
| **L-09** Storyteller role 1 ターン | ✅ 実装済 | roles.spec.ts、 `runRoleSampleTurn(page, "storyteller")` (B-41 canary、 L-07 と同型) |
| **L-11** session reload 復元 | ✅ 実装済 | session.spec.ts、 `Reply with the single word: pong` 後に reload → 2 段階の locale-agnostic assertion (B-14): (1) `getCurrentSessionId(page)` で URL `/chat/<id>` から session id を抽出して reload 前後の equality を比較、 (2) `page.getByText("Reply with ...")` で **ユーザーが送ったプロンプト文字列** (locale 非依存) が DOM に visible なことを assert して transcript hydration を検証。 visible 系の chrome-side 文字列 (e.g. 「Start a conversation」) は 8 locale lockstep の都合で使わない |
| **L-12** session resume → 文脈保持 | ✅ 実装済 | session.spec.ts、 turn 1 で 6 桁 magic code (`729841`) を覚えさせる instruction-style prompt (`Reply with the single word: ok.` で turn-1 自体での echo を抑止) → reload → URL の session id 一致を確認 → turn 2 で 「その code は何だった？」 と問い → DOM の任意箇所に `729841` が visible で B-16 をカバー (`page.getByText(...).first()`)。 専用 testid を増やさない代わりに 6 桁数字でユニーク性を担保 |
| **L-19** stack-rehydrate on reload | ✅ 実装済 | ui.spec.ts、 `addInitScript` で `localStorage.canvas_layout_mode="stack"` を毎 navigation 注入 → 1 ターン送信 → `stack-scroll` visible / `stack-empty` hidden を pre-reload で確認 → reload 後も同じ assertion で B-31 の rehydrate 経路を end-to-end 検証 (default の single layout では StackView が mount しないので stack 切替を seed する必要がある) |
| **L-20** /files?path= → /files/ rewrite | ✅ 実装済 | ui.spec.ts、 純粋 router-guard テスト (LLM / fixture seed なし)。 旧形式 `/files?path=<file>` に goto → `/files/<file>` への書き換えを `toHaveURL` 正規表現で確認 + `?path=` が消えていることを否定 assertion で B-30 の URL-shape 側を保護。 reload 後も同じ assertion で「rewrite が毎 navigation で再発しない」 ことも担保 |
| **L-14** wiki 内部リンク | ✅ 実装済 | wiki-nav.spec.ts、 fixture wiki page 2 件 seed → wikilink `[[slug]]` を click → `/wiki/pages/<target>` に遷移 (B-23/B-24/B-25)、 catch-all で `/chat` に飛ばないこと |
| **L-15** 非 ASCII slug の wiki ページ | ✅ 実装済 | wiki-nav.spec.ts、 `日本語タイトル-nonascii-target-${project}-${nonce}` 型 slug の page を 2 件 seed → (A) URL 直叩き (`encodeURIComponent` round trip) と (B) `[[…]]` wikilink クリックの両経路で `wiki-page-body` に Japanese 本文が描画され `/chat` に飛ばないことを assert (B-26 / B-27)。 server `wikiSlugify` が Japanese を落として exact-key match が外れる前提で `resolvePagePath` の fuzzy `key.includes(slug)` 分岐に乗せる設計 (`data/wiki/index.md` 直接編集を避けるため)。 fuzzy が source page と target page の両方にマッチする落とし穴 (両 slug の ASCII tail が共通になる) を踏んだので、 target slug 側に `nonascii-target` という source 名に含まれない unique token を入れて衝突回避 |
| **L-16** wiki index ナビゲーション | ✅ 実装済 | wiki-nav.spec.ts (`describe.serial("wiki index-mutating diagnostics")` 内)、 `replaceWikiIndex(content)` + `restoreWikiIndex(original)` helper で `data/wiki/index.md` を一時差し替え → `placeWikiPage` で 2 ページ seed → `/wiki` に直遷移 → `wiki-page-entry-${slug}` を 2 件 visible で確認 → 各エントリを click → `/wiki/pages/<slug>` に遷移 + body marker を assert (B-23/B-24)、 `/chat` フォールバック退行を否定 assertion で塞ぐ。 L-WIKI-LINT-MISSING / L-WIKI-LINT-TAG-DRIFT 追加時に index-mutating test が 3 本になったため、 共有 index file の race を防ぐ serial block へ移動 |
| **L-WIKI-PIPE** `[[slug\|alias]]` クリック後 URL 清浄性 | ✅ 実装済 | wiki-nav.spec.ts、 PR #1312 (issue #1297) で fix された `parseWikiLink` の `\|` split 退化を end-to-end で検出する net。 source ページに `[[<targetSlug>\|日本語表示+ASCII token]]` を埋め込んで seed → renderer assertion で `data-page` = targetSlug only / 表示テキスト = alias only / DOM 全体に `data-page*="\|"` が 0 件を確認 → click → URL が `/wiki/pages/<targetSlug>$` で終わり `%7C` (= `\|`) が含まれず `/chat` に飛ばないことを assert → target body marker visible。 lint 側の regression は `test/lib/wiki-page/test_lint.ts` の `findBrokenLinksInPage — [[slug\|alias]] regression` ユニット test がカバーするので spec はフロント挙動 (renderer/router) に絞り込み |
| **L-WIKI-LINT-PIPE-CLEAN** lint レポート UI で `[[slug\|alias]]` が false positive にならない | ✅ 実装済 | wiki-nav.spec.ts、 PR #1312 (issue #1297) の lint 側を end-to-end で検証。 source / target の 2 ページ seed (`[[<slug>\|日本語+aliasAsciiToken]]`) → `/wiki/lint-report` 遷移 → 「Wiki Lint Report」 heading visible で hydrate 待機 → `<li>` に source slug + `not found` を含む行が 0 件 / alias ASCII token + `not found` を含む行も 0 件、 を 2 段の sentinel で確認。 pre-fix の false positive shape (`<slug>-<alias-ascii>.md not found`) を直接 negate する形 |
| **L-WIKI-LINT-EMPTY-TARGET** lint レポート UI で `[[\|alias]]` が "empty target" 診断に出る | ✅ 実装済 | wiki-lint.spec.ts、 PR #1312 で新設された empty-target 診断 (target が空文字列のケース) を end-to-end で検証。 source ページ 1 件 seed → `[[\|empty-alias-<nonce>]]` を埋める → `/wiki/lint-report` 遷移 → `<li>` に source + alias + `empty target` を含む行が 1 件 / 同条件で `not found` を含む行は 0 件 を assert。 **当初は bare `[[日本語]]` を seed していたが、 #2940 で非 ASCII target は `<題名>.md not found` を出す仕様に変わり (`wikiPageStem` が非 ASCII 名をそのまま返す)、 この spec だけが取り残されて 2026-08-25 から main で 13 日連続 red になっていた。 日本語ケースは L-WIKI-LINT-NON-ASCII に分離。** |
| **L-WIKI-LINT-NON-ASCII** lint レポート UI で bare `[[日本語]]` が `<題名>.md not found` 診断に出る | ✅ 実装済 | wiki-lint.spec.ts、 #2940 の仕様 (ページファイル名が日本語ならその stem が slug) を UI 側で固定。 source ページ 1 件 seed (target 不在) → ASCII を一切含まない `[[日本語のみのターゲット記号終端タイトル]]` を埋める → `<li>` に source + `<題名>.md` + `not found` を含む行が 1 件 / 同条件で `empty target` を含む行は 0 件 を assert (#2940 前の挙動への退化検知)。 core 側の unit test (`packages/core/test/wiki/test_lint.ts` "reports a missing non-ASCII target as a broken link, not an empty target") と対になる |
| **L-WIKI-LINT-BROKEN** lint レポート UI で `[[bogus-slug]]` が broken link 診断に出る | ✅ 実装済 | wiki-nav.spec.ts、 既存 broken-link 診断の sanity (PR #1312 周辺退化の検出 net)。 source ページ 1 件 seed (bogus target は seed しない、 ASCII slug 想定) → `[[<bogus-slug>]]` を埋める → `/wiki/lint-report` 遷移 → `<li>` に source + `<bogus-slug>.md not found` を含む行が 1 件 を assert。 一般的な broken-link 診断 shape を確認 |
| **L-WIKI-LINT-ORPHAN** lint レポート UI で index.md にない page が orphan 診断に出る | ✅ 実装済 | wiki-nav.spec.ts、 `findOrphanPages` の end-to-end net。 nonce-stamped slug の page を 1 件 seed (index には触らない、 既存 index も該当 slug を含まない) → `/wiki/lint-report` 遷移 → `<li>` に `<slug>.md` + `Orphan page` + `missing from index.md` を全部含む行が 1 件 を assert。 index 不変なので並列ブロックに残せて他 L-WIKI-LINT-* と一緒に走る。 並列の隣テストが seed した source page も orphan として出るが、 `:has-text(<our slug>)` で scope するので noise を吸う |
| **L-WIKI-LINT-MISSING** lint レポート UI で index.md が参照する未存在 file が missing 診断に出る | ✅ 実装済 | wiki-nav.spec.ts (`describe.serial` 内、 L-16 と隣接)、 `findMissingFiles` の end-to-end net。 `replaceWikiIndex` で synthetic な bullet-link 行 1 件 (`pages/<bogusSlug>.md`) のみの index に差し替え → page 自体は seed しない → `/wiki/lint-report` 遷移 → `<li>` に bogusSlug + `Missing file` + `does not exist` を全部含む行が 1 件 を assert。 index mutation を含むので L-16 と同じ serial block に同居 |
| **L-WIKI-LINT-TAG-DRIFT** lint レポート UI で frontmatter tag と index tag の drift が診断に出る | ✅ 実装済 | wiki-nav.spec.ts (`describe.serial` 内)、 `findTagDrift` の end-to-end net。 page を YAML frontmatter `tags: [pageonly-<nonce>]` 付きで seed → `replaceWikiIndex` で同 slug を `#indexonly-<nonce>` タグ付きの bullet-link で 1 件のみ含む index に差し替え (slug は同じ → drift 条件成立、 page も index も両方ある → Missing/Orphan ノイズなし) → `/wiki/lint-report` 遷移 → `<li>` に `<slug>.md` + `Tag drift` + pageTag token + indexTag token を全部含む行が 1 件 を assert。 両 tag token を nonce-stamp して並列走の隣テストとの衝突を防ぐ |
| **L-18** presentForm i18n raw key | ✅ 実装済 | ui.spec.ts、 LLM に「nickname text field 1 個の presentForm を表示して」 と依頼 → `present-form-view` testid (`src/plugins/presentForm/View.vue` に追加) が visible になったら `not.toContainText("pluginPresentForm.")` で B-34 を locale 非依存にカバー。 raw i18n key 漏れは prefix 文字列が DOM の visible text に出ることが regression shape なので submit ボタンや progress カウンタ単体に縛らずに view 全体の textContent を見る設計。 form は submit せず assistant turn を drain して trace を保全 |
| **L-21** chart deferred-tool dispatch | ✅ 実装済 | skills.spec.ts、 「`L-21 sales` の bar chart を chart tool で render して」 と prompt → `chart-card-0` + `chart-canvas-0` testid (`src/plugins/chart/View.vue` 既存) が visible になることを assert (B-41 canary)。 L-03 (presentMulmoScript) と異なる plugin で 2 本目の deferred dispatch canary を立て、 deferred mode で 1 plugin だけ schema 取りこぼす shear 退行を網羅。 LLM のばらつきを「`Do not narrate the result.`」 で抑え、 textResponse fallback を防ぐ |
| **L-21B** encore defineEncore deferred-tool dispatch (#1437 / #1440 / #1441 / #1443) | ✅ 実装済 | skills.spec.ts、 Personal role + 「`defineEncore` ツールに次の DSL object literal を渡して setup してください」 と prompt (DSL は service-type / daily cadence / 1 target / 1 step / 1 form field の最小構成を inline JSON で pin) → session jsonl trace に `mcp__mulmoclaude__defineEncore` の tool_call が `dsl.displayName === <pinned displayName>` で 1 件以上記録されていること、 加えて `data/plugins/encore/obligations/<slug>/index.md` が disk に landing していることを assert (B-41 canary 第 2 弾)。 L-21 が presentChart で見ている deferred-tool dispatch を、 構造的に異なる encore plugin (2 つの MCP tool が 1 つの apiNamespace を共有、 `dsl` param は `z.toJSONSchema(EncoreDslInput)` で auto-derive される JSON Schema を持つ) で 2 本目を立てる。 ❶ **View mount assertion を採らない理由**: `defineEncore` handler は `EncoreDispatchResult` に `data` フィールドを乗せない narrate-only 設計のため、 `server/agent/mcp-server.ts:451` の `if (result.data !== undefined)` ガードで MCP bridge は意図的に visual ToolResult を push しない (encore dashboard はランチャー / 通知 bell クリック経由で `/encore` ルートに mount される surface であり、 chat inline の tool-result View ではない)。 L-21 (chart) は handler が `data: {...}` を返すので View が mount するが、 encore では設計差で同じ assertion shape が使えない。 したがって canary 信号は tool_call jsonl trace + on-disk artefact で取る (L-31 の手法に近い)。 ❷ slug は `slugify(displayName)` (`server/encore/paths.ts`) を spec 側で再現して `l-21b-encore-canary-<nonce>` を期待値に固定。 ❸ firingPlan は `schedule:9999-12-31` (遠未来) を選び、 setup 時の `reconcileCycleNotifications` が due な phase を見つけられないようにして、 そもそも ticket / bell が発火しない設計 (Codex iter-1 review で「`sweepStuckTickets` は dead obligation の ticket を skip する」 という invariant が明らかになり、 source-of-truth な対処として inert firingPlan を採用)。 ❹ cleanup は新規 `removeEncoreObligation` helper で `data/plugins/encore/obligations/<slug>/` を rm + `tickets/*.json` のうち同 obligationId を持つものを sweep (host engine の `sweepStuckTickets` は dead obligation の ticket を skip する設計 = 30 日 age threshold まで残るので、 spec 側で明示掃除して防御)。 fake-echo backend は MCP bridge の filesystem 副作用を再現できないので per-test に `E2E_LIVE_NO_LLM=1` skip |
| **L-22** skill end-to-end 実行 (B-08) | ✅ 実装済 | skills.spec.ts、 合成 skill を `<workspace>/.claude/skills/<unique-slug>/SKILL.md` に seed (body には 「`/<slug>` で呼ばれたら `L22-OK-<nonce>` という marker を返答せよ」 の指示) → `/skills` 直叩き → 一覧に row 出現 → click で `skill-body-rendered` に marker が描画 → Run ボタン → `/chat/<id>` で agent ターン完走 → assistant 応答に同 marker が含まれることを assert。 discovery → list API → detail API → slash-command dispatch → skill body が agent context に乗る、 の 4 段全てが繋がっていないと marker が出ない設計。 nonce で他テストと衝突回避、 marker は ASCII の決定論的文字列で LLM 揺れ吸収 |
| **L-31** mc-manage-skills bridge dispatch canary (post-#1298) | ✅ 実装済 | skills.spec.ts、 General role + 「次の挙動の skill を、 slug を `<explicit-slug>` にして保存してください」 prompt → `waitForAssistantTurn` で agent turn 完走 → `readSessionToolCalls(sessionId)` で `tool_call` jsonl を読み、 `Write` against `data/skills/<slug>/SKILL.md` (post-#1298 bridge staging path) が含まれることを assert。 #1284 / #1296 / #1298 全てが揃わないと成立しない: (a) mc-manage-skills が General に居る (b) preset SKILL.md が discovery される (c) 本文の指示通り agent が staging path に Write する。 同様の盤面で agent が `.claude/skills/` に直 Write すれば permission gate に hang する (これが #1298 で bridge が回避した regression)。 prompt は slug pin で plumbing canary を確実化、 ambiguity の検証は L-32 が担当 |
| **L-32** end-to-end skill landing + Run canary (post-#1298) | ✅ 実装済 | skills.spec.ts、 General role + 「skill 化して」 (slug 任せ、 marker 入り body 要求) → `snapshotProjectSkillSlugs()` で baseline → `waitForAssistantTurn` → (1) bridge mirror が `.claude/skills/<new-slug>/SKILL.md` に landing し本文に marker を含むことを baseline diff + body read で assert → (2) `/skills` に navigate して `skill-item-<slug>` row が visible (`/api/config/refresh` 効果) → (3) row click → Run → assistant 応答に marker echo (slash dispatch + body 反映)。 discovery → dispatch → `Write` (staging) → bridge hook (mirror) → refresh → registry rescan → invocation の 7 段 end-to-end canary。 L-22 (直 seed→Run) では `refreshConfig` を経由しないので、 bridge → registry の繋ぎ込みは L-32 の Run leg だけが catch する設計。 cleanup は marker hit した new slug のみを target にして並列実行中の他 spec / future test の slug を巻き込まない、 creation session + run session 両方を delete |
| **L-33** mc-cooking-coach preset chain canary (#1287) | ✅ 実装済 | skills.spec.ts、 launcher 同梱の `mc-cooking-coach` を「`server/workspace/skills-preset/<slug>/SKILL.md` → `data/skills/catalog/preset/<slug>/` → `.claude/skills/<slug>/` → `/<slug>` slash dispatch → 一ターン目で cooking 関連 vocabulary を含む応答」 の 4 段 chain で end-to-end 検証 (B 重要度)。 `/skills` 直叩き → `skill-catalog-item-mc-cooking-coach` visible で `syncPresetSkills` 出力を確認 → `snapshotProjectSkillSlugs()` で 既 star 済なら skip、 未 star なら catalog detail の `skill-catalog-detail-star-btn` を click して active 化 (preset は launcher 管理なので unstar はしない、 idempotent setup) → `skill-item-<slug>` click → `skill-body-rendered` に signature line `"bundled MulmoClaude preset skill"` が含まれることを assert (catalog→active 経路で本文が mangled していないこと) → `skill-run-btn` click → `/chat/<id>` で assistant 応答が `recipe` / `料理` / `レシピ` のいずれかを (case-insensitive で) 含むことを assert (body が agent context に乗ったか の signal、 `cook` は slug 自身に含まれるため false-pass 回避で除外)。 L-22 が直 seed→Run、 L-32 が agent-authored 経由を見るのに対し、 L-33 は **launcher tarball 起点の preset adoption rail** を独立して見る canary。 fake-echo は slash dispatch + skill resolver を fake 不能なので per-test に `E2E_LIVE_NO_LLM=1` skip。 Codex cross-review (iter-1〜4) で race 防御 (`starBtn.or(starredIndicator)` + `isVisible()`) と function 20 行 cap (`ensurePresetStarred` / `starPresetViaCatalog` に分割) を converge |
| **L-33B** catalog → ☆ Star → /skills active row 出現 (UI rail canary) | ✅ 実装済 | skills.spec.ts、 L-33 の 「starPresetViaCatalog 経路は normal env では disk snapshot で fast-path → 実行されない」 問題に対する補完 canary。 mc-invoice (launcher preset で normal env で starred されにくい) を target に `removeProjectSkill` で fs-unstar → `/skills` 直叩き → `skill-catalog-item-mc-invoice` visible + `skill-item-mc-invoice` count === 0 (pre-state assert) → catalog row click → `skill-catalog-detail-star-btn` click → `skill-item-mc-invoice` visible (`starCatalogEntry` + registry refresh 効果を end-to-end で確認) → finally で fs-unstar 復元。 LLM 不要 (pure UI + fs) なので `E2E_LIVE_NO_LLM=1` skip は無し、 CI matrix でも毎回走り catalog→active UI rail を常時カバー。 約 1.3s で完走 |
| **L-23** X MCP が Docker 内で .env から key を読める (B-01) | ✅ 実装済 | docker.spec.ts、 `getSandboxStatus(page)` で `/api/sandbox` を叩いて `null` (= sandbox disabled) なら test.skip → 加えて `process.env.X_BEARER_TOKEN` を直接見て host env 未設定なら test.skip (spec 冒頭で workspace の `.env` を dotenv load) → `getMcpToolsList(page)` で `/api/mcp-tools` catalog を取り `readXPost.enabled === true` + `searchX.enabled === true` を assert。 `requiredEnv: ["X_BEARER_TOKEN"]` の宣言保持も同 assert で carry-along チェック。 precondition が test 対象 flag (`enabled`) と独立しているので catalog バグで `enabled: false` が出た時に silent skip せず fail する (Sourcery iter-1 / PR #1462)。 fake-echo backend では fake 不能 (catalog は host MCP registry の素 read) のため per-test に `E2E_LIVE_NO_LLM=1` skip。 spec ファイルは `.github/workflows/e2e_live_no_llm.yaml` matrix に **意図的に登録していない** (fake-friendly な test が 1 つもないため、 `docs/e2e-live-testing.md` の matrix 規約に従う) |
| **L-26** Docker sandbox 上で session resume できる (B-04) | ✅ 実装済 | docker.spec.ts、 sandbox enabled gate → 「Reply with the single word: ok-`<nonce>`.」 で 1 ターン → session id capture → `page.reload()` → (1) `getByText(prompt).first()` で transcript hydration、 (2) `getByText(/No conversation found/i).toHaveCount(0)` で B-04 error string の不在、 (3) session id 不変、 を 3 段 assert。 L-11 が「sandbox on/off どちらでも」 で同等の assert を持つので shape は重複するが、 L-26 は **sandbox on 状態でしか走らない** ことで in-container workspace path (`/home/node/mulmoclaude`) と server-side jsonl reader の整合だけを切り出す net。 fake-echo は sandbox-bound CLI を spawn しないので per-test に `E2E_LIVE_NO_LLM=1` skip |
| **L-28** Docker sandbox 内で git/gh 認証通る (B-06) | ✅ 実装済 | docker.spec.ts、 sandbox enabled gate に加えて `status.sshAgent` または `status.mounts.includes("gh")` の credential-bridge gate → credential が 1 つも attach されてなければ「テストしたいシナリオではない」 として skip。 agent prompt は `cat /etc/hostname && echo --- && gh auth status` を Bash で実行させ stdout/stderr の verbatim quote を要求 (hostname は per-run docker id で training data から予測不能、 LLM が tool dispatch を skip して text-reply に逃げる経路を塞ぐ) → (a) `readSessionToolCalls(sessionId)` を `bashCommandFromCall` でフィルタし `gh auth status` を含む `Bash` 呼出が 1 件以上あることを assert (Codex iter-1)、 (b) 同 `toolUseId` の `tool_call_result` を `readSessionToolResults(sessionId)` で取り、 result `content` (= 実 gh の stdout/stderr) に `/Logged in to github\.com/i` が含まれ `/not logged into any (?:GitHub )?hosts/i` を含まないことを assert (LLM が dispatch 後に paraphrase / hallucinate で false-pass する経路を塞ぐ、 Codex iter-2)、 (c) UI rendering sanity として `[data-testid="text-response-assistant-body"].last()` にも success line が出ることを confirm。 load-bearing は (b) の tool_call_result body 検査、 fake-echo は Bash dispatch を再現できないので per-test に `E2E_LIVE_NO_LLM=1` skip |
| **L-30** skill symlink dangling silently skipped (B-08) | ✅ 実装済 | docker.spec.ts、 sandbox enabled gate → workspace の `.claude/skills/<dangling-slug>` に `node:fs/promises#symlink` で broken symlink を seed (target は `os.tmpdir()` 配下の nonce-stamped 不在 path で固定) + sibling として `placeProjectSkill(<sibling-slug>, ...)` で valid な SKILL.md を seed → `/skills` 直叩き → (a) `skill-item-<siblingSlug>` が visible で discovery が dangling で crash していないことを assert、 (b) `skill-item-<danglingSlug>` の `toHaveCount(0)` で dangling slot が silently skip されている (error row として surface していない) ことを assert → finally で `removeBrokenSymlinkSkill` (lstat-guarded、 symlink でなければ no-op) + `removeProjectSkill` で cleanup。 L-30 自体は LLM 不要 (`server/workspace/skills/discovery.ts:collectSkillsFromDir` の `stat()` 経路は host-side のみ) だが、 sandbox enabled gate を file-level で共有しているため fake-echo CI matrix への登録は引き続き見送り。 helper として `placeBrokenSymlinkSkill` / `removeBrokenSymlinkSkill` を live-chat.ts に新設 (今後 「discovery resilience」 系シナリオで再利用可能な shape) |
| L-10, L-13 | 未実装 | test 専用 dev server 起動 infra (案 C 拡張、 `MULMOCLAUDE_WORKSPACE_PATH` + 別 port) が前提。 「未実装シナリオの再評価 (2026-05-23)」 「実装順 (2026-05-23 時点)」 を参照 |
| **L-17** bridge-origin agent run はベルバッジを点灯させない (B-50) | ✅ 実装済 | ui.spec.ts、 `listNotifierEntries` で baseline entry id 集合 → Playwright から /api/agent を `origin: "bridge"` で直接 POST (`startBridgeOriginAgentRun` helper、 UI 経由だと origin=human 固定なので bypass する) → `waitForSessionIdle` で run 完了待ち → 再度 entry id 集合取得 → **baseline に無い かつ `pluginPkg === "agent"` かつ `pluginData.sessionId === bridgeSessionId` の entry が 0 件** を assert (PR #818 commented block が uncomment された時のみ現れる precise shape、 Encore/ghost-bell 等の background publishers は session id mismatch で除外される — Codex iter-1 review で narrowing 反映) → finally で spurious entries clear + session delete。 /api/agent は元から body の `origin` field を受け取る (server/api/routes/agent.ts:121, 219) ので production code path をそのまま使えた — 追加面ゼロ、 env 不要。 backend は real LLM / fake-echo どちらでも検証対象 (origin gate) は LLM 種別の上流なので動く |
| L-24 | 廃止 | ID が `e2e-live/tests/workspace-link-routing.spec.ts:134` の `L-24` (wiki Markdown link) と衝突しており plan 側を廃止。 元のシナリオ (B-02、 image 不在 → auto-build) は **L-FRESH-SANDBOX-BUILD** に統合 (fresh-user smoke 群)。 spec 側の L-23 / L-24 を `L-WSLINK-*` 等にリネームする follow-up は 「未確定事項 / TODO」 を参照 |
| L-25, L-27 | manual-l4 | `docs/manual-testing.md` のチェックリストへ。 L-25 は Linux のみ、 L-27 は macOS のみで Playwright 自動化困難 |
| L-29 | 対象外推奨 | PR #429 fix 済、 現コードで crash 再現不能。 unit test (`test/agent/test_agent_config.ts` の `buildDockerSpawnArgs`) で構造的退行は cover 済、 e2e-live への移植は tautology spec。 「未実装シナリオの再評価 (2026-05-23)」 参照 |
| **L-EDIT** beat 編集永続化 | ✅ 実装済 (active) | mulmo-script-edit.spec.ts、 PR #1243 で #1074 fix と同梱で unskip 済 (`adcca773 fix: persist presentMulmoScript beat edits across page reload`)。 fixture json を seed → presentMulmoScript view を立ち上げ → beat 0 の source-editor textarea で `text: ""` → `"L-EDIT marker via e2e-live"` に書き換え → update ボタン押下 (`sourceOpen[index]=false` で textarea が `v-if` 解除されるのを成功シグナルに使う、 button が enabled に戻るのを待つと button 自体が DOM から消えてるので timeout する罠あり) → wiki launcher → session tab で SPA 内ナビゲーション (page.goto は server `enrichWithMulmoScript` で fix を bypass するので避ける) → marker が再表示される事を assert |
| **L-LINKIFY-CODESPAN** inline-code workspace path の auto-linkify (#1300 / PR #1325 layer A) | ✅ 実装済 | workspace-link-routing.spec.ts、 PR #1325 の codespan-fallback layer (A) を end-to-end で検証。 ASCII filename の workspace ファイルを `artifacts/e2e-live/workspace-link-routing/` 配下に seed → LLM に「`` `artifacts/.../foo.md` `` 開いて内容を確認」 の inline-code 形式を 1 行で echo させる (issue #1300 の再現 shape そのまま) → `a.workspace-link[data-workspace-path="<path>"]` が visible で inner `<code>` が path テキストを保持していることを assert → click → /files navigation + 本文 marker visible を assert。 unit test (`test/utils/markdown/test_workspaceLinkify.ts`) は detector + marked pipeline 単体のみカバー、 本 spec は marked → linkify → textResponse click handler → `appApi.navigateToWorkspacePath` → router の 5 段を初めて end-to-end で繋ぐ net。 L-23 (Markdown-link 形式 + multibyte) と orthogonal で encoding 軸を持ち込まないため ASCII slug |
| **PR #1325 layer B** SYSTEM_PROMPT の "Referring to files in chat replies" 保持 | ✅ 実装済 (unit) | test/agent/test_agent_prompt.ts、 LLM 遵守そのものは LLM 揺れで deterministic に測れないため、 SYSTEM_PROMPT 内の該当セクションヘッダ + 3 大ルール (ALWAYS Markdown link form / NEVER inline code / NEVER plain text) + workspace-relative path convention 文言の保持を unit test で固定化。 既存 image-reference convention test (stage 2 of feat-image-path-routing) と同じ pattern。 これにより layer A (e2e-live codespan-fallback) と layer B (unit test 文言保持) の組合せで manual 0 を達成 |
| **L-SETTINGS-EFFORT** Settings → Model effortLevel 双方向同期 (#1323) | ✅ 実装済 | settings.spec.ts、 `config/settings.json` を snapshot (real user file は finally で復元、 codex iter-1 で seed は merge-onto-snapshot に変更し SIGKILL 耐性確保) → Phase 1: seed `{...original, effortLevel:"max"}` → modal open → `settings-tab-model` クリック → `settings-model-effort-select` が `max` を見ている (load path: GET /api/config + cloneAppSettings) → Phase 2: select を `low` に変更 → `@change` auto-save → `settings-model-status` が `low` を含むまで wait → ファイルから `effortLevel: "low"` を直接読み出して確認 (save path: PUT /api/config/settings → atomic write) → Phase 3: 空オプションで clear → status から `low` 消失 → ファイルから `effortLevel` キー自体が消えていることを assert (null sentinel → route の `delete merged.effortLevel` after spread が効いている)。 `buildCliArgs` unit test と config route integration test では取り切れない 「Vue ref ↔ select wire / `@change` auto-save / null sentinel 漏れ」 をブラウザ越しに 1 spec で網羅。 `config/settings.json` は workspace 共有ファイルなので describe は `mode: "serial"`、 同 file を mutate する将来 spec も同じ fence を借りる必要あり。 `restoreSettings` は他の cleanup helper と違い error を握り潰さない (real user data なので silent 破損を避ける、 codex iter-1)。 `readWorkspaceFile` helper を新設 (live-chat.ts、 ENOENT は `null`、 他 IO エラーは throw)。 wall time 1.2s |
| **L-SETTINGS-EFFORT-SPAWN** settings.json → claude `--effort` 引数到達 (#1323 最終ホップ) | ✅ 実装済 | settings.spec.ts、 L-SETTINGS-EFFORT の sibling として「load → spawn」 ホップを単独で検証 (姉妹は「UI ↔ disk」 のみ)。 `seedWithEffort(original, "low")` で disk に直書き → `startNewSession` → `sendChatMessage("Reply with the single word: ok.")` → `/chat/<id>` URL 確定で session id を早めにキャプチャ (cleanup 確実化) → `ps -A -ww -o command=` を `toPass` で poll し、 `mcp__mulmoclaude` (`--allowedTools` 内に必ず入る固有 marker、 user 並走の Claude Code CLI を除外) を含むプロセスが現れるまで待つ → 全該当プロセスに `--effort low` regex match を assert → `waitForAssistantResponseComplete` で trace を末尾まで撮る → `deleteSession` + `restoreSettings`。 `buildCliArgs` の unit test では掴めない 「`loadSettings → settings.effortLevel → buildCliArgs(effortLevel) → spawn` の鎖が切れる」 系の退行を end-to-end で検出。 1 LLM ターン消費、 wall time ~7s。 ps 出力の長大化対策として `-ww` を渡している (Linux 必須、 macOS は pipe 時 truncate しないが安全側) |
| **L-W-S-03** `<picture><source srcset>` rewriter | ✅ landed (#1275) | wiki.spec.ts、 unskip 済。 `srcset` 専用 split/rewrite pass (`rewriteSrcset` / `SRCSET_TAG_ATTRS` in `src/utils/image/htmlSrcAttrs.ts`) が #1275 で landed。 spec は `<picture><source srcset>` の srcset が `/api/files/raw` に書き換わること + descriptor 保持 + fallback `<img>` decode を検証 |
| **L-HAPPY-TOUR** 正常系 sweep (capability axis) | ✅ 実装済 | happy-tour.spec.ts、 16 ステップを `test.step()` で個別ラップして失敗時に壊れた station が trace に直接出る構造。 step 1〜3 は `/api/health` / `/api/plugins/runtime/list` / `/api/plugins/diagnostics` の authed JSON GET を pure assertion (`e2e-live/lib/health-checks.ts`) で検証 — 2026-05-25 報告 (`@mulmoclaude/todo-plugin` bundle 漏れ) の **shape** を step 2 がカバー (dev 検証時は `requireDevOnly: true` で 4 preset 全件要求、 完全な tarball-mode catch は `health-checks.ts` を doctor CLI から再利用する別 PR を待つ)。 step 4〜16 はランチャーバーから到達できる主要 route を順に踏む: `/` → `/todos` → `/calendar` → `/wiki` → `/files` → `/skills` → `/sources` → `/automations` → `/news` → `/roles` → `/encore` → `/collections`。 各 view の root testid (`todo-view-root` / `scheduler-view-root` / `files-view-root` / `sources-view-root` / `roles-view-root` / `collections-view-root` を新設、 `news-view` / `encore-dashboard` / `wiki-lint-chat-button` / `skill-section-catalog` / `chat-sidebar` は既存) が visible + 既存の error banner testid (`todo-api-error` / `scheduler-api-error`) が `toHaveCount(0)` であることのみ assert (深い内容検査は意図的に避ける)。 step 5 は LLM 必須の 1 ターン smoke で `E2E_LIVE_NO_LLM=1` 環境では step body 内 early-return (Playwright の `test.skip()` は test 全体を skip するので使用不可、 Codex iter-2)、 session id は `/chat/<id>` URL 確定直後に capture して marker timeout でも cleanup が走る順序を確保 (Codex iter-1)。 plan step 12 (NotificationBell 警告 0 件) は step 3 と構造重複 + global filter での false-positive 懸念で実装から落とし、 必要時は L-17 baseline-diff shape で再導入する方針 (Codex iter-1)。 `/debug` は dev-only preset の playground で tarball mode で見えない surface のため意図的に除外。 assertion 部を pure 関数に切り出した理由は doctor CLI / pre-release smoke 共有のため (plan「設計指針」 通り)。 wall time 目標 3 分 (timeout 設定値) |
| **L-DISPATCH-*** 未踏 plugin の 1 ターン dispatch canary (todo / cal / md / xls / svg / html / acct) | ✅ 実装済 | plugin-dispatch.spec.ts、 7 plugins (manageTodoList / manageCalendar / presentDocument / presentSpreadsheet / presentSVG / presentHtml / manageAccounting) を uniform shape で網羅。 manageAutomations は roles.ts line 252 のコメント通り built-in role の availablePlugins に未登録のため対象外 (manageRoles / manageSource と同 status、 source 側の role gate 変更は本 PR scope 外)。 各 spec は `setupRoleSession(page, role, sessionsToCleanup)` で plugin が露出した role に切替 → tool 名を literal で名指しした prompt 送信 → `waitForAssistantTurn` → `readSessionToolCalls(sessionId)` で jsonl trace を読み `mcp__mulmoclaude__<toolName>` の `tool_call` ≥1 件 を assert。 jsonl-only assertion を選んだ理由は 対象 plugin のうち 3 つ (todo / markdown / spreadsheet) に top-level chat-inline View testid が無く、 calendar / automations は SchedulerView を共有 (chat-inline 区別不能)、 accounting は createBook が openBook envelope を mount しない narrate-only path のため、 view-mount assertion を統一 shape で揃えるには testid 追加 refactor が必要 (out-of-scope)。 `setupRoleSession` は L-21B 由来の helper を本 PR で `live-chat.ts` に昇格 (skills.spec.ts も import に切替)。 manageRoles / manageSource は built-in role の `availablePlugins` に未登録で LLM dispatch path に乗らないため 対象外 (role gating 変更が別 PR 必要)、 spotify / edgar は OAuth / 外部設定が前提のため後回し継続。 fake-echo backend は MCP dispatch を再現できないので `E2E_LIVE_NO_LLM=1` で test.describe ごと skip、 CI matrix には未登録 (docker.spec.ts と同位置付け) |
| **L-JOURNEY-TODO** UI から todo を add → check → reload で残る | ✅ 実装済 | journey-todo.spec.ts、 LLM 不要の純 UI + REST + ファイル永続化 net。 nonce-stamped marker text の todo を Add dialog (`todo-add-dialog-text` / `todo-add-dialog-submit` を新設) 経由で投入 → kanban card (`todo-card-<id>`) が visible → checkbox を check → reload → card と checkbox checked state が両方残ることを assert → cleanup は card click → `todo-edit-dialog-delete` (新設) + `window.confirm` を accept。 L-DISPATCH-TODO は LLM dispatch の jsonl trace 検証のみで「UI から見て動くか」 は cover していなかった、 本 spec が初の正常系 (user journey) 検証。 fake-friendly (`E2E_LIVE_NO_LLM=1` でも走る) なので CI matrix に登録可能 |
| **L-JOURNEY-CAL** chat で予定 add → /calendar 反映 → UI delete | ✅ 実装済 | journey-llm.spec.ts、 §「最優先方針」 の LLM-add journey 1 本目。 Personal role で `manageCalendar` action='add' を chat dispatch (title=nonce marker, date 2099-12-31) → `/calendar` を list view (`scheduler-view-mode-list`) で開き、 新設 `scheduler-event-item` testid を marker で filter して **LLM mutation が grid に反映** されたことを assert → hover で `scheduler-item-delete-<id>` を出して UI delete + `window.confirm` accept → list から消えることを assert。 cleanup は server-side delete 済なので finally は `deleteSession` のみ (fs 書き込みなし → 共有 items.json への lost-update race を回避)。 LLM 必須 (`E2E_LIVE_NO_LLM=1` で skip) |
| **L-JOURNEY-ACCT** chat で帳簿作成+open → switcher 反映 → chat で delete → DB から消える | ✅ 実装済 | journey-llm.spec.ts、 Accounting role で `manageAccounting` createBook (name=marker, USD/US) + openBook を 1 ターンで dispatch → openBook envelope が chat 内に `accounting-app` を mount → `accounting-book-select` (BookSwitcher の native select) が marker を含むことで **作成帳簿が active book として反映** されたことを assert (headline、 accounting は standalone route が無く openBook 経由でのみ view mount → roles.ts:288 → navigation せず chat inline で検証)。 delete は 2 ターン目で getBooks→deleteBook(confirm=true) を dispatch。 ただし **inline plugin view は次ターンが来ると collapse する** (最新ターンの時だけ展開) ので deleted-notice を in-place で観測できない → delete leg は source-of-truth (`data/accounting/config.json` の `books` から marker 名が消える) を read-only poll (`toPass`) で確認。 初回実走で deleted-notice assertion が collapse で fail → DB 確認に切替えた (run1 triage) |
| **L-JOURNEY-TODO-LLM** chat で todo add → /todos 反映 → check→reload → chat で delete | ✅ 実装済 | journey-llm.spec.ts、 既存 L-JOURNEY-TODO (UI add) の **LLM-add 版**。 Personal role で `manageTodoList` action='add' を chat dispatch → `/todos` の `todo-card-<id>` が marker で visible (LLM mutation の UI 反映) → checkbox check → runtime dispatch flush 待ち → reload で card + checked 永続を assert → chat session に戻り `manageTodoList` action='delete' を dispatch (add/delete 両方 LLM で対称) → `/todos` から card 消失を assert。 「ボタンがあっても LLM 経由 add を見る」 e2e-live の典型例 |
| **L-JOURNEY-COLLECTION** chat で client add (skill 駆動 file-write) → /collections 反映 → UI で delete | ✅ 実装済 | journey-llm.spec.ts、 §「最優先方針」 の follow-up。 **collection には add 用 manage* ツールが無い** ので他 3 journey と経路が異なる — `presentCollection` は表示専用 (`collectionSlug` + optional `itemId`) で、 add は **mc-clients preset skill** が agent に「id を derive して `data/clients/items/<id>.json` を `Write`」 と指示する **skill 駆動の file-write**。 Personal role で chat → `name='<marker>'` の client を mc-clients skill で add → `/collections/mc-clients` (standalone route) を開き、 mount gate に `collections-add-item` (canCreate=true、 非 singleton なので常時可) を待ってから `collections-row-*` を marker で filter → **skill が書いた workspace JSON を `<CollectionView>` が読んで描画した** ことを assert (manage* dispatch を経ない初の「workspace=DB」journey)。 delete は UI: row クリック → `openView` で `collections-detail` 展開 → `collections-detail-remove` → host の `ConfirmModal` (`host-confirm-ok`、 window.confirm ではない) accept → row `toHaveCount(0)`。 必要 testid は全て既存 (source 変更なし)。 cleanup は suite convention 踏襲 (finally は session 削除のみ) — ただし collection item は per-file (`<id>.json`) で shared array でないため finally prune は race-free な点をコメントに明記 (accounting の shared `config.json` との差分)。 LLM 必須 (`E2E_LIVE_NO_LLM=1` で skip) |
| **L-JOURNEY-ROLE** custom role 作成 → selector 反映 → 実 LLM ターン → delete で消える | ✅ 実装済 | journey-llm.spec.ts、 §「最優先方針」 の follow-up。 `manageRoles` は LLM dispatch 不可なので **UI-add 割り切り**だが、 create-form の Playwright driving は pure-UI→REST で mock e2e 領域 → e2e-live 本体は **workspace 定義 custom role が live selector に出て実 LLM ターンを回す** ことに集中 (built-in role しか踏まない既存 roles.spec.ts (L-06〜L-09) の gap)。 create/delete は form ではなく `POST /api/roles/manage` を authed で叩く deterministic な setup/teardown (新 helper **`postAuthedJsonViaPage`** を live-chat.ts に追加、 `fetchAuthedJsonViaPage` の POST 版)。 流れ: REST で `{action:'create', role:{id=name=marker, icon, prompt, availablePlugins:[]}}` 作成 → `setupRoleSession(page, marker)` で切替 (selectRole が `role-option-<marker>` をクリック + `data-role` を assert するので **selector 反映の net を兼任**) → 「greeting を返して」 で実 LLM 1 ターン (`waitForAssistantTurn`) → `{action:'delete', roleId:marker}` → `GET /api/roles` の id 一覧から marker 消失を fail-closed poll (`toPass`)。 role id は marker (`testId-epochMs-hex`) が server の `/^[a-zA-Z0-9_-]+$/` を満たすのでそのまま流用。 testid 追加なし。 LLM 必須 (`E2E_LIVE_NO_LLM=1` で skip)。 create-form 自体の UI 回帰は mock `e2e/` 側で別途張れる |
| **L-FRESH-BOOT** 新規ユーザー smoke (first-run UX) | ✅ 実装済 | fresh-boot.spec.ts (`e2e-live/tests/fresh-boot.spec.ts`) + `e2e-live/fixtures/isolated-dev-server.ts`。 階層 2 + 3 設計通り、 `HOME` / `MULMOCLAUDE_WORKSPACE_PATH` / `PORT` 3 軸 + 認証 token を `MULMOCLAUDE_AUTH_TOKEN` で pin、 `NODE_ENV=production` で express が SPA を serve、 `DISABLE_SANDBOX=1` で sandbox build を回避。 `dist/client/` の参照先を `MULMOCLAUDE_CLIENT_DIR` env で振り直す test seam を `server/index.ts` に追加 (prepare-dist が `client/` に copy する production layout を前提とする既定値は不変、 source-run の test だけ override)。 spec は (a) `/api/health` 200、 (b) workspace dir auto-init (`conversations/chat` / `config/helps` / `.session-token`)、 (c) `<meta name="mulmoclaude-auth">` token 注入、 (d) 1 ターン `Reply with the single word: okfresh-<nonce>` の assistant body marker echo、 (e) cleanup 後 host `~/mulmoclaude/` / `~/.claude/skills/` mtime 不変、 の 5 段で boot path 連動性を保証。 helper (`spawnIsolatedDevServer` / `stopIsolatedDevServer` / `assertHostUntouched`) は今後 L-10 / L-13 / L-FRESH-PRESET-SKILL で再利用する設計。 wall time ~15-19s。 `yarn test:e2e:live:fresh-boot` で単独実行可能、 CI no-LLM matrix は spec が自前 server を spawn する構造のため意図的に未登録 (docker.spec.ts と同じ位置付け) |

### 未実装シナリオの再評価 (2026-05-23)

未実装系のうち、 plan 起票時 (2026-04-29) と現状で前提が変わっているもの、 および後から追加した fresh-user smoke 系を再評価。

| シナリオ | 状態 | 評価 |
|---|---|---|
| **L-10** Gemini key 未設定 General | 保留 | dev `.env` を空にした test 専用 dev server (`MULMOCLAUDE_WORKSPACE_PATH=/tmp/mc-e2e-l10` + `E2E_LIVE_BASE_URL` 切替) が前提。 共有 dev では検証不可。 「環境を壊さず再現する設計指針」 階層 2 で実装可能、 ただし 専用 dev server 起動の infra (案 C 拡張) と同 PR で扱う |
| **L-13** サーバ再起動後の bridge 再接続 | 保留 | L-10 と同じく test 専用 dev server が前提。 spec 内で server kill → restart の操作シーケンスを書く必要、 通常の e2e-live spec より infra-heavy。 専用 skill で扱うことを検討 |
| **L-17** notifier 二重通知 (B-50) | ✅ **実装済** | /api/agent が元から `origin` body parameter を受け取る (server/api/routes/agent.ts:121, 219) ことを利用し、 Playwright から直接 `origin: "bridge"` で POST して PR #818 が commented out した `publishNotification(...)` の gate (agent.ts:985 付近の `if (params.origin !== SESSION_ORIGINS.human)`) を踏ませる canary。 `ui.spec.ts` で baseline entry id 集合 → bridge run → idle 待ち → post entry 集合 → 新規 entry のうち `pluginPkg === "agent"` かつ `pluginData.sessionId === bridgeSessionId` を満たすもの (= PR #818 regression の precise shape) が 0 件 assert。 production code path をそのまま使うので追加面ゼロ、 env 不要、 fake-echo / real LLM どちらでも動く。 fixtures に `startBridgeOriginAgentRun` 追加 + 既存 `waitForSessionIdle` を export 化 |
| **L-24** ~~`yarn sandbox:login` image 不在~~ | **廃止** | 二重の理由で廃止。 (1) ID 重複: `e2e-live/tests/workspace-link-routing.spec.ts:134` で `L-24` が既に別シナリオ (wiki ページ Markdown link) に使用済 (CodeRabbit iter-1 指摘で発覚)。 spec 側 rename は本 PR scope 外、 follow-up TODO 化。 (2) plan 解釈と現実装の乖離: 現 `yarn sandbox:login` (`package.json:63`) は keychain export スクリプトで image チェックを持たず、 B-02 の元症状 (image 不在) は `ensureSandboxImage` in `server/system/docker.ts` で発火する別経路。 検証対象は **L-FRESH-SANDBOX-BUILD** (fresh-user smoke 群) が `MULMOCLAUDE_SANDBOX_IMAGE` env で host 環境を汚さず正確に cover する |
| **L-25** root 権限ファイル副作用 | manual-l4 | `docs/manual-testing.md` のチェックリストへ。 自動化対象外で確定 |
| **L-27** Mac Keychain credential expire | manual-l4 | 同上 |
| **L-29** MCP server Docker crash (B-07) | **対象外推奨** | PR #429 で fix 済、 現コードで crash 再現不能。 既存 unit test (`test/agent/test_agent_config.ts` の `buildDockerSpawnArgs` 11 cases) で構造的退行は cover 済。 「tautology spec」 (修正済 PR の再発検出だけを書く) は機能別 unit test の責務、 e2e-live に乗せる価値が薄い。 実装ステータス表からは 「対象外」 ラベルで除外することを推奨 (上記 「機能別 unit test / mock e2e との分担」 の e2e-live 除外基準と整合) |
| **L-30** skill + symlink dangling | ✅ **実装済** | 設計通り、 階層 1 で局所再現。 docker.spec.ts に `placeBrokenSymlinkSkill` (新規 helper) + sibling 用の `placeProjectSkill` を組み合わせ、 broken symlink slot が silently skip され (rowなし) かつ valid sibling は visible で discovery 生存を assert。 当初想定していた `/api/config/refresh` 経由の更新は不要 (discovery は per-call で fresh readdir/stat、 cache なし) と確認できたので skip。 host `~/.claude/skills/` は触らない |
| **L-FRESH-BOOT** 新規ユーザー smoke | ✅ **実装済** | 設計通り 階層 2 + 3 で実装。 `spawnIsolatedDevServer` helper (`e2e-live/fixtures/isolated-dev-server.ts`) で `HOME` / `MULMOCLAUDE_WORKSPACE_PATH` / `PORT` 3 軸隔離 + `MULMOCLAUDE_AUTH_TOKEN` pin + `~/.claude/.credentials.json` copy + 自動 `yarn build:client` (`dist/client/` 不在時)、 spec (`fresh-boot.spec.ts`) は 5 段検証 (health / workspace init / SPA token / 1 ターン marker / host untouched)。 詳細は 「実装ステータス」 表参照 |
| **L-FRESH-SANDBOX-BUILD** image 不在 → auto-build | **実装可能** (要 env 新設) | L-FRESH-BOOT の枠 + `MULMOCLAUDE_SANDBOX_IMAGE` env 新設 (階層 3)。 sandbox image を test 専用名で参照させて 「image が無い」 状態を疑似、 host の `mulmoclaude-sandbox:latest` を消さずに済む |
| **L-FRESH-PRESET-SKILL** preset skill mirror | **実装可能** (要 infra) | L-FRESH-BOOT と同じ infra で空 workspace 起動 → preset migration 経路 (catalog → bridge mirror) を end-to-end で検証 |

## 優先度方針 (2026-05-27)

> **未踏領域の coverage > バグ回帰の再発検出 net**。

これまでの実装順は 「壊れた時の影響が大きいバグ軸の再発防止」 を第一軸にしていたが、 happy-tour 着手時 (2026-05-27) に 「plugin の 1 ターン dispatch test が大量に欠けている」 ことが顕在化した。 バグ軸の retroactive net より、 まだ end-to-end で **一度も触られていない** 機能の 1 ターン canary を先に立てる方が ROI が高い。 理由:

- 既知バグの net は unit test / mock e2e でも代替可能なケースが多い (落ちる shape が判っているので低レイヤで書ける)
- 未踏領域は 「壊れていることに誰も気付かない」 状態が長期化しやすい (2026-05-25 報告の preset bundle 漏れがその典型)
- 1 plugin × 1 ターン dispatch test は shape が既存 L-21 / L-21B と同型で 1 spec / 30〜60 分で書ける

したがって以降の Phase 1 着手候補は **「まだ 1 ターン LLM test が無い plugin / 機能」 を最優先**、 既存バグの retroactive net は Phase 2 以降に降格する。

### 未踏 plugin の 1 ターン dispatch test 棚卸し (2026-05-27)

| plugin / 機能 | tool name | 1 ターン test 有無 | 備考 |
|---|---|---|---|
| **todo** | `manageTodoList` | ✅ L-DISPATCH-TODO | plugin-dispatch.spec.ts (Personal role + jsonl trace canary) |
| scheduler (calendar) | `manageCalendar` | ✅ L-DISPATCH-CAL | 同上 (Personal role) |
| scheduler (automations) | `manageAutomations` | **対象外** | settings role 廃止 (#1283) + 3 つの preset skill に分割 (#1295) で、 `src/config/roles.ts:252` のコメント通り、 どの built-in role の `availablePlugins` にも未登録 → LLM dispatch path に乗らない (manageRoles / manageSource と同 status)。 /automations route + view-mount は L-HAPPY-TOUR step 11 でカバー済 |
| markdown | `presentDocument` | ✅ L-DISPATCH-MD | 同上 (General role)。 `updateMarkdown` tool は存在しない (route のみ、 plugin-dispatch 着手時に判明) |
| spreadsheet | `presentSpreadsheet` | ✅ L-DISPATCH-XLS | 同上 (Office role)。 `updateSpreadsheet` tool 不在 (markdown と同じ pattern) |
| presentSVG | `presentSVG` | ✅ L-DISPATCH-SVG | 同上 (Artist role) |
| presentHtml | `presentHtml` | ✅ L-DISPATCH-HTML | 同上 (Office role)。 L-01 は file seed 経由なので LLM dispatch path とは別レイヤ、 本 spec が初の dispatch canary |
| manageRoles | `manageRoles` | **対象外** | どの built-in role の `availablePlugins` にも未登録 → 通常 chat から LLM dispatch 不可。 role gating 変更 (out-of-scope) が必要 |
| manageSource | `manageSource` | **対象外** | 同上 (role gate 無し、 dispatch path が踏めない) |
| accounting | `manageAccounting` | ✅ L-DISPATCH-ACCT | plugin-dispatch.spec.ts (Accounting role + createBook action) |
| spotify (preset) | `spotify` | ❌ | OAuth 必要、 後回し可 |
| edgar (preset) | `edgar` | ❌ | 設定必要、 後回し可 |
| news | (read-only view) | ❌ | tool dispatch 無し、 view mount は happy-tour で cover 済 |
| presentMulmoScript | ✅ L-03 / L-04 | | |
| chart | ✅ L-21 | | |
| encore | ✅ L-21B | | |
| generateImage | ✅ L-05 | | |
| presentForm | ✅ L-18 | | |
| skill | ✅ L-22 / L-31 / L-32 / L-33 | | |

実装順は **(a) preset で日常使用される todo / scheduler 系を最優先、 (b) 表示系 (markdown / spreadsheet / SVG / presentHtml) を次、 (c) manageX 系 (roles / source) と accounting、 (d) 外部設定必要な spotify / edgar は infra が揃ってから** の順。 各 spec は L-21 shape を踏襲: 確実な prompt + tool 呼出 jsonl trace 確認 + view side-effect (file / DOM marker) 確認 + cleanup。

## 実装確認の規律 (2026-05-27)

> **新規 spec を追加したら必ず手元で 1 回 pass を確認してから commit する**。 LLM コスト / API call 数を理由に 「lint / typecheck / build が通ったら OK とする」 のは禁止。

backstory: 2026-05-27 の happy-tour 着手で、 spec 著者 (Claude) が 「dev server が main 側だから testid が反映されてない」 「LLM コストが気になる」 を理由に実行を skip し、 lint / build のみで commit を進めた結果、 ユーザーが headed で初回実行した時に step 3 (`/api/plugins/diagnostics` payload shape ミス) + step 6 (`/todos` route が mount するコンポーネント の誤認 — `TodoExplorer.vue` vs `todo-plugin/View.vue`) の 2 件の load-bearing バグが連続で発覚した。 lint / build は **「型と構文が合っているか」 しか見ていない**、 「assertion が実際の payload / DOM と噛み合うか」 は 1 回回さないと判らない。

具体規律:

- MUST 新規 / 大幅改修した spec は手元で **`yarn test:e2e:live:<category>`** を 1 回 pass まで通してから commit
- MUST dev server が別 branch (main 等) で起動している場合は worktree 側で立て直す依頼を user に出す。 「現状の dev で動かないから skip」 は NG
- LLM コスト / API call 数は理由にしない — `/make-e2e-live` 上で skill が動いている時点で実 LLM cost は許容範囲、 ユーザーが明示的に skip を指示するまで実 LLM で回す
- API shape を assert する場合は **必ず route handler を読んでから書く** (server/api/routes/<name>.ts)。 推測で envelope 形 (`unknown[]` vs `{ data: [...] }`) を決めない
- route と view の関係を assert する場合は **必ず App.vue の `currentPage === 'X'` 分岐を読んでから書く** (`/todos` ↔ `TodoExplorer.vue` のような host vs plugin の取り違えを防ぐ)

これは `/make-e2e-live` skill の Phase 4 「必須チェック」 セクションにも反映する (skill 側の更新は別 PR で良い、 plan 側に source-of-truth を残す)。

## 実装順 (2026-05-23 時点)

未実装シナリオ + 反映候補 PR を **重要度 (= 必要度) ベース** で並べた次に着手するロードマップ。 同重要度内では infra 依存が少ない順 (= 早く 1 PR で完結する順) で配置するが、 「楽な順」 ではなく 「壊れた時の影響が大きい順」 が第一軸。

### Phase 1: 即着手可能 (高重要度 + 1 PR 完結)

1. ~~**L-30 skill symlink dangling (B-08、 docker)**~~ — ✅ 実装済 (PR #1492、 docker.spec.ts)。 階層 1 設計指針通り、 ユーザー環境を一切触らない broken symlink seed + valid sibling 対比で discovery resilience を end-to-end で検証
2. ~~**encore plugin dispatch canary (#1437 / #1440 / #1441 / #1443)**~~ — ✅ **L-21B として実装済** (PR #1493、 skills.spec.ts)。 元: 重要度 **A**、 L-21 (chart) shape を copy するだけ。 新 plugin の deferred-tool dispatch が壊れると plugin View 全消失する退行に直結。 runtime plugin が増えるトレンドで net 強化の効果が最大
3. ~~**L-HAPPY-TOUR 正常系 sweep**~~ — ✅ **実装済** (happy-tour.spec.ts)。 重要度 **A**。 2026-05-25 報告 (`@mulmoclaude/todo-plugin` bundle 漏れ) のような **「個別 spec で見ていない領域でアプリ全体が破綻する」** クラスの退行 net を 1 spec / 12 step で構築。 assertion を `e2e-live/lib/health-checks.ts` に pure 関数で切り出し、 doctor CLI / pre-release smoke で再利用可能な形にした (Spec / CLI 2 経路、 packaged-tarball 用に `requireDevOnly` flag を残してある)

### Phase 2: 前提 PR + 本体 PR (中〜高重要度、 要 infra 整備)

3. ~~**L-17 二重通知 (B-50)**~~ — ✅ **実装済**。 当初検討した env-gated HTTP publish 復活 / notify MCP 経路 / 直接 inject endpoint はいずれも採用せず、 最終形は **Playwright が /api/agent を `origin: "bridge"` で直接 POST して agent.ts publishNotification gate を踏む** canary に着地。 production code path をそのまま使い env / HTTP 追加面ゼロ。 「未実装シナリオ詳細 → L-17」 と 「未実装シナリオの再評価」 を参照
4. ~~**test 専用 dev server spawn infra**~~ — ✅ L-FRESH-BOOT 同梱で landing (`e2e-live/fixtures/isolated-dev-server.ts`)。 helper は `HOME` / `MULMOCLAUDE_WORKSPACE_PATH` / `PORT` / `MULMOCLAUDE_AUTH_TOKEN` の 4 軸を 1 関数で抽象化、 `dist/client/` 自動 build 付き。 当初想定した「`/e2e-live-matrix` skill に集約」 まではしていない (artifact mode / Docker on-off 軸は別 PR に分割)。 後続 (L-10 / L-13 / L-FRESH-*) は今回の helper を再利用可能
5. ~~**L-FRESH-BOOT 新規ユーザー smoke**~~ — ✅ 実装済。 infra 同梱 1 PR 完結。 5 段 assertion (health / workspace init / SPA token / 1 ターン marker / host untouched) で first-run UX を end-to-end 保証
6. **L-10 Gemini key 未設定 / L-13 bridge 再接続** — infra (4.) を使って同 PR or 連続 PR で拾える。 `spawnIsolatedDevServer` に `env` 追加 hook (Gemini key 削除 / restart trigger) を入れる形で extend

### Phase 3: 中重要度 (個別、 1 PR 完結)

7. ~~**mc-cooking-coach preset skill canary (#1287)**~~ — ✅ **L-33 として実装済** (skills.spec.ts)。 元: 重要度 **B**、 L-32 shape を copy。 preset skill の chain net を密にする
8. **solopreneur runtime plugins (client / worklog / plans、 #1471 / #1464 / #1465 / #1475)** — 重要度 **B**、 plugin 数増加トレンドの先頭で 1 plugin (client 推奨) でまず 1 PR 書き、 helper 抽出 / parameterized 化の機会を見極める
9. **L-FRESH-PRESET-SKILL** — 重要度 **B**、 infra (4.) の上で 1 PR。 preset migration 経路の end-to-end net

### Phase 4: 再評価 / drop / 重コスト

10. **L-FRESH-SANDBOX-BUILD** — 重要度 **B** だが `MULMOCLAUDE_SANDBOX_IMAGE` env 新設 (source PR) + build に分単位かかる (CI 不向き)。 手動 skill 専用の前提で位置付け、 着手は他 Phase が片付いてから
11. ~~**L-24 sandbox:login image 不在 (B-02)**~~ — **廃止**。 ID 重複 (workspace-link-routing.spec.ts で同 `L-24` を別シナリオに使用済) + plan 解釈と現実装の乖離 で deprecate。 検証対象は **L-FRESH-SANDBOX-BUILD** が代替する。 「未実装シナリオの再評価」 を参照
12. **L-29 MCP server crash (B-07)** — 対象外推奨。 unit test (`test/agent/test_agent_config.ts` の `buildDockerSpawnArgs`) で構造的退行は cover 済、 e2e-live への移植は tautology spec

### docker 系の優先度

「docker 系は早い方が良い？」 の問いには **L-30 を Phase 1 に置く** ことで応えていた。 docker 系で残る他のシナリオ (L-24 は廃止、 L-29 は対象外推奨) は drop / 統合になるため、 e2e-live で着手できる docker シナリオは **L-30 が最大の ROI** だった。 L-30 は本セッションで docker.spec.ts に追記済 (PR #1462 の L-23 / L-26 / L-28 と同じファイル) で、 これにより docker 系の e2e-live cover はひとまず想定範囲を満たした。 残る docker トピック (L-FRESH-SANDBOX-BUILD = sandbox image 不在からの auto-build) は Phase 4 の通り `MULMOCLAUDE_SANDBOX_IMAGE` env 新設 + 分単位 build を要するため別途扱う。

なお boot path 系の **個別経路** (dev server boot / sandbox image build / MCP catalog 初期化 / CLI spawn args 構築) はすべて既存の unit test (`test/system/`、 `test/agent/test_agent_config.ts` の `buildDockerSpawnArgs` 11 cases) で構造的退行を cover している。 一方で **「first-run UX として連動する」 経路** (起動 → workspace auto-init → SPA hydrate → 1 ターン送信) を end-to-end で見るネットは fresh-user smoke (`L-FRESH-BOOT` 等) で扱う方向で plan に追加した — 「未実装シナリオ詳細 → fresh-user」 参照。 ユーザー指摘で 「新規ユーザーがちゃんと動かせるかどうかのテストがほしい」 という具体的な需要が顕在化したため、 当初の 「e2e-live で boot path 自体を見る新規シナリオは起こさない」 という立場から方針転換している。

## 実装の詳細

### `e2e-live/fixtures/live-chat.ts` の helper 一覧

実装済の helper（後続シナリオはこの形をベースに足していく）:

| helper | 用途 |
|---|---|
| `startNewSession(page)` | `/` に goto → `new-session-btn` クリック |
| `sendChatMessage(page, text)` | `user-input` fill → `send-btn` click |
| `selectRole(page, roleId)` | `role-selector-btn` click → `role-option-<roleId>` click (chat page では新セッション払い出し) |
| `waitForAssistantResponseComplete(page, timeoutMs?)` | `thinking-indicator` testid が hidden になるまで待つ |
| `waitForImgInPresentHtml(page, imgSelector, timeoutMs?)` | presentHtml iframe 内の `<img>` が visible になるまで待つ |
| `readImgSrcInPresentHtml(page, imgSelector)` | iframe 内の `<img>` の `src` 属性を取得（リライト後の URL 検証用） |
| `readImgNaturalSize(page, imgSelector)` | iframe 内の `<img>` の `naturalWidth/Height` を取得（実描画確認） |
| `waitForGeneratedImage(page, timeoutMs?)` | generateImage View 内 (`[generate-image-view]`) の `<img>` が visible になるまで待つ |
| `readGeneratedImageSrc(page)` | generateImage View 内の `<img>` の `src` 属性を取得（`/artifacts/images/...` 検証用） |
| `readGeneratedImageNaturalSize(page)` | generateImage View 内の `<img>` の `naturalWidth/Height` を取得（実描画確認） |
| `readPdfDownload(download)` | `Download` を読み込み `%PDF-` magic bytes を検証、Buffer 返す |
| `readMovieDownload(download)` | `Download` を読み込み MP4 の `ftyp` magic bytes を検証、Buffer 返す（L-03 用） |
| `placeFixtureInWorkspace(fixtureRel, workspaceRel)` | `e2e-live/fixtures/<fixtureRel>` を `~/mulmoclaude/<workspaceRel>` にコピー |
| `placeWorkspaceFile(workspaceRel, body)` | インライン文字列を `~/mulmoclaude/<workspaceRel>` に書き込む（fixture json を持たずに済むケース用） |
| `readWorkspaceFile(workspaceRel)` | `~/mulmoclaude/<workspaceRel>` の raw テキストを読む。 存在しなければ `null`（snapshot/restore 用、 L-SETTINGS-EFFORT で `config/settings.json` を round trip） |
| `removeFromWorkspace(workspaceRel)` | best-effort delete（finally で呼ぶ） |
| `placeWikiPage(slug, body)` / `removeWikiPage(slug)` | `data/wiki/pages/<slug>.md` を直接置く / 消す |
| `replaceWikiIndex(content)` / `restoreWikiIndex(original)` | `data/wiki/index.md` を一時差し替えして `original` 文字列で復元 (L-16 が共有 index を mutate するため) |
| `navigateToWikiIndex(page)` / `navigateToWikiPage(page, slug)` | `/wiki` / `/wiki/pages/<slug>` に直遷移 |
| `getCurrentSessionId(page)` | URL から `/chat/<id>` を抽出 |
| `startGuaranteedNewSession(page)` | `startNewSession` の race-free 版。 SPA の auto-redirect で stale session id を掴むのを防ぐ。 jsonl 直読み spec が新 session id を必要とする時用 (L-31 / L-32) |
| `waitForAssistantTurn(page, timeoutMs?)` | `waitForAssistantResponseComplete` の strict 版 (`thinking-indicator` の出現も待つ)。 jsonl / fs assertion で fast-path race を起こさないために使う (L-31 / L-32) |
| `readSessionToolCalls(sessionId)` | `<workspace>/conversations/chat/<id>.jsonl` から `tool_call` レコードを順に返す。 `Write` against `data/skills/<slug>/SKILL.md` 等の dispatch 検証用 (L-31) |
| `stagingSkillSlugFromWriteCall(call)` | `Write` tool_call の `file_path` から `data/skills/<slug>/SKILL.md` の slug を抽出。 post-#1298 bridge dispatch canary 用 (L-31) |
| `snapshotProjectSkillSlugs()` / `readProjectSkillBody(slug)` | `.claude/skills/` 直下の slug 一覧と `<slug>/SKILL.md` 本文。 baseline diff + marker hit で test-owned slug を識別する outcome canary 用 (L-32) |
| `placeProjectSkill(slug, description, body)` / `removeProjectSkill(slug)` | `.claude/skills/<slug>/SKILL.md` を直接 seed / cleanup。 後者は post-#1298 を意識して staging `data/skills/<slug>/` も併せて消す (L-22 / L-31 / L-32) |
| `deleteSession(page, sessionId)` | `DELETE /api/sessions/:id` で hard delete（best-effort、auth は `<meta name="mulmoclaude-auth">` から） |

### testid 必要時の追加方針

実装済の追加: `present-html-iframe`（`src/plugins/presentHtml/View.vue` の iframe）、`text-response-pdf-button`（`src/plugins/textResponse/View.vue` の PDF ボタン）、`mulmo-script-generate-movie-button` / `mulmo-script-download-movie-button` / `mulmo-script-regenerate-movie-button`（`src/plugins/presentMulmoScript/View.vue` の動画操作 3 ボタン、 L-03 用）、 `generate-image-view`（`src/plugins/generateImage/View.vue` の wrapper、 L-05 用）、 `present-form-view`（`src/plugins/presentForm/View.vue` の wrapper、 L-18 用 — view 全体の textContent を見て raw i18n key prefix 漏れを検出する形なので button や label 単体に絞らない設計）。

新規 testid を追加する時は:
- `data-testid="<plugin>-<role>"` の kebab-case で命名（既存規則）
- 翻訳テキストや `iframe[sandbox]` のような構造的属性を当てにしない（脆い）
- 同じ PR で既存の View.vue を 1 行修正するのは OK（小さな変更）

### Playwright API の選び方（罠あり）

- **iframe 内 DOM へのアクセスは必ず `frameLocator` 経由**。`page.evaluate` + `iframe.contentDocument` は Vue が `srcdoc` を更新するたびに古い document を見て null を返す挙動を踏む（実機で確認）
- **iframe `toBeVisible` だけでは早すぎる**。iframe 要素は srcdoc レンダー前に DOM に append されるので、内側の特定要素 (`<img>` 等) を `frameLocator(...).locator(...)` で待つ
- **assertion 達成後に `waitForAssistantResponseComplete` を呼ぶ**。Playwright は assertion pass の瞬間にテストを終了させ、その時点で trace / video が切れる。LLM が応答中だと録画から後半が消える
- **cleanup は finally + best-effort**。teardown 失敗で passing test が赤になるのを避ける

### 画像戦略

- **fixture 再利用**（L-01〜L-04, L-06）: `e2e-live/fixtures/images/sample.png`（`src/assets/mulmo_bw.png` のコピー）を spec ごとに **ユニークな workspace path** へコピー → LLM にそのパスを示して `<img>` / `![]()` で参照させる
- **実生成 1 枚**（L-05）: generateImage 経路自体を検証するため、実際に画像生成
- workspace の path は spec 名を含める（例: `artifacts/images/e2e-live-l01.png`）。複数 worker が並列実行されてもファイル名衝突しない

### mulmoScript fixture + filePath パターン（L-03 で確立）

L-03 を実装するなかで、 mulmoScript シナリオで再利用可能なパターンが固まった。 動画系 / mulmoScript 系の後続シナリオ（L-04 animation:true, mulmocast 関連の bridge / pre-release matrix など）で同じ枠を踏襲する。

#### 1. fixture json を repo に持つ（LLM に script を作らせない）

LLM に mulmoScript JSON を生成させると揺れが大きい（image / imagePrompt / textSlide / markdown / animation の選択、 speakers / model 設定、 description フィールドの省略など）。 spec の本旨が「DL 経路」 「動画 compose」 等であれば script の中身は決定論的で良いので、 `e2e-live/fixtures/mulmo/<scenario>.json` を repo に置き、 LLM には **`presentMulmoScript({ filePath: "stories/<...>" })` を呼んでくれ** と一文だけ指示する。 1 ツール 1 引数の単純呼出なので LLM はほぼ確実に従う。

#### 2. disk path と LLM wire form の **二重化** に注意

mulmoclaude では `WORKSPACE_DIRS.stories = "artifacts/stories"`（`server/workspace/paths.ts`）なので:

- **disk 上**: `~/mulmoclaude/artifacts/stories/<file>.json`（fixture seed 先）
- **LLM wire form**: `stories/<file>.json`（presentMulmoScript の filePath 引数に渡す形式、 server の `resolveStoryPath` が `STORIES_PREFIX` を strip して `artifacts/stories/` 配下を resolve する）

spec 内では別変数で持つ（`workspaceScriptRel` と `wireFilePath`）。 同一に書くと server が 404 を返してテストが「mulmoScript view 未表示で 1 分 timeout」 する罠（L-03 開発初期に踏んだ）。

#### 3. TTS / 画像生成 API を呼ばない fixture の作り方

mulmocast schema より:

- `text: z.string().optional().default("").describe("If empty, the audio is not generated.")`
- `duration: z.number().optional().describe("Used only when the text is empty")`

→ **全 beat で `text: ""` + `duration: <秒数>`** にすれば TTS API は呼ばれない。 image は **local-render type のみ** で揃える:

| image type | API 呼ぶ |
|---|---|
| `textSlide` / `markdown` / `chart` / `mermaid` / `html_tailwind` | ❌ ローカル合成 |
| `imagePrompt` / `moviePrompt`（top-level field） | ✅ image / video gen API |

L-03 fixture (`e2e-live/fixtures/mulmo/l03-two-beat.json`) は textSlide 2 beat + text 空 + duration 1 で TTS / image API ともに 0 呼出 → cost 数円以下、 `GEMINI_API_KEY` 不要。

#### 4. 並列 worker の衝突回避（project slug suffix）

server `mulmo-script.ts` の `runMovieGeneration` は `inFlightMovies` set で `absoluteFilePath` 単位で動画生成の重複起動を防ぐ。 chromium / webkit が同じ fixture path を共有すると **片方の worker がガードに弾かれて Download Movie button が visible にならず 8 分 timeout** する。

回避: spec 内で fixture filename に `testInfo.project.name` を埋める。

```ts
test("...", async ({ page }, testInfo) => {
  const slug = testInfo.project.name; // "chromium" or "webkit"
  const workspaceScriptRel = `artifacts/stories/<scenario>-${slug}.json`;
  const wireFilePath = `stories/<scenario>-${slug}.json`;
  // ...
});
```

L-03 で「chromium pass / webkit 8 分 timeout」 という mixed result を見たら同じ症状を疑う。

#### 5. ffmpeg system 依存（test.skip で逃がす）

mulmocast は `fluent-ffmpeg` で **system ffmpeg を spawn** する（npm pkg に bundle されていない）。 ffmpeg のない端末では動画 compose が無音失敗する。 spec 冒頭で `which ffmpeg` を `execSync` してチェックし、 missing なら `test.skip(true, "...")` で逃がす。 PATH に ffmpeg が無いだけで赤くなるのを防ぐ + 何が足りないかを skip メッセージで明示。

一般ユーザー側 (`npx mulmoclaude` で動画生成を試す導線) で ffmpeg 要件が docs に未記載な件は別件 issue #1049 で起票済み。

#### 6. 検証は magic bytes + サイズ floor（中身の正しさは別 spec）

DL 経路 (B-21) の sanity 確認は `readMovieDownload` helper の **MP4 `ftyp` box at offset 4** + 1 KiB floor で十分。 「動画が本当に再生できるか」 「想定 beat 数か」 「audio track があるか」 は L-04 / 別 spec の責任分担にする（spec ごとにスコープを 1 つに絞る）。

### 画像 URL / presentHtml の現仕様（PR #969 / #972 / #982 以降）

最新仕様（PR #982 = `feat-presenthtml-filepath-only`）:

- `presentHtml` は `data.html` を返さず `data.filePath` のみ。 サーバが `~/mulmoclaude/artifacts/html/<YYYY>/<MM>/<slug>-<ts>.html` として保存
- View.vue の iframe は `<iframe :src="/artifacts/html/<rest>">` （静的マウント経由配信）。 `srcdoc` 経路は廃止
- `sandbox` は `allow-scripts` のみ（`allow-same-origin` / `allow-modals` 削除）
- `rewriteHtmlImageRefs` は **削除済**

LLM への新ルール（`presentHtml/definition.ts` の tool description に明記）:

- ワークスペース内のリソースは **相対パス** で参照する
- HTML が `artifacts/html/<YYYY>/<MM>/` に保存されるので、 `artifacts/<kind>/...` への相対は `../../../<kind>/...` （3 段上がる）
- `<img src="/artifacts/...">` のような絶対パスは BAD（`file://` で開くと壊れる）

L-01 の検証ポイント:

- `src` 属性が `e2e-live-l01.png` を含むこと（リテラル一致）
- `src` が `/artifacts/...` で始まら**ない**こと（LLM が新ルール違反していないかの guard）
- `naturalWidth > 0`（end-to-end の本質的な signal — 画像が実際に decode されたか）
- `readImgRepairAttempted` が `false`（PR #974 の onerror self-repair が発火していないこと — self-repair は `/artifacts/images/...` の絶対パスを修正するため、LLM が絶対パスを吐いても naturalWidth > 0 になって false-pass になる罠を防ぐ）

`/artifacts/images/...` は依然 Express 静的マウントで配信されているので、 ブラウザは `<base href>` (= iframe の `src` の親ディレクトリ `/artifacts/html/<YYYY>/<MM>/`) に対して `../../../images/<file>` を解決して `/artifacts/images/<file>` を fetch する。

### LLM 応答のばらつき吸収

- LLM が presentHtml / textResponse を確実に呼ぶよう、 prompt に「以下の HTML を presentHtml ツールでそのまま表示してください」「次の Markdown を **そのまま** 1 ターンの返信本文として返してください」のように明示
- 検証は **DOM 状態** を見る（応答テキストは見ない）。応答テキストの揺れに依存しないので安定する
- 数値閾値（PDF サイズ等）は **緩めに**。最低限の本物の出力 vs 空 stub の判別ができれば十分

### 認証

- `mockAllApis(page)` を呼ばない
- bearer token は SPA と同じ経路で取得: `<meta name="mulmoclaude-auth" content="...">` を `page.evaluate` 内で読む
- 起動前の認証状態検証は省略（dev サーバ起動時点で必ず token があるので、`yarn dev` 動いてれば OK）
- timeout: 単一 LLM 応答 60s、生成系（PDF/動画）5 分

### レポート出力先（カテゴリ別 subdir）

`E2E_LIVE_REPORT_SUBDIR` 環境変数で出力先サブディレクトリを切替できる:

- 親 `/e2e-live`（env なし）→ `playwright-report-live/index.html` + `test-results-live/`（全 spec の結果が 1 つの HTML レポートに並ぶ）
- 子 `/e2e-live-media`（`E2E_LIVE_REPORT_SUBDIR=media`）→ `playwright-report-live/media/index.html` + `test-results-live/media/`
- 同様に各カテゴリ skill が固有の subdir を使う

これにより:

- 親 skill 1 回実行で全カテゴリの結果が **1 つのレポート** に並ぶ（ユーザー要件の「全部の結果が残る」を満たす）
- 子 skill を後から個別実行しても、 親レポートを **上書きしない**
- 子 skill 同士も互いに独立（`media/` と `roles/` は別ディレクトリ）

`package.json` の各カテゴリ script に `cross-env E2E_LIVE_REPORT_SUBDIR=<category>` を入れて切替する。

### 環境を壊さず再現する設計指針

e2e-live は ユーザーの手元 dev 環境 + workspace + `~/.claude/` を共有して走る。 spec が destructive な状態変更 (sandbox image 削除、 host `~/.claude/skills/` 改変、 dev server kill) を要求すると 「テスト後の手作業 cleanup」 が必須化して運用負荷が上がる。 以下の階層で再現方法を選び、 上の階層で取れるものは下に降りない。

#### 階層 1: spec scope で局所 seed (最優先)

ユーザーの実環境を一切触らず、 テスト固有 unique slug (`testInfo.title` ベースの nonce) でデータを seed → `finally` で削除。 既存実装の helper (`placeFixtureInWorkspace` / `placeWikiPage` / `placeProjectSkill`) はすべてこの階層。

例:

- **L-30** skill が dangling symlink で sandbox 内に見えない: host `~/.claude/skills/` 全体を symlink 化しない。 共有 workspace の `.claude/skills/<test-nonce>` 配下に broken symlink を seed して、 sandbox 内で対象 slug が見えないことを assert → finally で symlink 削除
- **L-16 / L-WIKI-LINT-MISSING / L-WIKI-LINT-TAG-DRIFT**: `replaceWikiIndex` + `restoreWikiIndex` で round-trip、 `describe.serial` で衝突回避

#### 階層 2: 共有 dev server の env で隔離 (test-only dev server)

`MULMOCLAUDE_WORKSPACE_PATH` env (`server/workspace/paths.ts:89`) で workspace root を任意 dir に振れる。 spec 側からは切替不能 (server 起動時固定) なので、 skill 側で `MULMOCLAUDE_WORKSPACE_PATH=/tmp/mc-e2e-<topic> yarn dev:server &` で AI 制御の test 専用 dev server を別 port で立てて、 spec は `E2E_LIVE_BASE_URL` で baseURL を切替える形にする (上記 「Docker on/off 自動化検討」 案 C と同枠)。

階層 1 で取り切れないケースで使う:

- **L-10** Gemini key 未設定で General role: `.env` を空にした test workspace を `MULMOCLAUDE_WORKSPACE_PATH` で指して別 port の dev server を起動
- **L-13** サーバ再起動後の bridge 再接続: 同じく test-only dev server を立てて kill / restart させる

#### 階層 3: ソース改修 + env 新設 (最終手段)

階層 1, 2 で再現できない箇所は env 新設の PR を別に立てる。 現状の候補:

- **`MULMOCLAUDE_SANDBOX_IMAGE` env 新設** — `server/system/docker.ts:13` と `server/agent/config.ts:553` に `"mulmoclaude-sandbox"` がハードコード。 image 不在状況の test 再現には 「存在しない image 名 (`mulmoclaude-sandbox-e2e-nonexistent`) を env で指定」 経路が欲しい。 L-FRESH-SANDBOX-BUILD で活用する (B-02 系の検証は廃止 L-24 ではなくここに統合)
- ~~**L-17 用 notifier inject endpoint**~~ ✅ **解消済** — endpoint / detector 追加せずに済んだ。 /api/agent が元から `origin` body parameter を受け取ることに気づき、 Playwright から直接 `origin: "bridge"` で POST して agent.ts の publishNotification gate を踏ませる形で実装。 notifier route も fake-echo も触らず production code path をそのまま使う (`00f4a740` の trust boundary 維持)、 env 不要

**禁止事項**:

- spec / skill が `docker rmi mulmoclaude-sandbox` などの破壊的 docker 操作を行う (再 build に分単位、 ユーザー dev が止まる)
- spec が `~/.claude/skills/` の host scope を mutate する (他 Claude Code セッションに影響)
- spec が `~/mulmoclaude/` 配下のユーザー data を直接書き換える (conversation / wiki / settings が壊れる)

### Docker on / off matrix（人間依頼方式）

mulmoclaude の Docker サンドボックスは `DISABLE_SANDBOX=1 yarn dev` で off 切替で、 dev サーバ再起動が必要。 Claude が自動制御することはできない。

親 `/e2e-live` skill の手順書（`.claude/skills/e2e-live/SKILL.md`）には:

1. 現在モードで `yarn test:e2e:live`
2. 結果サマリ
3. **次は反対モード** で回したいので dev を再起動してください、 と明示的にユーザーへ案内（off / on どちらに切り替えるかも具体コマンド付きで提示）
4. ユーザーから "再起動した" の合図を待つ（勝手にテスト開始しない）
5. 反対モードで再度 `yarn test:e2e:live` → 両モードの結果を統合サマリ

artifact mode（次 PR）でも launcher 再起動が必要なため、 同じ「人間依頼」方式を踏襲する。

### Docker on/off 自動化検討（採用: 案 C — 別 workspace + 別 port で並走）

採用方針: ユーザーの dev (port 5173) には触らず、 `MULMOCLAUDE_WORKSPACE_PATH=/tmp/mc-e2e-<topic>` + 別 port で AI 制御の dev:server を 2 つ (Docker on / off) background 起動 → spec 側は `E2E_LIVE_BASE_URL` で baseURL を切替 → skill 終了時に 2 process kill + `/tmp/mc-e2e-{on,off}/` 削除。

artifact mode (`/e2e-live-pre-release`) と案 C は枠組みが同じ (「別 workspace + 別 port で AI 制御の server を起動」) なので、 **launcher 抽象化 → mode (dev / artifact) × Docker (on / off) の 2 軸 matrix を 1 つの skill `/e2e-live-matrix` で扱う** のが最終形。 実装は別 PR で。

検討した案 A (`docker stop` で kill) / 案 B (`yarn dev` 自体を kill) を採らない理由、 案 C の具体的な起動コマンド、 利点 / 欠点の詳細は [`plans/done/feat-e2e-live-history.md`](done/feat-e2e-live-history.md) 「Docker on/off 自動化検討」 セクションを参照。

### 画像戦略 — 効果（補足）

上の「画像戦略」 で書いた fixture 再利用 + 単発実生成の構成を採るメリット:

- LLM 応答ばらつきを吸収（画像内容は決定論的）
- 実行時間短縮
- path-traversal 防御の検証は fixture 経由でも十分可能

### `e2e-live/playwright.config.ts`

```ts
export default defineConfig({
  testDir: './tests',
  outputDir: '../test-results-live',                            // ← 既存 e2e と分離
  timeout: 600_000,        // 10 分
  workers: 3,              // 並列実行（mulmoclaude server は複数 chat を捌ける）
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: '../playwright-report-live', open: 'on-failure' }],
  ],
  use: {
    baseURL: 'http://localhost:5173',
    headless: process.env.HEADED !== '1',                      // ← HEADED=1 で QA 可視化
    launchOptions: {
      slowMo: process.env.HEADED === '1' ? 200 : 0,
    },
    trace: 'on',                                                // ← 失敗リプレイ用に常時取得
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 60_000,
    navigationTimeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
```

各 spec の冒頭で `test.describe.configure({ mode: 'parallel' })` を入れて、 同一ファイル内のテストも並列で走らせる（spec を増やしたら自動で並列度が上がる）。

### `.gitignore` 追記

```text
test-results-live/
playwright-report-live/
```

→ PR #2 に含める（既存 `test-results/` `playwright-report/` の隣に追加）。

### `package.json` scripts

```json
{
  "test:e2e:live": "playwright test --config e2e-live/playwright.config.ts",
  "test:e2e:live:media": "playwright test --config e2e-live/playwright.config.ts media.spec.ts",
  "test:e2e:live:roles": "playwright test --config e2e-live/playwright.config.ts roles.spec.ts",
  "test:e2e:live:session": "playwright test --config e2e-live/playwright.config.ts session.spec.ts",
  "test:e2e:live:wiki": "playwright test --config e2e-live/playwright.config.ts wiki.spec.ts",
  "test:e2e:live:ui": "playwright test --config e2e-live/playwright.config.ts ui.spec.ts",
  "test:e2e:live:skills": "playwright test --config e2e-live/playwright.config.ts skills.spec.ts",
  "test:e2e:live:docker": "playwright test --config e2e-live/playwright.config.ts docker.spec.ts"
}
```

### 実行モード（段階運用 + リプレイ可能）

| 観点 | デフォルト | デバッグ時 |
|---|---|---|
| 表示 | headless（速い、リソース節約） | `HEADED=1` で headed + slowMo 200ms |
| trace | `on`（常時取得） | 同左 |
| 動画 | `retain-on-failure` | 同左 |
| 出力先 | `test-results-live/` `playwright-report-live/` | 同左（gitignore 済） |

#### 失敗時の確認方法（A: テスト後リプレイ）

1. **ターミナル**: `list` reporter でリアルタイム失敗通知
2. **HTML レポート**: 失敗時 `open: 'on-failure'` で `playwright-report-live/index.html` が自動オープン
3. **動画リプレイ**: HTML レポート内のプレイヤーで `.webm` を再生
4. **trace viewer**: `npx playwright show-trace test-results-live/<spec>/trace.zip` でステップ単位の DOM スナップショットを確認

#### デバッグ時（B: 画面で動作を見ながら実行）

```bash
HEADED=1 yarn test:e2e:live:media   # Chromium ウィンドウが開き、slowMo 200ms で動作可視化
```

- 新規シナリオ実装中・既存シナリオ修正時に使用
- 通常の定期実行は headless で OK

#### QA hold-mode（C: テスト後にセッションを残して目視）

`E2E_LIVE_KEEP_SESSIONS=1` を立てて走らせると、 各 spec が `finally` で呼ぶ `deleteSession` が **early-return に切り替わり session が history に残る**。 spec 側は 1 行も触らない。 全既存 spec (L-01 以降すべて) と今後追加する spec が retrofit ゼロでこのモードに対応する。

```bash
# QA 目視: HEADED で動作を見つつ、 終了後も session が残る
E2E_LIVE_KEEP_SESSIONS=1 HEADED=1 yarn test:e2e:live:media -g "L-05" --project=chromium

# テスト終了後:
#   - http://localhost:5173 を開く
#   - SPA 右側の session 履歴サイドパネルから残った session をクリック
#   - chat 内容 / 生成 artifact / plugin view の状態を目視確認
#   - OK なら sidebar の kebab → 削除 で手動 cleanup
```

意図と非意図:
- **意図**: 「spec を編集して cleanup を一旦消す → 確認 → spec を戻す → もう一度走らせる」 という二度手間 (旧フロー) を消すこと。 QA 目視のたびに spec を書き換える運用は時間ロスが大きい
- **非意図**: 自動回帰 / CI 用途。 history が膨らむので routine 実行では立てない
- **scope**: 残すのは session のみ。 `placeFixtureInWorkspace` で seed したファイル (画像 / mulmo json) は別経路 (`removeFromWorkspace`) で消える。 fixture も残したい場合は別フラグの導入を検討 (下記)

実装は `e2e-live/fixtures/live-chat.ts` の `deleteSession` 冒頭の env gate 1 ブロックのみ。

#### 派生: `E2E_LIVE_KEEP_FIXTURES` (将来導入候補、 未実装)

`KEEP_SESSIONS` は session 状態だけを残す。 一方で fixture (テスト用ダミーファイル: `e2e-live/fixtures/images/sample.png` を `~/mulmoclaude/artifacts/images/e2e-live-l01.png` に seed する等) は spec 終了時に `removeFromWorkspace` で消える。

QA 目視で「fixture が server 側でどう serve / 配置されたか」 まで実機で見たい場合 (例: 「L-01 の画像が `artifacts/images/e2e-live-l01.png` に居て、 mtime が想定通りか」 「L-03 の mulmoScript json が `artifacts/stories/...` に居るか」 を確認したい) は session だけ残しても足りない。

その時点で導入する想定の追加フラグ:

```bash
# fixture も残す (workspace に置きっぱなし)
E2E_LIVE_KEEP_FIXTURES=1 yarn test:e2e:live:media

# session + fixture の両方を残す (フル QA 目視)
E2E_LIVE_KEEP_SESSIONS=1 E2E_LIVE_KEEP_FIXTURES=1 HEADED=1 yarn test:e2e:live:media -g "L-01"
```

実装方針 (実装時用メモ):
- `removeFromWorkspace` (`e2e-live/fixtures/live-chat.ts`) の冒頭に `process.env.E2E_LIVE_KEEP_FIXTURES === "1"` early-return を 1 ブロック
- `KEEP_SESSIONS` と同じパターンで spec 側はノータッチ、 全既存 spec が retroactive に対応
- fixture path 前提のテスト (placeFixtureInWorkspace で seed → 読み取り → 削除) で「seed が確かに行われたか」 「server がそのパスを正しく serve したか」 をユーザーが直接見られる
- 削除は手動 (`rm ~/mulmoclaude/artifacts/images/e2e-live-*.png` など)、 もしくは次回テスト走行時の seed 上書きで自然解決

導入トリガー:
- L-01 系 / L-03 系で fixture 配置自体を疑うバグが出たとき
- QA 目視で「session 残っても workspace の中身は分からない」 という不満が出たとき

それまでは導入しない (デフォルト挙動が増えるほど混乱するため、 必要になったタイミングで初めて入れる)。

#### Claude / skill 側の実行

| 観点 | やり方 | 理由 |
|---|---|---|
| skill 内 Bash 実行 | `run_in_background: true` | Claude 並行作業可、長時間放置可 |
| 中断 | KillBash で停止 | 時間管理 |
| ログ取得 | BashOutput | 進捗確認 |

#### 段階的運用フェーズ

| フェーズ | デフォルト | 用途 |
|---|---|---|
| **PR #2〜10（実装期）** | `HEADED=1` 推奨 | 各シナリオの動作を目視確認しながら実装 |
| **30 シナリオ完成後** | headless | 通常運用は速度優先、失敗は trace/video でリプレイ |
| **デバッグ時** | `HEADED=1` 切替 | 新規追加・既存修正時 |

### 親 skill `/e2e-live` の両モード巡回フロー

```text
[Step 1] 現在モード（例: docker-off）で 30 シナリオを実行
    ↓
[Step 2] 結果サマリ表示（pass/fail カウント、失敗詳細）
    ↓
[Step 3] ユーザーに「Docker on でも再実行する？」と確認
    ↓ yes
[Step 4] "DISABLE_SANDBOX を解除して yarn dev を再起動してください" と指示
    ↓ ユーザー再起動完了
[Step 5] docker-on で再実行
    ↓
[Step 6] 両モードの結果を統合サマリ
```

切替は手動ユーザー操作必須（サーバ再起動が必要なため）。

### skill 構造

各 SKILL.md は以下の最小構成:

```markdown
---
name: e2e-live-media
description: 実 LLM を叩く media カテゴリのテストを実行（画像/PDF/動画）
---

## 前提
- yarn dev でサーバ起動済み
- Claude 認証済み（claude login or ANTHROPIC_API_KEY）

## 実行
yarn test:e2e:live:media

## 期待結果
- L-01〜L-05 が全て pass
- 結果は `playwright-report-live/media/index.html` で確認（媒体カテゴリ専用 subdir、 失敗時は自動オープン。 親 `/e2e-live` の総合レポート `playwright-report-live/index.html` は上書きしない）
- 失敗時の動画: `test-results-live/<spec>/video.webm`
- 失敗時の trace: `npx playwright show-trace test-results-live/<spec>/trace.zip`
- 各失敗を内部バグ ID（B-XX）と照合

## デバッグ時
HEADED=1 yarn test:e2e:live:media   ← Chromium ウィンドウで動作を目視
```

親 `/e2e-live` は `yarn test:e2e:live` を呼んだ後、両モード巡回フロー（上記）を案内する。

## リリース前テスト（artifact mode）— 未着手

`npm pack` の tarball を `npx` で起動して同じ `e2e-live/tests/*.spec.ts` を叩く構想 (skill 名候補 `/e2e-live-pre-release`)。 同じ spec を **baseURL 切替だけで両方のサーバを叩ける** よう、 `E2E_LIVE_BASE_URL` env override は既に `playwright.config.ts` に入れてある。

artifact 取得方法 (`gh run download`)、 起動手順 (`npx tarball` は使えず `npm install` 経由)、 testid landing 順序の制約、 Docker on/off matrix、 skill 設計案、 残論点リストの詳細は [`plans/done/feat-e2e-live-history.md`](done/feat-e2e-live-history.md) 「artifact mode 設計メモ」 セクションを参照。 着手時はそこを起点に開く。

## 環境要件

- **Claude 認証**（以下のいずれか）
  - `claude login` 済み（`~/.claude/credentials.json`）← 通常はこちら
  - `ANTHROPIC_API_KEY` 環境変数（Claude API 直叩きの場合）
  - Bedrock 経由（[docs/bedrock-deployment.md](docs/bedrock-deployment.md) 参照）
- `GEMINI_API_KEY` 任意（L-05 で利用 / L-10 は逆に未設定状態を作って検証）
- `yarn dev` でフロント+サーバ起動済み
- Docker on モード検証時は通常起動、off モード検証時は `DISABLE_SANDBOX=1 yarn dev`
- **コスト**: `claude login`（Pro / Max サブスクリプション）の月額枠内を想定。サブスク範囲を超える兆候が出た場合は別途検討（実行頻度の調整、シナリオ削減等）

## 関連 issue / PR

active な未着手 / 関心事項:

- **#1049** mulmoclaude README に ffmpeg system 依存の明記がない（一般ユーザー向け docs gap、 動画生成は npx でも system ffmpeg 必要）
- **#1073** presentMulmoScript の Play ボタン: text 空 beat で次に自動送りされない（schema は `duration` 用意済、 frontend が audio end のみを cue にしている疑い）

実装に伴って解決した関連 issue (#1074 beat 編集永続化 / #1102 wiki self-repair / #961 B-18 path-traversal hotfix / 元の親 issue カバレッジ要件 等) の経緯は [`plans/done/feat-e2e-live-history.md`](done/feat-e2e-live-history.md) 「関連 issue / PR (closed の経緯)」 を参照。

## 直近 main の動向 (#1001〜#1480) と e2e-live への反映候補

> 旧 #950〜#1000 (plan 起票時点 〜2026-04-29) の反映済セクションは [`plans/done/feat-e2e-live-history.md`](done/feat-e2e-live-history.md) を参照。 ここでは plan 直近更新以降 (2026-04-30〜2026-05-22、 193 merge) に main に乗った PR から e2e-live に効くものを抽出。

### 反映済 (実装ステータス表で ✅ になっているもの)

- **#1312** wiki `[[slug|alias]]` 退化 fix → L-WIKI-PIPE / L-WIKI-LINT-PIPE-CLEAN / L-WIKI-LINT-EMPTY-TARGET / L-WIKI-LINT-BROKEN を追加
- **#2940** 非 ASCII ページ名解決 fix → L-WIKI-LINT-NON-ASCII を追加、 L-WIKI-LINT-EMPTY-TARGET は `[[\|alias]]` ケースに付け替え (仕様変更に spec が追随できておらず main が red だった)
- **#1275** wiki `<picture><source srcset>` rewriter → L-W-S-03 unskip
- **#1243** mulmoScript beat 編集永続化 (issue #1074) → L-EDIT unskip
- **#1284** mc-settings skill (preset) → L-SETTINGS-EFFORT / L-SETTINGS-EFFORT-SPAWN を追加
- **#1296 / #1298** mc-manage-skills bridge dispatch → L-31 / L-32 を追加
- **#1325** workspace inline-code path linkify → L-LINKIFY-CODESPAN + SYSTEM_PROMPT unit test を追加
- **#1347** L-15b 追加 + `test.step` + `testInfo.title` nonce 化
- **#1446** fix/e2e-live-regressions → 各 spec の regression 修正
- **#1462** docker e2e-live (L-23 / L-26 / L-28) を docker.spec.ts に追加
- **#1472** wiki lint 残り 3 診断 (Orphan / Missing / Tag drift)
- **#1473 / #1476** workspace link decode の `%20` / `%2F` 取り扱い fix → workspace-link-routing.spec.ts を改修
- **#1478** `expectWikiPageBody` helper 抽出 (refactor) → wiki-nav.spec.ts の 8 call site を helper 化
- **#1480** backend-offline banner → mock e2e (`backend-offline-banner.spec.ts`) で cover 済、 e2e-live は追加不要

### 反映候補 (e2e-live で見ないと検出困難な変更)

| PR | 内容 | 推奨対応 |
|---|---|---|
| **#1437 / #1440 / #1441 / #1443** encore plugin (deferred-tool dispatch + dashboard) | mock e2e (`encore-seeded.spec.ts`) で seeded fixture 経由の View mount は cover 済。 実 LLM dispatch 経路の canary は無し | ✅ **L-21B として実装済** (skills.spec.ts、 Personal role + defineEncore で session jsonl trace に `mcp__mulmoclaude__defineEncore` の tool_call が pinned displayName で 1 件以上記録 + obligation index.md が disk に landing することを assert)。 当初 L-21 の View testid 形を copy する設計だったが、 encore handler は `data` を返さない narrate-only 設計のため MCP bridge が visual ToolResult を push しない (server/agent/mcp-server.ts:451) ことが local 実走で判明し、 tool_call jsonl + on-disk artefact に signal を切り替え |
| **#1287** mc-cooking-coach preset skill | preset skill が discovery → /<slug> dispatch → body 実行 まで通るか | ✅ **L-33 として実装済** (skills.spec.ts、 launcher 同梱の `mc-cooking-coach` を catalog → star → /skills → Run の 4 段 chain で検証、 first-turn 応答の cooking vocab pattern match で body→agent context 反映を assert) |
| **#1471 / #1464 / #1465 / #1475** solopreneur runtime plugin 群 (client / worklog / plans) | mock e2e で View mount は部分 cover、 LLM dispatch + plugin 切替 + 認証付きで動くかの canary なし | 各 plugin で 1 本ずつ runtime-plugin canary を立てる (3 PR、 各 1 シナリオ)。 plugin 数が今後増える前提で 「parameterized 化 / plugin ごと 1 spec」 のどちらに寄せるか別途整理 |
| **#1451** notifier-update-op | notifier 拡張、 update operation 追加 | L-17 (二重通知 canary) は bridge-origin agent run 経由で `pluginPkg === "agent"` + `pluginData.sessionId === bridgeSessionId` shape の publish 不在を観測するだけなので update op は scope 外。 update op 自体の canary が必要なら、 update op を持つ既存 plugin (todo 等) 経由で観測する形が良い (production HTTP 追加面ゼロを維持できる) |
| **#1445** skill-tool-allowlist | skill 起動時の tool allowlist gate | L-22 / L-31 / L-32 で間接 cover 済の可能性高、 trace を 1 回流して allowlist 効果を確認するだけで十分 |
| **#1436** stdio-http-shim (#1421-B) | MCP bridge 経路追加 | unit test 側で cover 済の見込み、 e2e-live 追加不要 |

### 反映候補のうち優先度判断

- ~~**encore plugin dispatch canary (重要度 A)**~~: ✅ **L-21B として実装済** (skills.spec.ts)。 元: 1 plugin で deferred-tool dispatch が壊れると plugin View が出ない退行に直結。 L-21 (chart) shape を再利用すれば 1 PR でカバー可能
- ~~**mc-cooking-coach skill canary (重要度 B)**~~: ✅ **L-33 として実装済** (skills.spec.ts)。 元: preset skill の 「seed されてから /<slug> dispatch まで」 の chain は L-32 で代表されているが、 cooking-coach は moderate complexity の body を持つ preset として加えると net が密になる
- **solopreneur plugins**: plugin ごとに固有 View testid を持っているので canary 化のスコープは plugin 1 つあたり 1 spec が現実的

## 未確定事項 / TODO (active)

- [ ] 各シナリオの「期待される LLM 応答」のばらつきをどう吸収するか
  - 案 1: 検証は UI 状態のみに限定（応答テキストは見ない）
  - 案 2: 応答に必須キーワード含むかだけチェック
  - 画像 fixture 戦略により、生成系のばらつきはかなり吸収できる見込み
- [ ] 実行時間実測 → 30 シナリオ × 2 モードで何分か
- [ ] CI 化のタイミング（手動運用が安定したら GitHub Actions 検討）
- [x] ~~**L-17 用 bridge メッセージ inject 経路の追加**~~: ✅ **解消済**。 当初検討した 3 案 (a) HTTP publish 復活、 (b) socket.io 直接 emit、 (c) 実 bridge WebSocket は全部不採用。 最終案として **Playwright から /api/agent を `origin: "bridge"` で直接 POST する** 形で実装 — /api/agent は元から body の `origin` を受け取る (server/api/routes/agent.ts:121, 219) ので、 PR #818 が commented out した agent.ts:985 付近の `publishNotification(...)` gate を test から直接踏ませられる。 production code path をそのまま使うので追加面ゼロ、 env も不要、 fake-echo / real LLM どちらでも動く。 実 WebSocket bridge end-to-end は将来 「test 専用 dev server spawn infra」 が立った後に別 L-XX として扱う
- [ ] **`MULMOCLAUDE_SANDBOX_IMAGE` env 新設** — `server/system/docker.ts:13` と `server/agent/config.ts:553` でハードコード。 別 PR でソース改修すれば image 不在テストの再現が可能になる。 L-FRESH-SANDBOX-BUILD で活用 (旧 L-24 の B-02 検証はこちらに統合済)
- [ ] **e2e-live spec の L-23 / L-24 シナリオ ID rename (follow-up issue)** — `e2e-live/tests/workspace-link-routing.spec.ts:31, 134` で `L-23` / `L-24` を 「workspace link routing」 系シナリオに割り当てているが、 plan 起票時の予約 (`L-23` = X MCP docker、 `L-24` = 旧 sandbox:login) と ID 衝突している (CodeRabbit iter-1 on PR #1481 で検出)。 spec 側を `L-WSLINK-MULTIBYTE` / `L-WSLINK-WIKI-MD` 等にリネームする issue を起こす。 plan 側は L-24 廃止 + L-23 は docker.spec.ts:93 が canonical で進める
- [x] ~~**テスト専用 dev server 起動 infra** (案 C 拡張)~~ — L-FRESH-BOOT PR で landing (`e2e-live/fixtures/isolated-dev-server.ts`)。 helper は `HOME` / `MULMOCLAUDE_WORKSPACE_PATH` / `PORT` / `MULMOCLAUDE_AUTH_TOKEN` の 4 軸を `spawnIsolatedDevServer` 1 関数で抽象化。 当初想定した 「`/e2e-live-matrix` skill に集約 → mode × Docker 軸の matrix」 まではしておらず、 そこは別 PR で。 L-10 / L-13 / L-FRESH-PRESET-SKILL は今回の helper を `env` 引数で extend する形で乗れる
- [ ] **「対象外」 ラベル導入** — L-29 のように 「unit test で十分、 e2e-live 移植不要」 と評価したシナリオを 「対象外」 として実装ステータス表に追加。 「未実装」 と区別することで進捗が読みやすい
- [x] ~~**L-HAPPY-TOUR (正常系 sweep) 実装**~~ — ✅ 実装済 (happy-tour.spec.ts)。 assertion は `e2e-live/lib/health-checks.ts` に pure 関数として切り出し、 spec / 将来の doctor CLI / pre-release smoke の 3 経路で再利用可能な形に landing。 ステップ 12 (NotificationBell 警告チェック) は step 3 (`/api/plugins/diagnostics`) と構造的に重複し、 user/workspace の既存 urgent entry で false-positive する懸念から本実装では落とした (Codex iter-1)。 必要なら将来 L-17 baseline-diff shape で再導入
- [ ] **wall-time budget の運用化** — `/e2e-live` 全実行を **30 分以内** に保つ hard constraint を運用化する。 PR で新規シナリオ追加時、 実測時間を PR 本文に記載 + budget を超えたら降格 / 統合 / drop 提案を必須化。 `make-e2e-live` skill 側にも 「追加前に現状の wall time を測る」 ステップを足す
- [ ] **PR template に下層 gate を追加** — `.github/PULL_REQUEST_TEMPLATE.md` に 「このバグの再発防止 test を最も下のレイヤに置きましたか / e2e-live に置く場合、 unit / mock e2e で取れない理由を 1 行で明記しましたか」 の checkbox を追加。 e2e-live がバグ ID の墓場になるのを構造的に防ぐ
- [ ] **`/audit-e2e-live` skill 構想** — 既存 L-XX (特にバグ軸) を半年ごとに棚卸し、 下層で同等 cover ができたシナリオを e2e-live から外す proposal を出す skill。 `audit-unclosed-issues` skill の運用 shape を踏襲。 着手は wall-time budget 運用が回り始めてから (圧力が発生してから)
- [x] ~~**`deleteSession` の general-session false-warning を抑える**~~ — ✅ 解消済。 案 (a) で `setupRoleSession` (live-chat.ts) の `sessionsToCleanup.push(generalSessionId)` を削除し、 1 ターンも chat が打たれない general 側 baseline session を cleanup 対象から外した。 role 側 session の cleanup と on-disk state は不変。 元の TODO 本文: `setupRoleSession` (live-chat.ts) は general role の session を 1 つ作って即 role 切替するため、 general 側 session は **1 ターンも chat を打たない** まま捨てられる。 `/api/sessions` は session jsonl が disk に flush されてから出てくるので、 chat 0 ターンの general session は disk に書かれず list に永久に出てこない → finally の `deleteSession` → `waitForSessionIdle` が 30s タイムアウトして 「best-effort cleanup skipped: ... not yet visible in /api/sessions list」 を毎 run 7 spec 分 log に流す (skills.spec.ts L-21 / L-21B / plugin-dispatch.spec.ts 全部で発生)。 test 結果は ✅ (deleteSession は throw せず skip) だが trace / 出力の S/N 比を下げているので false-positive とみなせる。 対処案: (a) `setupRoleSession` 側で chat 0 ターンの session id は cleanup list に積まない (general 側は selectRole で残らないので push しない)、 (b) `deleteSession` 側で `waitForSessionIdle` の timeout を per-call で短く (5s 程度) して試す、 (c) `/api/sessions` に出ない session の DELETE は 404 を許容して `waitForSessionIdle` 自体を skip。 (a) が最も筋が良い (cleanup する必要が無いので積まない)。 既存 spec (skills.spec.ts L-21 等) も同じ shape なので live-chat.ts の `setupRoleSession` を直せば全 spec で benefit。 本 PR scope 外、 別 follow-up
- [ ] **L-JOURNEY-* 主要ユーザー journey が end-to-end で動くこと** — `L-HAPPY-TOUR` は plugin route の mount sanity (壊れていない) までで、 「機能が **実際に動く** (setup → 副作用 → 反映が観測可能)」 までは見ていない。 各 plugin / 機能 ごとに代表的な user journey を 1 本 ずつ net する。 必要に応じて LLM 経由 / UI 操作 / 両方を組合せる (どちらでも end-to-end で 「動いた」 と言えればよい)。 現状の cover と未 cover の対応表:

  | 機能 | 既存 cover | journey TODO |
  |---|---|---|
  | encore | L-21B (defineEncore 1 ターン dispatch のみ、 on-disk artefact 確認まで) | **L-JOURNEY-ENCORE** setup → 期限到来 → 通知発火 → dashboard で表示 → 完了報告 の lifecycle |
  | collections | happy-tour で `/collections` mount のみ / ✅ **L-JOURNEY-COLLECTION** (mc-clients skill で client add → /collections/mc-clients の row 反映 → UI delete、 journey-llm.spec.ts) | 新規スキーマ定義 (chat で「〜 collection 作って」) → list 表示 → edit (field 更新) の full lifecycle は別 PR。 ref field (mc-worklog → mc-clients) を絡めた cross-collection journey も将来 |
  | sources (情報ソース) | なし (`/sources` mount のみ) | **L-JOURNEY-SOURCE** RSS feed URL 登録 → fetch → wiki / news への取込確認 |
  | news | なし (`/news` mount のみ) | **L-JOURNEY-NEWS** source 経由 (or 直接 URL) → news fetch → /news で記事 visible |
  | skill | ✅ L-22 / L-31 / L-32 / L-33 / L-33B (登録 / discovery / run / preset chain / catalog→star) | (主要 path は cover 済、 追加は様子見) |
  | roles | L-06〜L-09 (built-in role の 1 ターン) / ✅ **L-JOURNEY-ROLE** (custom role を REST 作成 → selector 反映 → 実 LLM ターン → REST delete → GET /api/roles で消失、 journey-llm.spec.ts) | create-form の UI driving (pure-UI→REST、 LLM 不要) は mock `e2e/` 側で別途。 availablePlugins を絞った role で plugin gating が効くかの検証も将来 |
  | todo | L-DISPATCH-TODO (jsonl trace) / L-JOURNEY-TODO (UI add) / ✅ **L-JOURNEY-TODO-LLM** (LLM add → /todos card 反映 → check → reload → LLM delete、 journey-llm.spec.ts) | — |
  | calendar | L-DISPATCH-CAL (jsonl trace) / ✅ **L-JOURNEY-CAL** (LLM add → /calendar list 反映 → UI delete、 journey-llm.spec.ts) | edit (multi-day 化) は YAML editor の testid 不足で見送り、 別 PR |
  | accounting | L-DISPATCH-ACCT (jsonl trace) / ✅ **L-JOURNEY-ACCT** (LLM createBook+openBook → switcher 反映 → LLM deleteBook → DB から消える、 journey-llm.spec.ts) | addEntries (借方/貸方) → getReport (BS/PL) → voidEntry の full lifecycle は opening-gate を踏むため別 PR。 delete の deleted-notice UI 観測は inline view collapse で不可 → DB 確認に切替済 |
  | wiki | L-14 / L-15 / L-16 / L-WIKI-* (内部リンク / 非ASCII / lint 系) ✅ | (主要 path cover 済) |
  | sandbox / docker | L-23 / L-26 / L-28 / L-30 ✅ | (主要 path cover 済) |

  共通方針: 各 spec は 「**この機能を初めて使うユーザーが ✅ 動いたと感じる**」 最小経路を 1 本選び、 testid 追加 + chat / UI 操作の組合せで end-to-end を net する。 中〜大規模、 機能ごとに 1 PR を推奨 (1 PR で全部入れない)。 phase 分割は重要度順: **(1)** L-JOURNEY-SOURCE + L-JOURNEY-NEWS (情報取込 path 全体)、 **(2)** L-JOURNEY-ENCORE (再発通知の lifecycle)、 **(3)** L-JOURNEY-COLLECTION + L-JOURNEY-ROLE (拡張系)、 **(4)** L-JOURNEY-TODO / -CAL / -ACCT (これは L-LAUNCHER-OPS / L-DISPATCH-*-LIFECYCLE と内容が重なるので統合 PR で良い)

  なお top-chrome の 🔒 lock / 🔔 notifications / 📅 today / ⚙️ settings は別軸の 「**L-TOPBAR-OPS**」 として独立に扱う (toolbar のうち plugin で無いもの、 4 spec で 1 PR)
- [ ] **L-DISPATCH-* の深堀り follow-up 群** — `plugin-dispatch.spec.ts` (本 PR) は各 plugin が 1 ターン dispatch 経路に乗ることだけを net しており、 view 描画 / 主要 action の網羅は意図的に未着手 (L-21 / L-21B と同型の「canary」 として scope を絞った)。 ユーザーが運用中に気づいた抜けに沿って follow-up PR を切る:
  - [ ] **L-DISPATCH-VIEW** view 描画 end-to-end: 各 plugin で add turn → 該当 route (`/todos` / `/calendar` / `/accounting`) または chat-inline view に navigate → marker text が visible、 cleanup turn 後 → marker hidden / `toHaveCount(0)`。 前提: todo / markdown / spreadsheet に top-level `data-testid` を新設 (`todo-plugin-view` / `present-document-view` / `present-spreadsheet-view`)、 ui-cheatsheet 更新。 artifact 系 4 plugin (md / xls / svg / html) は chat inline の tool-result View を assertion target にする (route が無い)。 7 spec × +2 navigate で中規模、 別 PR 推奨
  - [ ] **L-DISPATCH-TODO-LIFECYCLE** todo の主要 action 網羅 (check / uncheck / update / clear_completed / add_label / remove_label / list_labels)。 3〜5 spec、 各 1 nonce-stamped todo に対し action を順次 dispatch して args.action + 結果データを assert
  - [ ] **L-DISPATCH-CAL-UPDATE** calendar の update action: 既存 event の title / date を更新 → /calendar に navigate → 更新後 title が visible。 1 spec
  - [ ] **L-DISPATCH-ACCT-LIFECYCLE** accounting の addEntries / voidEntry / getReport / getTimeSeries: 1 book に対し journal entry を add → getReport で集計値を assert → voidEntry で取消 → 再度 getReport で取消結果を assert。 3〜4 spec、 double-entry の append-only invariant を end-to-end で net
  - 共通方針: 各 spec は本 PR で確立した `setupRoleSession` + `runDispatchCase` (or 拡張版) を再利用、 cleanup は同じ chat session の追加ターン経由 (本 PR と同 shape)、 jsonl trace assertion は turn-scoped baseline diff (iter-3 fix と同 pattern) で実装。 view 描画系は testid 追加 + ui-cheatsheet 更新を同 PR 内でセット
  - 着手順は **VIEW → TODO-LIFECYCLE → ACCT-LIFECYCLE → CAL-UPDATE** を推奨: VIEW が最も汎用 (全 7 plugin に効く net 強化)、 TODO は使用頻度高、 ACCT は double-entry の不変条件 net で価値最大、 CAL-UPDATE は単発
- [ ] **e2e-live suite 全体の self-contained 化検討** — 現状は 「ユーザーが手元で `yarn dev` を起動してから `yarn test:e2e:live` を叩く」 前提で、 spec は host の `~/mulmoclaude/` workspace を unique slug + cleanup で汚さないように使う (階層 1)。 L-FRESH-BOOT で導入した `spawnIsolatedDevServer` を **suite 単位で 1 回だけ呼ぶ** 形に格上げすれば、 ユーザーは `yarn dev` 起動すら不要になり、 全 spec が隔離 workspace 上で走り、 host は一切触られなくなる。 実装は Playwright の `webServer` config か `globalSetup` / `globalTeardown` で 1 回 spawn → suite 終了で 1 回 kill する形 (e2e/ がすでに似た shape: vite + express を auto-spawn)。 `MULMOCLAUDE_WORKSPACE` env を runner process に流して既存 helper の `workspaceRoot()` を隔離 ws に振れば、 既存 `placeFixtureInWorkspace` / `placeWikiPage` 等は touch せずに動く。 考慮点: (a) suite 先頭で server boot ~5-10s の固定コスト、 (b) 「開発者の real workspace 固有の state (既存 slug 衝突 等) が test に出てこなくなる」 → これは現状の階層 1 が拾えていたメリットなので失う、 (c) pre-release mode (`npx mulmoclaude@<tarball>`) と dev mode の 2 系統で webServer config を別に用意する必要、 (d) Docker on/off matrix を webServer 単位で切替 (現状の人間依頼方式は webServer config 2 つで自動化可能)。 **L-FRESH-BOOT 自体は per-test spawn のままにする必要**: 「毎回真っ新の空状態から起動して 1ターン目が成立する」 という assertion は suite 単位 1 回 spawn では弱まる (他 spec が先に走ると workspace に痕跡が残る) ため、 suite-level 隔離と per-test 隔離は両立して意味がある

履歴: 完了済の TODO は [`plans/done/feat-e2e-live-history.md`](done/feat-e2e-live-history.md) を参照。

---

## Appendix

内部バグ報告一覧 (B-01〜B-50 + 外部要因 E-01〜E-03) は [`plans/done/feat-e2e-live-history.md`](done/feat-e2e-live-history.md) の Appendix セクションに移動。 各シナリオ (L-XX) の 「カバー: B-XX」 から逆引きで参照する。

