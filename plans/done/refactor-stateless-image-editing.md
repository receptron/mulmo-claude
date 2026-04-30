# 画像編集のサーバ側ステートレス化 — 実装プラン

## ゴール

`editImage` を「LLM がパスを渡す純粋関数」に作り直し、**「現在ユーザーが選択している画像」をサーバ（セッションストア）側で覚えるロジックを完全に削除する**。

副次効果として、`selectedImageData` が data URI を運ぶレガシー経路（貼り付け／ドロップ画像）も廃止。**`selectedImageData` という field 自体を消す。**

## 現状の問題（要約）

- `editImage` ツール定義は `prompt` だけを宣言しているが、サーバは `getSessionImageData(session)` で **session ストア**から「直近に user が送った画像」を引いて Gemini に渡している（`server/api/routes/image.ts:146`）。これは tool の入出力契約を守らない暗黙依存で、テスト性も低い。
- `selectedImageData` は 2 つの異なる用途を兼任している:
  1. Claude が user 入力として画像を「見る」ための multimodal attachment（`mergeAttachments` 経由、`server/api/routes/agent.ts:227, 241-253`）
  2. `editImage` が後で取り出す「編集対象画像」（session ストア経由）
- そのため値の形が **data URI と path のハイブリッド**になっており、`isImagePath()` で分岐しないと使えない（`server/api/routes/image.ts:158`）。
- 起源は「貼り付け／ドロップ画像はディスクに無いから data URI にせざるを得ない」だったが、canvas 経路はもう「開いた瞬間にディスクに保存 → 以降は path のみ」で動いており（`server/api/routes/plugins.ts:247-254`、`src/plugins/canvas/View.vue:151-159`）、**path 統一は既に半分達成済み**。あと一押し。

## ターゲット設計

```
[client]
 ├─ paste/drop 画像 → 送信時に POST /api/images で先にディスク保存 → path を取得
 ├─ サイドバーで既存 tool result を選択 → 既に path を持っている
 └─ どちらも path を pickedImagePath として保持

 chat 送信:
   POST /api/agent
   body: { message, roleId, chatSessionId, pickedImagePath?, attachments?, ... }
            ↑ data URI は 1 回も乗らない

[server]
 ├─ pickedImagePath があればファイルを読んで multimodal attachment に変換
 │  → Claude が画像を「見える」状態にする（用途 1）
 ├─ pickedImagePath を user message に hint として prepend:
 │     "[Selected image: artifacts/images/2026/04/abc.png]\n\n<本文>"
 │  → LLM は editImage 呼び出し時にこの path をそのまま渡せる（用途 2）
 └─ session ストアには pickedImagePath を保存しない（ステートレス）

 editImage tool:
   parameters: { prompt: string, imagePath: string }   ← LLM が path を渡す
   server: body.imagePath を safeResolve → ファイル読込 → Gemini
   session 参照は 0 行
```

**核心は「session に画像状態を持たせない」こと**。Claude が画像を「見る」用途も「編集する」用途も、両方ともリクエスト本体に乗ってきた path から派生する。

## 全体構成

| レイヤー | 仕事 |
|---|---|
| client `sendMessage` | paste/drop は事前 upload して path 化、`pickedImagePath` を確定 |
| `/api/agent` body | `selectedImageData` 廃止、`pickedImagePath` 追加（path のみ） |
| server `startChat` | path から attachment を作る、message に hint を prepend、session には保存しない |
| `editImage` tool | `imagePath` パラメータを LLM が渡す |
| server `/api/images/edit` | body の path を直接使う、session 参照削除 |
| session-store | `selectedImageData` field と `getSessionImageData` を全廃 |

各 stage は独立して merge できる順序で並べる。

---

## Stage 1: paste/drop 画像の事前 upload + path hint 投入（PR #1045）

クライアント側で paste/drop 画像を `/api/images` に事前 upload して `selectedImageData` を **常に path** にし、サーバ側は path 受信時に (a) ファイルを読んで Claude に bytes を見せる + (b) `[Selected image: <path>]` をユーザーメッセージ先頭に prepend して LLM に path を見せる。**「path hint の prepend」は当初 Stage 3 の予定だったが、Stage 1 で paste 経路の data URI → path 切り替えに伴って `parseDataUrl()` が失敗して bytes が Claude に届かなくなる回帰が出たので、回帰修正と同時に hint も Stage 1 に前倒し**（Codex レビュー指摘）。

### 変更ファイル

