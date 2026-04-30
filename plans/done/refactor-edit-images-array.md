# `editImage` → `editImages` (path-array, fully stateless) — 実装プラン

## ゴール

`editImage` を **`editImages`** にリネームし、`{ prompt: string, imagePaths: string[] }` を受け取る純粋関数に作り直す。session ストアからの「直近画像」引き当てを完全廃止し、画像参照は **必ず LLM が `imagePaths` で渡す**契約に揃える。Single PR で完結させる。

副次的に、Vue クライアントの request body / server の HTTP route body / session-store から **`selectedImageData` を全削除** する。Vue 側は paste/drop / sidebar pick を `attachments[]` に一本化し、各 Attachment に `path?: string` を持てるよう protocol 型を拡張する。**bridge 経由の `StartChatParams.selectedImageData` のみ既存互換のため残す**（外部 bridge クライアントの breaking を避ける）。

## 前段プランとの関係

直前のプラン (`plans/done/refactor-stateless-image-editing.md`) は Stage 1 が PR #1045 で merge 済み（paste/drop の事前 upload + `[Attached file: <path>]` ヒント注入 + bytes loading）。残された Stage 2/3（`editImage` への path パラメータ昇格、session 全廃、field 整理）は、本プランで **単一 PR にまとめて完結** させる方針に変更。複数画像入力のサポートを足したい（Gemini の image-edit API は multi-image を許容）こと、および中間状態を作っても LLM の path 遵守率を別途検証する手間が大きいことを踏まえての再設計。

## 現状（Stage 1 完了時点）

- `editImage` ツール定義は `prompt` だけを宣言（`src/plugins/editImage/definition.ts:15-24`）。
- サーバ `/api/images/edit` は `getSessionImageData(session)` で session ストアから「直近画像」を引いて Gemini に渡す（`server/api/routes/image.ts:138-184`）。session に何もない場合は 400 で `"No image is selected..."`。
- `selectedImageData` は body フィールドとして残ったまま（`server/api/routes/agent.ts:103,124,151,205,338` / `packages/chat-service/src/types.ts:44` / `src/utils/agent/request.ts:13,20,46` / `src/App.vue:874`）。中身は実質 workspace-relative path だが、型としては「path or data:URL」のままになっている。
- `prepareRequestExtras` は path 受信時にバイトを読んで Attachment を作り、かつ `[Attached file: <path>]` を user message に prepend する（`server/api/routes/agent.ts:258-326`）。これは Stage 1 で投入済み — 本 PR でも勘所はそのまま流用する（入力ソースを `attachments[]` に揃えるだけ）。
- session-store は `ServerSession.selectedImageData` field と `getSessionImageData` を保持（`server/events/session-store/index.ts:34,85,93,105,417-419`）。
- canvas 経路の `applyStyle` は path を含めずに英語テキストだけを `sendTextMessage` する（`src/plugins/canvas/View.vue:133-135`）。
- `Attachment` 型 (`packages/protocol/src/attachment.ts`) は `{ mimeType, data, filename? }` の bytes-only。

## ターゲット設計

```
[client (Vue)]
 ├─ paste/drop 画像 → /api/images/upload で先にディスク保存 → path
 ├─ サイドバーで既存 tool result 選択 → 既に path を持っている
 └─ どちらも attachments[] に { path, mimeType } として詰める（base64 を transit しない）

 chat 送信:
   POST /api/agent
   body: { message, roleId, chatSessionId, attachments?: Attachment[], ... }
            ↑ selectedImageData は廃止

[client (bridge — 既存互換)]
 └─ StartChatParams.selectedImageData (path or data:URL) は従来どおり受け付ける
    + StartChatParams.attachments[] (bytes) も従来どおり

[server]
 ├─ Vue 経由の attachments[] と bridge 経由の selectedImageData を共通の
 │  Attachment[] に正規化 (prepareRequestExtras)
 ├─ Attachment に path がある → safeResolve + loadImageBase64 で bytes を補完
 ├─ Attachment に bytes (data) のみ → そのまま Claude に流す
 ├─ 最初に path を持つ Attachment の path を `[Attached file: <path>]`
 │  として user message 先頭に prepend
 │  → LLM は editImages 呼び出し時にこの path を imagePaths に渡せる
 └─ session ストアには画像状態を保存しない（getSessionImageData 全削除）

 editImages tool:
   parameters: { prompt: string, imagePaths: string[] }
                ↑ 必須。長さ 1 以上。
   server: imagePaths を 1 件ずつ safeResolve → loadImageBase64
           → Gemini parts に inlineData を imagePaths.length 個並べる + text
   session 参照は 0 行
```

