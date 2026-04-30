---
name: make-e2e-live
description: e2e-live スイートを継続メンテする。`plans/feat-e2e-live.md` の TODO と直近 main の動向を起点に、未実装シナリオ追加・既存修正・config 改善（webkit project, self-repair 緩和等）を 1 PR で進める skill。実行用の `/e2e-live` skill とは別物。
---

## この skill の位置づけ

| skill | 役割 |
|---|---|
| `/e2e-live` | 既存スイートを **回す**（QA / 回帰検出） |
| `/e2e-live-<category>` | 既存カテゴリだけ回す |
| **`/make-e2e-live`（このskill）** | 既存スイートを **育てる**（未実装シナリオ追加 / 修正 / config 改善） |

「実 LLM e2e の追加実装をしたい」 と思ったらこの skill を起点にする。 巨大 PR を避けるため **1 PR = 1〜3 シナリオ or 1 config 改善** に絞ること。

## Phase 1: 状況把握

最初に以下をユーザーに見せる前に自分で読む:

1. `plans/feat-e2e-live.md` の以下セクション:
   - 「実装ステータス」 表（L-01〜L-30 のうち ✅ / 未実装の現状）
   - 「直近 main の動向 (#950〜#1000) と本テスト計画への反映」 の **「要対応」** 項目
   - 「未確定事項 / TODO」 のチェックリスト
2. main を最新化:
   ```bash
   git checkout main && git pull --ff-only
   ```
   SSH passphrase が必要な環境では Claude 側から pull できないので、 失敗したらユーザーに依頼する。
3. 前回 e2e-live PR merge 以降の main の動きを確認:
   ```bash
   git log main --oneline --since="<前回 merge 日>"
   ```
   spec の前提を変える PR があれば優先順位を上げる。 過去例:
   - #969 / #972 image-path-routing → L-01 assertion 更新
   - #982 filePath-only / `/artifacts/html` mount → L-01 prompt convention 更新
   - #974 onerror self-repair → L-01 `naturalWidth > 0` の検出力低下、 緩和策が TODO 残
   - #991 Safari preview iframe CSP → webkit project 追加が TODO 残
4. ユーザーから chat で追加要望が来ていれば、 上記 3 つに統合する。

## Phase 2: 着手項目の合意

Phase 1 の結果を踏まえ、 ユーザーに以下フォーマットで提示:

```text
## 着手候補

### A. 未実装シナリオ
- L-03 mulmoScript 動画 DL（B-21）
- L-04 animation:true（B-46）
- ...

### B. config / 基盤改善（main 動向起点）
- webkit project 追加（PR #991 対応）
- self-repair 緩和策（PR #974 対応）

### C. ユーザー追加要望
- （あれば）

→ どれをこの PR に入れますか？ 推奨: A から 1〜2 個 + B から 0〜1 個（PR を中規模に保つ）
```

ユーザーの選択を待つ。 勝手に進めない。

## Phase 3: ブランチ作成

合意できたら branch を切る:

```bash
git checkout main && git pull --ff-only
git checkout -b feat/e2e-live-<topic>
```

`<topic>` は内容を表す短い英語（例: `l03-movie-dl`, `webkit-project`, `self-repair-guard`）。

## Phase 4: 実装

既存パターンを踏襲する。 `plans/feat-e2e-live.md` の 「実装の詳細」 セクションが詳細仕様。

### 共通ルール

- helper の追加先:
  - 複数 spec で再利用するもの → `e2e-live/fixtures/live-chat.ts`
  - その spec 内だけで使うもの → spec 内 local function
- workspace 配置 / cleanup:
  - 配置: `placeFixtureInWorkspace(fixtureRel, workspaceRel)`
  - 削除: `removeFromWorkspace(workspaceRel)` を必ず `finally` で呼ぶ
  - workspace path に spec 名を含めて並列衝突を回避（例: `artifacts/images/e2e-live-l03.png`）
- session cleanup: `getCurrentSessionId(page)` + `deleteSession(page, sessionId)` を `finally` で
- iframe 内 DOM:
  - **`frameLocator` API を使う** — `page.evaluate` + `iframe.contentDocument` は Vue の srcdoc 更新で古い document を返す罠
  - iframe `toBeVisible` だけでは早すぎる。 内側の特定要素を `frameLocator(...).locator(...)` で待つ
- assertion 達成後に `waitForAssistantResponseComplete(page)` を呼ぶ — 呼ばないと trace / video が応答途中で切れる
- testid 新設時:
  - 命名: `data-testid="<plugin>-<role>"` の kebab-case
  - **同 PR で `docs/ui-cheatsheet.md` の該当 ASCII ブロックを更新**（CLAUDE.md ルール）
  - 翻訳テキストや `iframe[sandbox]` 構造属性に依存しない（脆い）

### コーディングルール（CLAUDE.md より）

- 関数 20 行以内、 超えたら分割
- `const` 優先、 `var` 禁止
- non-null assertion `!` 禁止 → `if (x === null) throw new Error(...)` で type narrowing
- パス組み立ては `node:path` の `path.join` / `path.resolve`、 `/` 直書き禁止
- `as` キャスト禁止 → type guard で narrowing
- 全 `fetch` に try/catch + `!response.ok` チェック

### 必須チェック（commit 前 / push 前に毎回実行）

```bash
yarn format
yarn typecheck:e2e-live
yarn lint
yarn test:e2e:live:<category>   # 該当カテゴリだけ
```

`yarn test:e2e:live:<category>` は実 Claude API を叩くので、 ユーザーに `yarn dev` 起動済みか / 認証 OK か確認してから走らせる。

### Docker on / off

このメンテ skill では基本 **片モードだけ** で OK。 「両モード巡回」 は実行用 `/e2e-live` の責任なので、 メンテ中は手元の dev のモードで pass まで持っていけば十分。 PR で「両モードで pass 確認した」と書く必要があれば、 commit 前にユーザーに `DISABLE_SANDBOX` 切替を依頼する。

## Phase 5: commit / push / PR / bot 対応

- commit はこまめに（schema 追加 → commit、 helper 追加 → commit、 spec 1 本 → commit）
- commit message: 英語、 prefix `feat:` / `fix:` / `refactor:` / `docs:` / `chore:`
- `git add .` 禁止 — 個別ファイル追加
- push は **必ずユーザー依頼**（SSH 認証は Claude 側で動かない）
- push 完了後に `gh pr create`:
  - title: 英語、 70 文字以内
  - body: 日本語、 **冒頭に Summary + Items to Confirm / Review** を置く（CLAUDE.md ルール）
  - User Prompt セクションを含める（このセッションでのユーザー指示を要約）
  - 個人名 / 生コメントの混入禁止 — 匿名化する
- push 後は `/coderabbit-review` skill で CodeRabbit / Sourcery / 他 bot コメントをトリアージ

## Phase 6: plans 反映

同 PR 内で `plans/feat-e2e-live.md` を更新:

- 実装したシナリオを 「実装ステータス」 表で ✅ 化（備考に「<spec>.spec.ts、 <要点>」 を 1 行）
- 「未確定事項 / TODO」 のうち解消したものは消す or 「→ PR #XXX で解消」 に書き換え
- 「直近 main の動向」 の 「要対応」 から取り込んだ項目は 「反映済」 に移動

これは別 PR にせず **同 PR でセットコミット**。 ステータスとコードを必ず同期させる。

## 保守 mode への自己改修（全シナリオ実装後）

「実装ステータス」 表が L-01〜L-30 全 ✅（うち L-25 / L-27 は manual-l4 として `docs/manual-testing.md` に移動済）になったら、 この skill を保守用に縮める:

- Phase 1 の手順 1 から 「実装ステータス」 行を削除（読むのは「直近 main の動向」 と「TODO」 だけで十分）
- Phase 2 着手候補の 「A. 未実装シナリオ」 セクションを削除（B / C のみ残す）
- description を 「e2e-live スイートの保守。 main の動向起点で既存シナリオ修正・config 改善を行う」 に書き換え

この自己改修も同 PR でコミットする。 plans 側の Status と skill 側の挙動を同時に切替えるのが合流ポイント。

## アンチパターン

- ❌ 1 PR で 5 シナリオ以上を一気に追加 — review が破綻、 bot が rate-limit、 1 つこけると全部 revert
- ❌ helper を spec 内に書いてから「あとで fixtures に切り出す」 — そのまま放置されて重複が増える。 「2 spec で使う」 が見えた時点で切り出す
- ❌ `mockAllApis(page)` を呼ぶ — このスイートは実 LLM 経路の検証が目的、 mock すると意味がない
- ❌ 応答テキストでの assertion — LLM 揺れに弱い。 DOM 状態（visible / `naturalWidth` / `src` 属性 / download magic bytes）で見る
- ❌ `assert(x !== null); use(x!)` の non-null assertion — `if (x === null) throw new Error(...)` で narrow
- ❌ webkit project を追加するときに spec を変えに行く — config 追加だけで pass / fail が分かれるので、 まず config 追加 → 別 PR で spec 側調整

## 参照

- `plans/feat-e2e-live.md` — 設計仕様 / 実装ステータス / 内部バグ ID 対応表
- `e2e-live/fixtures/live-chat.ts` — 既存 helper 一覧
- `e2e-live/tests/media.spec.ts` — L-01 / L-02 の参考実装
- `docs/ui-cheatsheet.md` — testid 追加時に併せて更新
- `CLAUDE.md` — コーディングルール / git 運用 / PR フォーマット