| ファイル | 変更内容 |
|---|---|
| `src/App.vue` (`sendMessage`) | `fileSnapshot.dataUrl` をそのまま渡す代わりに `resolvePastedAttachment()` 経由で画像のみ事前 upload、結果の path を `selectedImageData` に渡す。upload 失敗時は `userInput` / `pastedFile` を復元 + チャットにエラー |
| `src/utils/agent/pastedAttachment.ts` (新規) | 画像 → POST `/api/images` で path 取得、画像以外 → data URL を素通し |
| `src/types/pastedFile.ts` (新規) | `PastedFile` 型を `.vue` から切り出し（test tsconfig が `*.vue` を ambient shim でしか見られない問題回避） |
| `src/components/ChatInput.vue` | `PastedFile` を `src/types/pastedFile` から re-export（既存呼び出しは維持） |
| `server/api/routes/agent.ts` `mergeAttachments` → `prepareRequestExtras` | path 受信時は `loadImageBase64()` で読んで `image/png` の Attachment を作る + `selectedImagePath` を返す。データ URL は従来通り `parseDataUrl()` 経由 |
| `server/api/routes/agent.ts` `startChat` | `decoratedMessage` の頭に `[Selected image: <path>]\n\n` を prepend（path 受信時のみ）。jsonl への永続化や UI へのブロードキャストは raw `message` のまま |
| `server/agent/prompt.ts` | system prompt に「`[Selected image: <path>]` マーカーの解釈ルール」セクションを追加 |

### Stage 1 で固まった設計上の決定

- **path hint 形式**: 1 行目に `[Selected image: <workspace-relative path>]` + 空行 + 本文。複数画像はサポートしない（現状 UI が単一選択のみ）。
- **bytes も並行供給**: vision 用途のために `image/png` の Attachment ブロックも引き続き渡す。`saveImage()` が拡張子 `.png` 固定で書くので、loaded 時の MIME も `image/png` で揃える。実バイトが JPEG / WebP の場合のミスマッチは pre-existing 問題で本リファクタの範囲外。
- **ファイル読込失敗時**: warn ログ + bytes は付けない、ただし path hint は出す（LLM は最低限 path を知っており、必要なら Read で読みに行ける）。
- **データ URL 経路は温存**: 画像以外（PDF / DOCX / XLSX / PPTX / text 等）は引き続き data URL → `parseDataUrl()` → Attachment。これらの path 統一は Stage 4（別プラン候補、下記参照）。

### 受け入れ条件

- [x] 画像を貼り付けて送信すると、`/api/agent` のリクエストボディに data URI ではなく `artifacts/images/YYYY/MM/<id>.png` 形式の path が乗っている
- [x] `editImage` が貼り付け画像に対しても通る（`isImagePath()` 分岐が path 側に倒れる）
- [x] 「この画像を説明して」が引き続き動く（bytes が attachment として届く）
- [x] LLM 入力メッセージの 1 行目に `[Selected image: <path>]` が乗っている
- [x] upload 失敗時に `userInput` / `pastedFile` が復元される
- [x] `yarn format && yarn lint && yarn typecheck && yarn build && yarn test` 全緑

### Out of scope（Stage 2 以降に持ち越し）

- `selectedImageData` の rename（Stage 3）
- `editImage` のパラメータ追加（Stage 2）
- session-store からの選択画像状態の削除（Stage 3）

### Follow-up: i18n（Stage 1 に取り残された TODO）