**核心は 3 つ**:

1. **画像参照は tool args が source of truth**。session に持たせない。
2. **複数画像入力をネイティブにサポート**。Gemini の image-edit エンドポイントは単一 turn で複数 `inlineData` parts を受け付けるので、サーバ側は path をそのまま `parts` に並べるだけ。
3. **Vue 側の `selectedImageData` 概念を消す**。すべての添付は `attachments[]` を通る。bridge は互換のために旧 field を温存。

## 変更ファイル一覧

### 1. プラグイン定義 / 実装の rename

| ファイル | 変更 |
|---|---|
| `src/plugins/editImage/` (dir) | `src/plugins/editImages/` に rename（git mv） |
| `src/plugins/editImages/definition.ts` | `TOOL_NAME = "editImages"`、`description` / `prompt` 文言更新、`parameters.properties.imagePaths: { type: "array", items: { type: "string" }, description: "Workspace-relative paths to the images to edit. Pass at least one." }` 追加、`required: ["prompt", "imagePaths"]` |
| `src/plugins/editImages/index.ts` | import path 修正、`editImagesPlugin` に変数名変更、`generatingMessage` を `"Editing images..."` に |
| `src/plugins/editImages/View.vue` / `Preview.vue` | 型 import パスの追従のみ（既存 `ImageToolData` をそのまま流用 — 結果は単一画像の path） |
| `src/tools/index.ts:11,46` | import + `editImages: editImagesPlugin` に rename |
| `src/config/toolNames.ts:47` | `editImages: "editImages"` に rename |
| `src/config/roles.ts:136-138` | role description と `availablePlugins` の `editImage` → `editImages` 置換、文言を「複数画像入力対応」に微調整 |
| `server/agent/plugin-names.ts:22,43,65` | import 名 + `API_ROUTES.image.edit` への mapping を `editImages` で再登録 |
| `server/workspace/tool-trace/classify.ts:26` | `IMAGE_TOOLS` set の `"editImage"` を `"editImages"` に置換 |
| `test/tool-trace/test_classify.ts:87` | テストデータの `toolName: "editImage"` → `"editImages"` |
| `server/workspace/helps/gemini.md:12` | `editImage` の説明 → `editImages`、複数画像入力の例を追記 |

### 2. サーバルート（stateless 化 + 配列対応）

| ファイル | 変更 |
|---|---|
| `server/api/routes/image.ts:3` | `getSessionImageData` の import 削除 |
| `server/api/routes/image.ts:134-184` | `EditImageBody` → `EditImagesBody = { prompt: string; imagePaths: string[] }`。`session` クエリは取得しない（session 参照を完全削除）。`imagePaths` の存在 / 配列性 / 1 件以上 / 全要素 string をチェックし不正なら 400 |
| `server/api/routes/image.ts` | 各 path を `safeResolve` 経由で `loadImageBase64` → `parts` に `inlineData` を並べる。最後に `{ text: prompt }` を append。`generateGeminiImageContent` の呼び出し形は parts 配列を渡せば既存実装で OK（line 161-165 のパターンを多重化するだけ） |
| `server/api/routes/image.ts` `respondWithImage` | 変更不要（saved image path を返すだけなので） |
| `server/api/routes/image.ts` log | `sourceKind` を捨て、`imageCount: imagePaths.length` を log info に追加 |

`safeResolve` は既存の path traversal 防御。`artifacts/images/` と `data/attachments/` の両 root 配下を許可（前者は generated/canvas、後者は paste/drop）。`isImagePath()` は不要（path-only になるので分岐不要）。

### 3. Vue 側の `selectedImageData` 削除 + Attachment 型拡張

Vue クライアント / server の HTTP route / session-store から `selectedImageData` を**完全削除**。Vue は `attachments[]` に詰めて送る。bridge 側の `StartChatParams.selectedImageData` は **互換のため残す**。

