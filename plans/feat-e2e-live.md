# feat: e2e-live — 実 LLM を叩く総合テスト skill 群

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
| 実行環境 | headless | **headed**（QA が画面で見る） |
| 実行時間 | 数十秒 | 数分〜数十分 |
| timeout | 短（30s） | 長（生成系で 5 分） |
| trigger | `yarn test:e2e` | `yarn test:e2e:live` or `/e2e-live` skill |

## ディレクトリ構造

```text
e2e-live/
  fixtures/
    live-chat.ts            ← 実 chat fixture（mockAllApis を使わない）
    helpers.ts              ← PDF 解析、画像描画チェック等の検証ユーティリティ
    env.ts                  ← Claude 認証状態の事前確認
    images/
      sample.png            ← src/assets/mulmo_bw.png をコピー（path-traversal 検証用）
    markdown/
      with-image.md         ← 画像入り Markdown テンプレ（PDF 検証用）
  media.spec.ts             ← 画像/PDF/動画
  roles.spec.ts             ← ロール別 sample query
  session.spec.ts           ← セッション/履歴
  wiki.spec.ts              ← Wiki/Router
  ui.spec.ts                ← UI/通知/プラグイン
  skills.spec.ts            ← Skill/Tool
  docker.spec.ts            ← Docker 環境特有のバグ検証

playwright.live.config.ts   ← 別 config（headed, 長 timeout, workers=1）

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
| `/e2e-live-wiki` | wiki.spec.ts | 3 | B-23〜B-27 |
| `/e2e-live-ui` | ui.spec.ts | 4 | B-30, B-31, B-34, B-50 |
| `/e2e-live-skills` | skills.spec.ts | 2 | B-08, B-22, B-41 |
| `/e2e-live-docker` | docker.spec.ts | 8 (うち 2 は L4) | B-01〜B-08 |

## Docker 依存度フラグ（凡例）

各シナリオに以下のフラグを付ける：

| フラグ | 意味 |
|---|---|
| `both` | Docker on / off のどちらでも動くべき（大半） |
| `docker-only` | Docker サンドボックス起動状態でしか発生しないバグの検証 |
| `manual-l4` | 自動化困難（OS 依存等）、人手チェックリストへ |

## 30 シナリオ詳細

凡例:
- 重要度: **S** = 致命級, **A** = 高, **B** = 中
- 画像: 「fixture」= repo 既存ファイル参照、「生成」= 実 generateImage 経由、「不要」= 画像を扱わない

### media（5）

#### L-01: presentHtml の画像が描画される ★最重要

- カバー: B-17, B-18
- 重要度: **S** / Docker: `both` / 画像: fixture
- 操作: `/chat` で新規セッション → 「`fixtures/images/sample.png` を `<img>` で埋め込んだ HTML を作って presentHtml で表示して」と送信
- 検証:
  - presentHtml の iframe 内に `<img>` が存在
  - src が `/api/files/raw?path=...` 形式にリライトされている
  - `naturalWidth > 0`（実際に描画されている）
- 失敗例: B-18（path-traversal 防御の副作用で 404）

#### L-02: 画像入り Markdown を PDF DL → 画像が含まれる

- カバー: B-19, B-20
- 重要度: **S** / Docker: `both` / 画像: fixture
- 操作: `fixtures/markdown/with-image.md`（画像 1 枚を含む）を workspace に配置 → ファイル一覧から PDF DL
- 検証:
  - DL ファイルが PDF 形式（マジックバイト確認）
  - PDF サイズが N KB 以上
  - `pdf-parse` で画像オブジェクトが含まれる

#### L-03: mulmoScript 生成 → 動画 DL 成功

- カバー: B-21
- 重要度: **A** / Docker: `both` / 画像: fixture
- 操作: 短い mulmoScript（2〜3 beat）を生成依頼、画像は fixture を指定 → `/api/mulmo-script/download-movie` で DL
- 検証: 認証ヘッダ付きで 200 応答、動画ファイルのマジックバイト確認

#### L-04: mulmoScript animation:true で映像生成失敗しない

- カバー: B-46
- 重要度: **B** / Docker: `both` / 画像: fixture
- 操作: animation:true を含む短い mulmoScript を生成 → render
- 検証: audio → image の順で生成され、エラーが出ない

#### L-05: generateImage プラグインで実画像が返る

- カバー: 一般
- 重要度: **A** / Docker: `both` / 画像: **生成（このテストだけ）**
- 操作: 「猫の絵を 1 枚描いて」と送信 → generateImage tool が呼ばれる
- 検証: 返ってきた画像 URL が 200、画像として描画される

### roles（5）

#### L-06: General ロールで sample query → 完走

- カバー: B-15, B-41
- 重要度: **A** / Docker: `both` / 画像: fixture or 不要
- 操作: General ロール選択 → sample query を 1 つ実行
- 検証: tool 呼び出し成功、最終応答が UI に表示される

#### L-07: Office ロールで sample query → 完走

- カバー: B-41
- 重要度: **A** / Docker: `both` / 画像: 不要

#### L-08: Tutor ロールで sample query → 完走

- カバー: B-41
- 重要度: **B** / Docker: `both` / 画像: 不要

#### L-09: Storyteller ロールで sample query → 完走

- カバー: B-41
- 重要度: **B** / Docker: `both` / 画像: 不要

#### L-10: Gemini key 未設定でも General ロールが disabled にならない

- カバー: B-15
- 重要度: **A** / Docker: `both` / 画像: 不要
- 操作: GEMINI_API_KEY を一時 unset → General 選択
- 検証: 入力欄が enabled、警告バナー表示、generateImage 以外の機能は動く

### session（3）

#### L-11: 新規セッション → 1 ターン → reload → 履歴復元

- カバー: B-14
- 重要度: **A** / Docker: `both` / 画像: 不要
- 操作: 新規セッション開始 → メッセージ送信 → 応答受信 → ページ reload
- 検証: 履歴が UI に復元、session ID 一致

#### L-12: 古いセッションを resume → LLM が文脈保持

- カバー: B-16
- 重要度: **B** / Docker: `both` / 画像: 不要
- 操作: 既存セッションを開く → 「さっき何の話してた？」と送信
- 検証: 過去の文脈を引いた応答が返る

#### L-13: サーバ再起動後も bridge が再接続できる

- カバー: B-13
- 重要度: **B** / Docker: `both` / 画像: 不要
- 操作: bridge 接続中にサーバ再起動 → 再接続待機
- 検証: 固定 token で再接続成功

### wiki（3）

#### L-14: Wiki ページ生成 → 内部リンクを踏める

- カバー: B-23, B-24, B-25
- 重要度: **A** / Docker: `both` / 画像: 不要
- 操作: 「Wiki に X というページを作って Y にリンクして」と依頼
- 検証: リンククリックで `/chat` にリダイレクトされず、対象 Wiki ページが開く

#### L-15: 日本語タイトルの Wiki ページ → URL slug が壊れない

- カバー: B-26, B-27
- 重要度: **B** / Docker: `both` / 画像: 不要
- 操作: 「『日本語タイトル』という Wiki ページを作って」
- 検証: URL slug 化が成功、リンクから正しく開ける

#### L-16: Wiki index から各ページへのリンクが機能

- カバー: B-23
- 重要度: **B** / Docker: `both` / 画像: 不要
- 操作: 複数ページ生成 → `/wiki` 直下の index を開く → 各リンクをクリック
- 検証: すべて 404 にならず開ける

### ui（4）

#### L-17: bridge メッセージ受信 → 通知が二重表示されない

- カバー: B-50
- 重要度: **B** / Docker: `both` / 画像: 不要
- 操作: bridge から外部メッセージを送信
- 検証: 通知 bell バッジは更新されず、history バッジのみ更新

#### L-18: presentForm 表示時に i18n キーが直接出ない

- カバー: B-34
- 重要度: **B** / Docker: `both` / 画像: 不要
- 操作: presentForm を呼ぶシナリオを実行
- 検証: `pluginPresentForm.submit` のような raw key が UI に出ていない

#### L-19: Tool Call History が reload 後も復元

- カバー: B-31
- 重要度: **B** / Docker: `both` / 画像: 不要
- 操作: tool 実行 → reload → Tool Call History を開く
- 検証: 履歴が消えず表示される

#### L-20: Files view reload で `?path=` がクリーンアップ

- カバー: B-30
- 重要度: **B** / Docker: `both` / 画像: 不要
- 操作: Files view で markdown を開く → reload
- 検証: `?path=` が URL から消えている、Files view に戻らない

### skills（2）

#### L-21: ToolSearch + skill 経由で期待した tool が呼ばれる

- カバー: B-41
- 重要度: **A** / Docker: `both` / 画像: 不要
- 操作: deferred tool を要求するクエリを送信（例: presentMulmoScript）
- 検証: ToolSearch 経由で tool スキーマ取得 → 実 tool 呼び出し成功

#### L-22: 自作 skill を実行して結果が出る

- カバー: B-08
- 重要度: **B** / Docker: `both` / 画像: 不要
- 操作: 既存 skill（例: `/audit-unclosed-issues` の dry-run）を実行
- 検証: skill が dangling link 等で失敗せず、結果が UI に表示される

### docker（8、うち 2 は manual-l4）

#### L-23: X MCP が Docker 内で .env から key を読める

- カバー: B-01
- 重要度: **A** / Docker: `docker-only` / 画像: 不要
- 操作: Docker サンドボックス起動 → MCP 一覧確認
- 検証: X MCP が disable 状態でなく、key が認識されている

#### L-24: `yarn sandbox:login` 前に image が build されている

- カバー: B-02
- 重要度: **B** / Docker: `docker-only` / 画像: 不要
- 操作: クリーン環境で `yarn sandbox:login` を実行
- 検証: image not found エラーが出ず、login プロンプトに到達

#### L-25: sandbox 内のファイル所有者が non-root（**Linux のみ**）

- カバー: B-03
- 重要度: **B** / Docker: `manual-l4`（Playwright で再現困難）
- 扱い: `docs/manual-testing.md` のチェックリストに追加

#### L-26: Docker 内 cwd 変更後も session resume できる

- カバー: B-04
- 重要度: **A** / Docker: `docker-only` / 画像: 不要
- 操作: Docker サンドボックス内で過去セッションを resume
- 検証: 「No conversation found」エラーが出ない

#### L-27: Mac keychain credential が container に渡る（**macOS のみ**）

- カバー: B-05
- 重要度: **A** / Docker: `manual-l4`（OS 依存、Playwright で再現困難）
- 扱い: `docs/manual-testing.md` のチェックリストに追加

#### L-28: Docker 内で git/gh 認証が通る

- カバー: B-06
- 重要度: **B** / Docker: `docker-only` / 画像: 不要
- 操作: Docker 内で `gh auth status` を実行
- 検証: 認証成功（SSH agent forward / token mount）

#### L-29: Docker 環境で MCP server が crash しない

- カバー: B-07
- 重要度: **A** / Docker: `docker-only` / 画像: 不要
- 操作: Docker サンドボックス起動 → 各 MCP tool を順次呼ぶ
- 検証: MCP server が crash せず最後まで応答

#### L-30: skill symlink が Docker 内で dangling にならない

- カバー: B-08
- 重要度: **A** / Docker: `docker-only` / 画像: 不要
- 操作: `~/.claude/skills` を symlink で管理した状態で Docker 起動 → skill 一覧確認
- 検証: skill が表示され、各 sample query が実行可能

## 実装の詳細

### `live-chat` fixture

- `mockAllApis(page)` を呼ばない
- 起動前に Claude 認証状態を検証（`claude login` 済 or `ANTHROPIC_API_KEY` set）→ どちらも無ければ skip
- ヘルパー: `startNewSession()`, `sendAndWait(message, opts)`, `getLastAssistantBlock()`, `placeFixtureFile(src, dst)`
- timeout: 単一 LLM 応答 60s、生成系（PDF/動画）5 分

### 画像戦略

- **fixture 再利用**（L-01〜L-04, L-06）: `e2e-live/fixtures/images/sample.png` を workspace に配置 → LLM に「このファイルを `<img>` で参照する HTML / Markdown を作って」と依頼
- **実生成 1 枚**（L-05）: generateImage 経路自体を検証するため、実際に画像生成
- 元データ: `src/assets/mulmo_bw.png` を fixture としてコピー

これにより：
- LLM 応答ばらつきを吸収（画像内容は決定論的）
- 実行時間短縮
- path-traversal 防御の検証は fixture 経由でも十分可能

### `playwright.live.config.ts`

```ts
export default defineConfig({
  testDir: 'e2e-live',
  timeout: 600_000,        // 10 分
  workers: 1,              // 直列実行
  retries: 0,              // コスト節約のため自動リトライしない
  reporter: [
    ['list'],                                       // ターミナル進捗
    ['html', { outputFolder: 'playwright-report-live', open: 'on-failure' }],
  ],
  use: {
    baseURL: 'http://localhost:5173',
    headless: false,        // ← QA が画面で動作確認できる
    launchOptions: {
      slowMo: 200,          // ← 動作が目で追える速度
    },
    trace: 'on',            // ← 全テスト trace 取得（後でリプレイ可能）
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
```

### `package.json` scripts

```json
{
  "test:e2e:live": "playwright test --config=playwright.live.config.ts",
  "test:e2e:live:media": "playwright test --config=playwright.live.config.ts media.spec.ts",
  "test:e2e:live:roles": "playwright test --config=playwright.live.config.ts roles.spec.ts",
  "test:e2e:live:session": "playwright test --config=playwright.live.config.ts session.spec.ts",
  "test:e2e:live:wiki": "playwright test --config=playwright.live.config.ts wiki.spec.ts",
  "test:e2e:live:ui": "playwright test --config=playwright.live.config.ts ui.spec.ts",
  "test:e2e:live:skills": "playwright test --config=playwright.live.config.ts skills.spec.ts",
  "test:e2e:live:docker": "playwright test --config=playwright.live.config.ts docker.spec.ts"
}
```

### 実行モード（headed + background）

| 観点 | やり方 | 理由 |
|---|---|---|
| skill 内 Bash 実行 | `run_in_background: true` | Claude が並行作業可能 |
| 画面表示 | Playwright `headless: false` + `slowMo: 200` | QA が動作を目で追える |
| ログ | `list` reporter でターミナル出力 | リアルタイム進捗確認 |
| 失敗時 | trace + video + screenshot | HTML レポートで完全リプレイ可能 |
| 中断 | KillBash で停止 | 長時間放置しても止められる |

### 親 skill `/e2e-live` の両モード巡回フロー

```
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
- 画面に Chromium ウィンドウが表示され、QA が動作を目で確認可能
- 結果は playwright-report-live/ に出力
- 失敗時は内部バグ ID（B-XX）を確認
```

親 `/e2e-live` は `yarn test:e2e:live` を呼んだ後、両モード巡回フロー（上記）を案内する。

## PR 分割計画

| PR | 内容 | 規模 |
|---|---|---|
| **#1** | このファイル `plans/feat-e2e-live.md` のみ（設計合意） | 小 |
| **#2** | 基盤: `e2e-live/fixtures/`, `playwright.live.config.ts`, `package.json` scripts, `/e2e-live` 親 skill, `/e2e-live-media` skill, **L-01 サンプル 1 本** | 中 |
| #3 | media 残り（L-02〜L-05） | 中 |
| #4 | roles 全部（L-06〜L-10）+ `/e2e-live-roles` skill | 中 |
| #5 | session 全部（L-11〜L-13）+ `/e2e-live-session` skill | 小 |
| #6 | wiki 全部（L-14〜L-16）+ `/e2e-live-wiki` skill | 小 |
| #7 | ui 全部（L-17〜L-20）+ `/e2e-live-ui` skill | 中 |
| #8 | skills 全部（L-21〜L-22）+ `/e2e-live-skills` skill | 小 |
| #9 | docker 全部（L-23, L-24, L-26, L-28, L-29, L-30）+ `/e2e-live-docker` skill | 中 |
| #10 | `docs/manual-testing.md` 更新（L-25, L-27 のチェックリスト追加） | 小 |

**ポイント**: PR #2 で「基盤 + L-01 サンプル」を同梱することで、設計の妥当性を実装で検証してから残りを並行展開できる。L-01 が最重要（B-18 系）なので守備力も同時に上がる。

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

- 親 issue: 別途起票予定（mock e2e の不足カバレッジ Step 1 (a)）
  - presentHtml iframe 画像リライト (B-18)
  - PDF route 画像 inline (B-19/20)
  - mulmoScript download-movie 認証 (B-21)
  - presentForm i18n キー欠落 (B-34)
  - 通知二重表示 (B-50)
  - Files view `?path=` クリーンアップ (B-30)
- 関連 PR: #961（B-18 path-traversal 副作用 hotfix、進行中）

## 未確定事項 / TODO

- [ ] 各シナリオの「期待される LLM 応答」のばらつきをどう吸収するか
  - 案 1: 検証は UI 状態のみに限定（応答テキストは見ない）
  - 案 2: 応答に必須キーワード含むかだけチェック
  - 画像 fixture 戦略により、生成系のばらつきはかなり吸収できる見込み
- [ ] 実行時間実測 → 30 シナリオ × 2 モードで何分か
- [ ] CI 化のタイミング（手動運用が安定したら GitHub Actions 検討）
- [ ] L-22 で使う skill の選定（dry-run 可能なものに絞る）

---

## Appendix: 内部バグ報告一覧（匿名化）

直近 1 ヶ月（2026-04-01〜04-29）の内部バグ報告を匿名化して掲載。各シナリオ（L-XX）が参照する根拠資料。報告者・日時・引用文・元投稿リンクは省略。

### A. Docker / サンドボックス系

#### B-01. X MCP が Docker 下で動かない（key 認識失敗）
- 症状: X MCP が disable 状態で起動する
- 原因: Docker 配下では `.env` がコンテナから見えず、key が無いと判断されて自動 disable
- 修正: PR #72
- 関連シナリオ: L-23

#### B-02. `yarn sandbox:login` で docker image が無い
- 症状: `Unable to find image 'mulmoclaude-sandbox:latest' locally` エラー
- 原因: image を build せずに login コマンドが走る
- 関連シナリオ: L-24

#### B-03. Docker サンドボックスで root 権限のファイルが残る副作用
- 症状: Linux で動かすと root 権限のファイルが作られて、host 側で書き換え不能
- 修正: PR #85（sandbox 内ユーザを root → 通常ユーザに変更）
- 関連シナリオ: L-25 (manual-l4)

#### B-04. PR #85 の副作用で「No conversation found with session ID」
- 症状: 過去のセッションを resume するとエラー
- 原因: workspace path が `/workspace` → `/home/node/mulmoclaude` に変わったため別ディレクトリを参照
- 関連シナリオ: L-26

#### B-05. Mac+Docker 下で Claude credential が expire
- 症状: host 側で auth token が更新されたのに container 側で更新されず Claude Code が使えなくなる
- 原因: Mac の keychain に credential が入るため Docker から見えない
- 修正: PR #97（Keychain 用ソリューション）/ PR #241（auto-renew）
- 関連シナリオ: L-27 (manual-l4)

#### B-06. Docker 下で git/gh が動かない（認証）
- 症状: docker 内では git/gh の認証が通らない（特に SSH）
- 修正: PR #327（SSH agent forward / HTTP key の file mount + ALLOWED_HOSTS で github.com に限定）
- 関連シナリオ: L-28

#### B-07. MCP server Docker クラッシュ
- 症状: docker + モノレポの複合要因で MCP server が crash
- 修正: PR #429（関連: cross-import 破損 → PR #424）
- 関連シナリオ: L-29

#### B-08. skill が Docker sandbox + symlink の組み合わせで動かない
- 症状: `~/.claude/skills` を symlink で管理していると sandbox 内で dangling link になり skill が見えない
- 回避策: `DISABLE_SANDBOX=1 yarn dev` か symlink を実 dir 化
- 関連シナリオ: L-22, L-30

### B. 起動 / インストール系

#### B-09. 新規ユーザの ENOENT 起動失敗（mkdir 順番問題）
- 症状: `mkdir ~/mulmoclaude` の前に他処理が走り ENOENT で起動失敗
- 修正: PR #96（順番入替）

#### B-10. `npx mulmoclaude` で sandbox setup 失敗（Dockerfile.sandbox 同梱漏れ）★進行中
- 症状: `ENOENT: no such file or directory, open '.../mulmoclaude/Dockerfile.sandbox'`
- 原因: `Dockerfile.sandbox` が npm パッケージに同梱されていない
- 修正: 0.5.3 で対応中

#### B-11. `npx mulmoclaude` で Sandbox モードに入らない
- B-10 と同根

#### B-12. main ブランチ pull 後の `yarn dev` で ERR_MODULE_NOT_FOUND
- 症状: `@receptron/task-scheduler` が見つからない
- 原因: streaming 対応時に追加した CLI option / task-scheduler パッケージ未 build
- 修正: PR #424

### C. 認証 / セッション系

#### B-13. サーバ再起動で CLI クライアントが再接続できない
- 症状: 起動時生成 token を使う仕様で、サーバ再起動で token が変わり bridge が再接続できない
- 暫定: 環境変数で固定 token を渡す機能を追加予定
- 関連シナリオ: L-13

#### B-14. main で「チャットメッセージが入らない」（hotfix 対応）
- 修正: hotfix PR で main にマージ
- 関連シナリオ: L-11

#### B-15. Gemini API key 不要な General ロールでも入力欄が disabled
- 症状: Gemini key 未設定だと General ロールで入力／送信が disabled
- 原因: General ロールが `generateImage` を含む → `needsGemini("general") = true` の判定
- 修正: PR #158（disabled ではなく警告バナー表示に変更）
- 関連シナリオ: L-10

#### B-16. 数時間前のチャットセッションが消える
- 症状: 1 つ前の会話を覚えていない／数時間前の session がない
- 原因: KVCache をサーバーで保持しており、古いものは破棄
- 対応: 履歴のうち LLM が見るべきものだけを渡す実装に変更
- 関連シナリオ: L-12

### D. ファイル / 画像 / PDF 系（path-traversal 副作用）

#### B-17. file explorer で画像（グラフ）が表示されない
- 症状: html iframe 内で画像が表示されない
- 原因: iframe sandbox=「」のままだと Chart.js が動かない／Markdown の `![](path)` が解決できない
- 修正: PR #216（sandbox="allow-scripts" / CDN ホワイトリスト + CSP / `![](path)` → `/api/files/raw?path=...` 自動書き換え）
- 関連シナリオ: L-01

#### B-18. presentHtml の iframe srcdoc 内画像が 404 ★期間最大の燃え玉
- 症状: presentHTML で `<img src="mulmo_logo.png">` または `<img src="/artifacts/...">` を含む HTML を生成すると画像が 404、サーバ警告「image path escapes workspace」
- 原因: path-traversal 対策の副作用で、相対 / leading-slash 画像参照を弾くようになった
- 影響範囲: 画像入り Markdown PDF DL、CC に画像入り HTML 生成、presentHtml の iframe srcdoc 全般
- 修正方針: PR #961 を拡張して presentHtml も iframe に渡す前に `<img src="/artifacts/...">` → `/api/files/raw?path=...` に書き換え
- 重大度: 高（外部宣伝直後に発生）
- 関連シナリオ: **L-01**

#### B-19. 画像入り Markdown を PDF 化すると失敗
- 症状: 画像入り MD は表示できるが、PDF 出力で失敗
- 原因: B-18 と同じ path-traversal 副作用
- 関連シナリオ: L-02

#### B-20. 過去の PDF ダウンロード不能の再発
- 振り返り: 「以前 PDF のダウンロードができなくなっていたのも、これが原因だった」と判明
- 関連シナリオ: L-02

#### B-21. mulmoScript で作った映像のダウンロード失敗
- 症状: `GET /api/mulmo-script/download-movie` でダウンロード不能
- 修正中: PR #889
- セキュリティ指摘: bearerAuth スキップで未認証ファイル読み取り経路ができる懸念
- 関連シナリオ: L-03

#### B-22. server エラーが Web 側で見えない
- 修正: PR #90

### E. Wiki / Router / 内部リンク系

#### B-23. Wiki index から正しくリンクが貼られていない
- 修正: PR #290
- 関連シナリオ: L-14, L-16

#### B-24. wiki 内マークダウンリンクで Router catch-all → /chat へリダイレクト
- 症状: wiki ページ内のソースファイル／セッションログ等のリンクをクリックすると `/chat` に飛ぶ
- 修正: PR #742
- 関連シナリオ: L-14

#### B-25. Wiki のリンク周り 3 件まとめ
- 症状: サイドバーのプレビューカードクリックで新規セッション開始 / テキスト応答内の内部リンク不動 / Wiki の非 ASCII リンクで無関係なページが表示
- 修正: PR #588
- 関連シナリオ: L-14

#### B-26. 日本語タイトルの slug 化が壊れる
- 症状: 日本語や記号でスラッシュをふくむと挙動おかしい
- 修正: PR #655（slug 化時に自動変換）
- 関連シナリオ: L-15

#### B-27. 非 ASCII ラベルに同じ ID が付く
- 修正: PR #186（ハッシュベースの ID を付与）
- 関連シナリオ: L-15

### F. UI / 入力系

#### B-28. Safari で IME 確定 Enter がそのまま送信される
- 修正: PR #264

#### B-29. ファイルツリーの展開状態がリロード／ワークスペース切替で失われる
- 修正: PR #120（localStorage 永続化）

#### B-30. Files view を一度開くと reload で常に Files view に戻る
- 症状: Files view 中で markdown を開くと、reload で必ず Files view に戻る
- 原因: URL の `?path=...` が残ったまま
- 対応: PR #434 で `?path=` クリーンアップ
- 関連シナリオ: L-20

#### B-31. Tool Call History リロード後の更新バグ
- 修正: PR #433
- 関連シナリオ: L-19

#### B-32. ディレクトリ追加 UI で保存ボタンが 2 つ表示／右下が効かない
- 症状: 「追加」ボタン押下後、左右に保存ボタンが 2 つ。右下を押しても保存されず左の保存を押す必要がある
- 提案: 保存ボタンは 1 個にして「追加」を押した時点で保存

#### B-33. /wiki 作業中に Cmd+1 でタブ 1 に飛ぶ副作用
- 症状: ブラウザのショートカットを override するため意図しない移動が発生

#### B-34. presentForm のテキストが表示されない
- 症状: `pluginPresentForm.submit` 等のキーがそのまま表示される
- 原因: 外部 plugin だったものを内部に持ち込んだ際の i18n リソース移行漏れ
- 修正: PR #845
- 関連シナリオ: L-18

### G. テスト / Lint / CI 系

#### B-35. test:e2e が失敗（Playwright インストール不足）
- 補足: `npm i -g @playwright/cli@latest` だけでは不十分

#### B-36. vite の `node_modules/.vite` キャッシュ古いと E2E が旧コードで fail
- 回避: `rm -rf node_modules/.vite`
- ToDo: docs/manual-testing.md に注意書き追加

#### B-37. e2e テスト不足カバレッジ
- 修正: PR #209

#### B-38. claude が e2e するために 5173 を kill する問題
- 修正: 45173 ポートに割り当て

#### B-39. test-results ディレクトリが gitignore されていない

#### B-40. .vue で eslint が効いていなかった
- 症状: eslint 有効化したらエラーが 200 個出現
- 補足: 復旧途中で「全部に eslint disable をつけてしまった」事故も発生

### H. ToolSearch / Claude CLI 連動

#### B-41. ToolSearch で `presentMulmoScript` / `readXPost` が見つからない
- 症状: 各 Role の sample query を流すとどれも失敗
- 原因（推定）: Claude CLI 2.1.114 でツール数が多いと `deferred tools` に切り替わる仕組み。MulmoClaude は 18 個以上のツールを登録しているため自動で deferred mode に入った
- 修正: PR #424
- 関連シナリオ: L-06〜L-09, L-21

### I. 動画 / Mulmocast 系

#### B-42. Seedance 2 が同じプロンプトで成否ばらつく
- 症状: test script も何度か実行しないと全 OK にならない
- 関連 PR: mulmocast-cli #1347

#### B-43. veo 系での rate limit エラー（4 回/分）
- 症状: 各 beat に moviePrompt を持つ script を veo3 で映像化すると rate limit に引っかかる
- 状態: 解決方法を考案中

#### B-44. Replicate 一時利用不可
- 症状: `Service is currently unavailable due to high demand. (E003)`

#### B-45. mulmocast textSlide の背景が黒で読みにくい
- 修正: mulmocast-cli #1344

#### B-46. mulmocast の animation:true で映像生成失敗
- 症状: animation:true のケースで映像の生成に失敗するケース
- 原因（暫定）: animation:true の場合、audio を先に生成してから image を生成すべき
- 関連シナリオ: L-04

#### B-47. mulmocast の Gemini TTS エラー詳細不足
- 修正: mulmocast-cli #1358（エラー detail を返す）

#### B-48. MulmoClaude からの画像生成が失敗するようになった
- 補足: 同時期に外部 LLM プロバイダ側障害が発生していた可能性

### J. セッション ID / favicon / 履歴系

#### B-49. currentSessionId と displayedCurrentSessionId の二重管理
- 症状: 状態管理が複雑化
- 関連: PR #777（リファクタ）

#### B-50. 二重通知（bridge メッセージで bell アイコンと history の両方に出る）
- 修正: PR #818（bridge メッセージは history のバッジのみ）
- 関連シナリオ: L-17

### K. 外部要因（参考、対象外）

#### E-01. GitHub レート制限
#### E-02. Anthropic API 500 / status 異常
#### E-03. GitHub の Pull Request 一覧表示がバグる