CodeRabbit 指摘 (#1045): `src/App.vue` の upload 失敗時メッセージ `` `Failed to attach image: ${resolved.error}` `` が **ハードコード英語**で残っている。CLAUDE.md の「i18n — all 8 locales in lockstep」ルールに従い、`src/lang/en.ts` の `chatInput` セクションにキーを追加し、`ja / zh / ko / es / pt-BR / fr / de` の 7 ファイルへ展開する必要がある。

**作業内容**:

| ファイル | 変更 |
|---|---|
| `src/lang/en.ts` (`chatInput`) | `attachUploadFailed: "Failed to attach image: {error}"` を追加 |
| `src/lang/{ja,zh,ko,es,pt-BR,fr,de}.ts` | 同位置にローカライズ済み翻訳を追加（`{error}` プレースホルダはそのまま） |
| `src/App.vue` (`sendMessage`) | `pushErrorMessage(recoverySession, t("chatInput.attachUploadFailed", { error: resolved.error }))` に置換 |

Stage 1 の単独 PR にしなかった理由は、回帰修正と切り分けて i18n だけの follow-up PR で扱うため。Stage 2 に着手する前に片付けること。

---

## Stage 2: `editImage` に `imagePath` パラメータ追加 — LLM が path を渡す

ツール契約に path を昇格させる。server は body の path を優先、無ければ従来の session fallback（移行期間のため一時併存）。

### 変更ファイル

| ファイル | 変更内容 |
|---|---|
| `src/plugins/editImage/definition.ts:15-24` | `parameters` に `imagePath: { type: "string", description: "Workspace-relative path to the image to edit (e.g. artifacts/images/2026/04/abc.png)" }` を追加、`required: ["prompt", "imagePath"]` |
| `src/plugins/editImage/definition.ts:14` | `prompt` フィールド（LLM 向けガイダンス）を更新: 「会話履歴中の画像の path を `imagePath` に渡す」 |
| `src/plugins/editImage/index.ts:14-15` | `apiPost` に `args` をそのまま流す（既にそうなっているはずなので確認のみ） |
| `server/api/routes/image.ts:134-184` | `EditImageBody` に `imagePath` を追加。`req.body.imagePath` を優先、無ければ session fallback。fallback パスには deprecation warning ログ |
| `server/api/routes/image.ts:158` | `imagePath` が来たら path 系の分岐に直行（data URI 分岐はそのまま、stage 1 で実質死ぬので OK） |
| `server/agent/prompt.ts` | 「画像を編集するときは、その画像の workspace-relative path を `editImage` の `imagePath` に必ず渡す」旨の 1〜2 行追記 |

### 受け入れ条件

- [ ] LLM が `editImage({ prompt, imagePath })` を呼ぶ（実機で 3〜5 サンプル目視 + tool args ログ）
- [ ] body に `imagePath` が無い場合も従来通り（session fallback）動く
- [ ] パストラバーサル試行（`../../etc/passwd` 等）が `safeResolve()` で 400 になる
- [ ] canvas → アートスタイルボタン → editImage の動線が壊れていない（canvas は既に path を持つので、`sendTextMessage` で投げるテキストに path を含めれば LLM が拾う; どう含めるかは下記）

### canvas → editImage の path 受け渡し

`src/plugins/canvas/View.vue:133-135`:

```ts
const applyStyle = (style) => {
  props.sendTextMessage?.(`Turn my drawing on the canvas into a ${style.label} style image.`);
};
```

これを以下のように path 込みに:

```ts
const applyStyle = (style) => {
  props.sendTextMessage?.(
    `Turn the image at \`${imagePath.value}\` into a ${style.label} style image.`
  );
};
```

サイドバーで選択した generated image を edit する経路は、stage 3 の hint prepend で path が user message に乗るようになるのでそのまま動く。

---

## Stage 3: session 側の `selectedImageData` 全廃 + body field rename

session ストアから「選択画像」状態を完全削除。body の field 名も `selectedImageData` → `pickedImagePath` に rename（path 専用であることを名前で表現）。

### 変更ファイル（削除）

| ファイル | 削除内容 |
|---|---|
| `server/events/session-store/index.ts:34, 85, 93, 105, 417-419` | `ServerSession.selectedImageData` field、`getOrCreateSession` の opts.selectedImageData、`getSessionImageData` 関数本体 ＋ export |
| `server/api/routes/image.ts:3, 146-154` | `getSessionImageData` import 行、`session ?` ブロック、`No image is selected...` の 400 分岐 |
| `server/api/routes/agent.ts:114, 135, 162, 227, 241-253, 257-260, 265` | `StartChatParams.selectedImageData`、`mergeAttachments` の data URI 分岐、`AgentBody.selectedImageData`、関連コメント |
| `packages/chat-service/src/types.ts:44` | `StartChatParams.selectedImageData` field |
| `src/utils/agent/request.ts:13, 20, 46` | `selectedImageData` field |
| `test/events/test_session_store.ts` | `selectedImageData` を期待するアサーション削除 |
| `test/utils/agent/test_request.ts` | 同上 |

### 変更ファイル（追加・改修）

| ファイル | 変更内容 |
|---|---|
| `server/api/routes/agent.ts` `AgentBody` / `StartChatParams` | `pickedImagePath?: string` を追加（rename） |
| `src/utils/agent/request.ts` | `pickedImagePath?: string` を追加 |
| `src/App.vue:855` | `selectedImageData` → `pickedImagePath`、値は Stage 1 で確定済みの path |
| `packages/chat-service/src/types.ts` | `pickedImagePath?: string` を追加（bridge protocol 互換性は major bump の判断要、下記 Open Question） |
| `server/api/routes/image.ts:138-184` | session fallback ブロック削除、`imagePath` 必須化。`!imagePath` で 400 |
| `src/plugins/editImage/definition.ts` | `imagePath` を `required` のまま維持 |

注記: `prepareRequestExtras` の path → bytes loading + path hint prepend は **Stage 1 で既に投入済み**（PR #1045）。Stage 3 では `selectedImageData` という field 名を `pickedImagePath` に rename するだけで、ロジック本体は Stage 1 の実装をそのまま流用する。

### 受け入れ条件

- [ ] `grep -rn "selectedImageData\|getSessionImageData" server src packages test` が 0 件
- [ ] session-store の `ServerSession` 型から `selectedImageData` が消えている
- [ ] 貼り付け画像 → 「Ghibli 風に」テスト動線が緑
- [ ] サイドバーで既存画像選択 → 編集動線が緑
- [ ] canvas → アートスタイル動線が緑
- [ ] e2e image-plugins / chat-attach 系全緑
- [ ] `yarn format && yarn lint && yarn typecheck && yarn build` 全緑

---

## Rollout 順序

1. **Stage 1** PR #1045（事前 upload + path hint + bytes loading、回帰修正含む）→ 1〜2 日モニタ
2. **Stage 2** を独立 PR で merge（tool 契約拡張、session fallback 残す）→ LLM 出力サンプル目視 → prompt 微調整
3. **Stage 3** を独立 PR で merge（session 全廃、rename）→ 全動線回帰確認

各 stage は前段が完全動作している前提で次に進む。**Stage 2 だけ merge して止めても**「LLM が path を渡せるようになった、session fallback もまだ残っている」という安全な中間状態。

## Future direction: 全 attachment の path 統一（別プラン候補）

Stage 1〜3 は **画像** に限った話だが、PDF / DOCX / XLSX / PPTX / text を貼り付けた場合は依然として data URI 経由でサーバまで運ばれている（`prepareRequestExtras` のデータ URI 分岐 + `attachmentConverter`）。これも `data/attachments/YYYY/MM/<id>.<ext>` 等に事前保存して path 統一すれば、`prepareRequestExtras` のデータ URI 分岐が消えて完全に「path-first な agent 入力」になる。

ただし以下の論点があり、本リファクタには含めず別プラン化する:

- **置き場所**: 既存の `data/sources/`（sources プラグイン管理）と意味が混じるので別ディレクトリが必要
- **保持ポリシー / プライバシー**: data URI は「その場限り」だがディスク永続化に変えると workspace に残る。Files パネル可視化 / 削除 UI / 自動 GC のいずれかが要る
- **変換タイミング**: DOCX / XLSX / PPTX は今 `buildUserMessageLine` で on-demand 変換。upload 時に eager 変換するか、build 時に path から lazy 変換するかの設計判断
- **bridge protocol**: bridge クライアントは現在 `attachments[]` で base64 を送る。サーバ側で受信時に同じ `data/attachments/` に保存する形に揃える必要

→ **新プラン `feat-attachments-as-paths.md` を Stage 3 完了後に起こすこと**を推奨。

## Risks / Open Questions

- **bridge protocol 互換性**: `packages/chat-service` の `StartChatParams.selectedImageData` を消すと外部 bridge クライアントが壊れる可能性。stage 3 で「new field 追加 + 旧 field を 1 リリース deprecate」で 2 PR に分けるか、major bump で同時削除するか要決定。chat-service の利用者は既知の範囲では mulmoclaude のみのはず（要確認）。
- **LLM の `imagePath` 遵守率**: `editImage` 呼び出し時に hint からコピペできるかは prompt の書き方次第。stage 2 完了時にサンプル取って 95% 未満なら few-shot example を prompt に足す。
- **複数画像の選択**: 現状の sidebar 選択は単一画像。将来複数選択を入れる場合は `pickedImagePath: string` ではなく `pickedImagePaths: string[]` にする可能性あるが、本リファクタの範囲外。
- **multimodal attachment の冗長性**: hint で path が message 内に入り、かつ attachment でバイトも入る → Claude のコンテキストで両方扱うが、これは「path で参照できる + 視覚的にも見える」という狙い通りの状態。冗長ではない。
- **attachment 読込のエラー**: `pickedImagePath` のファイルが消えていた場合、`startChat` がどう振る舞うか。提案: warn ログ + attachment は付けず prepend だけ行う（LLM は path だけは知っているので存在確認できる）。

## 関連

- 関連プラン: `feat-image-path-routing.md`（rewriter 側の path 統一、本リファクタとは独立だが思想は同じ）
- canvas 設計: `server/api/routes/plugins.ts:240-254`、`src/plugins/canvas/View.vue:151-159`（既に path-first なので移行のお手本）
- 直近の関連設計: `server/api/routes/image.ts` の `respondWithImage` (`saveImage` 経由で path 返却) は既に path-first