| ファイル | 変更 |
|---|---|
| `packages/protocol/src/attachment.ts` | `Attachment` 型を `{ mimeType, data?, path?, filename? }` に拡張。`data` は optional に降格、`path` を新設。「path があれば bytes 不要、サーバが disk から読む」ことを JSDoc に明記。`data` と `path` のいずれかは必須（XOR） |
| `src/utils/agent/request.ts:13,20,46` | `selectedImageData` field を**削除**。`buildAgentRequestBody` は `attachments?: Attachment[]` をそのまま流す |
| `src/App.vue:843-874` | `attachmentForRequest` / `extractImageData(selectedRes)` の値を `attachments` 配列に詰める。paste/drop は `{ path, mimeType: "image/png" }`、sidebar pick も `{ path, mimeType: "image/png" }`。`selectedImageData` キーは渡さない |
| `server/api/routes/agent.ts:103,124,151,205,338` | `AgentBody.selectedImageData` と `StartChatParams.selectedImageData` （**HTTP route 側のみ**）を削除。Vue 経由は `attachments[]` のみ。Bridge 経由（後述）は別経路 |
| `server/api/routes/agent.ts:258-326` `prepareRequestExtras` | 入力を `attachments?: Attachment[]` のみに統一。各 attachment が `path` を持っていれば `safeResolve` + `loadImageBase64` で bytes を補完、`mimeType` を path から推定（or 受信値）。最初に path を持つ attachment の path を `attachedFilePath` として返す。`resolvePrimaryAttachment` / `loadFromAttachmentPath` / `loadFromImagePath` は新形に合わせて単純化 |
| `server/api/routes/agent.ts` JSDoc | "data: URL fallback" 記述を Vue 側から削除。bridge 側互換ロジックの説明に書き直す |
| `server/events/session-store/index.ts:34,85,93,105,417-419` | `ServerSession.selectedImageData` field、`getOrCreateSession` の `opts.selectedImageData`、`getSessionImageData` 関数 + export を**全削除** |
| `test/events/test_session_store.ts` | `selectedImageData` を期待する assertion 削除 |
| `test/utils/agent/test_request.ts` | `selectedImageData` 関連テスト削除、`attachments[]` 経由のテストを追加（path のみ / bytes のみ / 両方） |

### 4. bridge 経由の互換ブリッジ（最小限）

`packages/chat-service/src/types.ts:44` の `StartChatParams.selectedImageData` は**残す**。これは外部 bridge クライアント（Telegram / LINE 等）が path or data:URL を渡してくる経路で、本 PR では breaking を避ける。

| ファイル | 変更 |
|---|---|
| `packages/chat-service/src/types.ts:44` | コメント更新のみ。「Vue 経由は attachments[] に統一済み。本 field は外部 bridge クライアント互換のためにのみ存在する」と明記 |
| `packages/chat-service/src/<bridge entry>` | bridge が `StartChatParams.selectedImageData` を受け取ったら server 内部で `attachments[]` の 1 要素 (`{ path }` or `{ mimeType, data }` from data:URL) に正規化してから `prepareRequestExtras` に渡す。新規ヘルパ `normalizeBridgeSelectedImage(value): Attachment | undefined` を切り出し、`parseDataUrl` 互換を局所化する |

要するに「`selectedImageData` を理解するのは bridge アダプタ層だけ」「内部はすべて `attachments[]`」という分離。これで bridge protocol の breaking change は発生しない。

### 5. canvas → editImages 動線

| ファイル | 変更 |
|---|---|
| `src/plugins/canvas/View.vue:133-135` | `applyStyle` の sendTextMessage 文言に canvas の `imagePath` を埋め込む。例: `` `Turn the image at \`${imagePath.value}\` into a ${style.label} style image.` ``。`imagePath.value` が空（未保存）の場合は従来文言 fallback |

これで canvas 経路でも LLM が `[Attached file: …]` ヒントを通さずとも path を受け取れる（canvas は user の picked file ではなく "今見ている描画" なので `attachments[]` には乗らない）。

### 6. system prompt 微調整

| ファイル | 変更 |
|---|---|
| `server/agent/prompt.ts:50-63` | "Attached file marker" 節は維持。tool 名を `editImage` → `editImages` に置換。`imagePaths` で path を必ず渡す旨と「複数画像入力時はユーザー指示の意図に応じて 2 つ以上並べてよい」旨を 1〜2 行追記 |

## 受け入れ条件

- [ ] `grep -rn "editImage\b" server src packages test --include='*.ts' --include='*.vue'` が 0 件（コード本体）
- [ ] `grep -rn "selectedImageData" server src test --include='*.ts' --include='*.vue'` が 0 件 — `packages/chat-service/` 配下のみ残る（bridge 互換）
- [ ] `grep -rn "getSessionImageData" server src packages test` が 0 件
- [ ] LLM が `editImages({ prompt, imagePaths: ["artifacts/images/..."] })` を呼ぶ（実機サンプル 3〜5 件目視 + tool-trace ログ）
- [ ] 単一画像（貼り付け 1 枚 → 「Ghibli 風に」）動線が緑
- [ ] 複数画像（サイドバーで 1 枚選択 + paste で 1 枚 → 「この 2 枚を合成して」）動線が緑（手動）
- [ ] canvas → アートスタイルボタン → editImages 動線が緑（applyStyle が canvas path を文中に埋める）
- [ ] パストラバーサル試行（`../../etc/passwd` 等）が `safeResolve()` で 400 になる
- [ ] `imagePaths` 未指定 / 空配列 / 非配列 で 400 を返す
- [ ] bridge 経由 `StartChatParams.selectedImageData` で path / data:URL のいずれを送っても従来どおり動く（既存 bridge テストが緑のまま）
- [ ] e2e `image-plugins.spec.ts` 全緑（リネーム反映）
- [ ] session-store の `ServerSession` 型から `selectedImageData` が消えている、`getSessionImageData` の export が消えている
- [ ] `yarn format && yarn lint && yarn typecheck && yarn build && yarn test && yarn test:e2e` 全緑
- [ ] i18n 影響なし（このリファクタは UI 文言を増やさない — `applyStyle` の文字列は LLM へ渡す英文プロンプトで `t()` 対象外）

## Risks / Open Questions

- **`Attachment` 型に `path?` を足す breaking 性**: `data` が必須 → optional への降格は型レベルでは breaking。`@mulmobridge/protocol` の minor bump で済ませるか major にするか要判断。既存 bridge は `data` を常に送っているので runtime breaking は無いが、TS 利用者は型チェックで気づく。CHANGELOG に明記。
- **Gemini multi-image 入力の挙動確認**: `gemini-2.5-flash-image-preview` (nano-banana) は単一 turn で複数 `inlineData` parts を受け付けるが、出力は常に 1 枚。3 枚以上送ったときの精度劣化や順序依存は実機で観察する。期待 5 件以下を目安にし、超えたら 400 で reject するか、prompt 側で「最大 5 枚」と教えるか後で判断。
- **LLM の `imagePaths` 配列遵守率**: 単一画像でも `imagePaths: ["..."]` と書く必要がある。schema の `required` で強制できるが、prompt の few-shot example に「単一でも配列で渡す」を 1 行入れて遵守率を上げる。完了時にサンプル取って 95% 未満なら few-shot 増量。
- **既存 chat 履歴の互換性**: jsonl に保存済みの `editImage` tool call 履歴は **そのまま残る**（永続化レイヤーは tool 名を validate しない）。新規 turn から `editImages` に切り替わるだけで、過去の record を migrate する必要はない。UI 側の plugin map から `editImage` は消えるが、過去 result の View 描画には `viewComponent` ルックアップ失敗 → 汎用 fallback で十分（既存パターン）。
- **`ImageToolData` 型名**: 入力は `imagePaths` 配列だが結果（tool result の `data`）は単一 `imageData: string` のままなので、型名は流用で問題なし。混乱を避けるため `ImageEditResult` への rename も検討したが、本 PR の diff を膨らませるのでスコープ外。
- **bridge アダプタの所在**: `normalizeBridgeSelectedImage` を `packages/chat-service/` のどこに置くかは実装時に確定。`startChat` 入口の関数として一本化する想定。

## Out of scope（別プラン候補）

- **全 attachment の path 統一（bridge 含む）**: bridge クライアントが `attachments[]` に直接 `path` を載せて送る世界に揃えるのは別 PR。`StartChatParams.selectedImageData` は段階的 deprecate → 数リリース後に削除する想定（`feat-attachments-as-paths.md` 系）。
- **`editImages` の出力複数化**: 現状 Gemini は 1 出力なので tool result も単一画像。将来 N 枚返す API に乗り換える場合は `data.imagePaths: string[]` を返す形に再設計。
- **複数画像の sidebar 同時選択**: サイドバー UI が複数選択を持っていないので、user が "選んだ画像" は依然単一。複数画像で edit したい場合は paste 1 枚 + sidebar 1 枚、または LLM が会話履歴から path を拾う運用で当面足りる。

## 関連

- 直前プラン: `plans/done/refactor-stateless-image-editing.md`（Stage 1 が PR #1045）
- canvas path-first 設計: `server/api/routes/plugins.ts:240-254`、`src/plugins/canvas/View.vue:151-159`
- Attached file marker 仕様: `server/agent/prompt.ts:50-63`、`server/api/routes/agent.ts:319-326`
