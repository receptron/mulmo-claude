# Fix: presentDocument の画像が UI に表示されない

Closes #782

## 背景

`モロッコ旅行のおすすめwikiを画像付きで` のような依頼で `presentDocument` を呼ぶと、サーバ上では Gemini 画像が `~/mulmoclaude/artifacts/images/YYYY/MM/*.png` に正しく保存されるのに、UI のドキュメント View に画像が出てこない。エージェント側にも明確な失敗ログが出ず、リトライが何度も走る silent failure になっていた。

調査したところ独立した二つのバグの合算だった。

### バグ A: 10 秒ブリッジタイムアウトに引っかかる

PR #765 (#722) で `server/utils/fetch.ts` に `fetchWithTimeout` が入り、`mcp-server.ts` 経由のすべてのバックエンド呼び出しがデフォルト 10 秒タイムアウトの対象になった。MCP ツールには `MCP_TOOL_BRIDGE_TIMEOUT_MS = 30s` の上書きが入ったが、**プラグイン経路 (`postJson(tool.endpoint!, args)`) は上書き無し**。`presentDocument` は Gemini 並列で 9〜11 枚生成するため 15〜25 秒かかり、毎呼び出しちょうど 10.000 秒でアボート。Express 側は走り続けるので画像も markdown も保存されるが、MCP ツール戻りはエラー。

ログ証拠 (`server/system/logs/server-2026-04-25.log`):

```
00:55:52 → 00:56:02 (10s) presentDocument call 1
00:56:29 → 00:56:39 (10s) presentDocument call 2
01:11:56 → 01:12:06 (10s) call 3
01:12:42 → 01:12:52 (10s) call 4
01:13:29 → 01:13:39 (10s) call 5
```

すべて 10.000 秒。Gemini 失敗ログは 0 件、PNG は disk に存在。

### バグ B: シャード化でパスが 2 階層ずれる

PR #771 (#764) で markdown 文書が `artifacts/documents/YYYY/MM/foo.md` にシャードされた。`plugins.ts` の placeholder 置換は

```ts
path.posix.relative(WORKSPACE_DIRS.markdowns /* "artifacts/documents" */, url)
```

を使っており、実ファイルから 2 階層下を基準に相対化していた結果、`../images/...` で出力されていたパスは実ファイルから見て不足。フロントの `rewriteMarkdownImageRefs` が解決すると workspace 外を指して 404。

```
markdown:  artifacts/documents/2026/04/morocco.md
書かれた:   ../images/2026/04/x.png  → artifacts/documents/2026/images/2026/04/x.png (NG)
正しくは:   ../../../images/2026/04/x.png 相当
```

## 修正

1. **プラグイン経路に専用タイムアウト** — `mcp-server.ts` に `PLUGIN_BRIDGE_TIMEOUT_MS = 20 * ONE_MINUTE_MS` を追加し、`postJson(tool.endpoint!, args, { timeoutMs: PLUGIN_BRIDGE_TIMEOUT_MS })` で渡す。生成 AI（画像バッチ）と将来の動画生成を前提に十分長く取る。

2. **タイムアウト/ネットワークエラーで必ず stderr ログ** — `postJson` の catch で `[mcp-bridge] TIMEOUT|NETWORK <path> after Xms (timeoutMs=...): ...` を `console.error` に出す。silent timeout が今回バグを隠した第一要因なので、これを必須化。

3. **`postJson` 上にタイムアウトポリシーのコメント** — 「生成 AI / 外部 API は十分長いタイムアウトを渡すこと、失敗時は必ずログを出すこと」を明文化。今後の追加実装が同じ罠を踏まないように。

4. **画像パスを workspace-root 絶対 (`/artifacts/images/...`)** — ドキュメントが将来どの深さに保存されても解決可能。`rewriteMarkdownImageRefs` (front-end) は leading `/` を「workspace 起点」として扱う既存挙動。

5. **画像生成 observability** — per-image `image gen start / ok / failed / no-data` (index/total/elapsedMs/promptPreview)、バッチで `image batch start / done` (succeeded/failed/total/elapsedMs)。

6. **`fillImagePlaceholders` を `server/utils/files/` に切り出し** — `markdown-image-fill.ts` 新規作成。`plugins.ts` の route handler は呼び出し1行に。プロジェクトルール（ファイル系関数は `server/utils` に集約）に揃える。

## 変更ファイル

- `server/agent/mcp-server.ts` — タイムアウト定数、`postJson` ポリシーコメント、catch の stderr ログ、プラグイン経路の `timeoutMs` 引き渡し
- `server/api/routes/plugins.ts` — image-fill ロジックを util に委譲
- `server/utils/files/markdown-image-fill.ts` — 新規 (image placeholder 置換 + observability)
- `plans/fix-image-generation-logging.md` — このファイル

## 検証

- 手動: `http://localhost:5173/chat/<session>` で「メキシコ旅行のおすすめwikiを画像付きで」を依頼
  - **Before**: 9 placeholder のうち 0〜数枚しか表示されない (実は disk に保存はされている)
  - **After**: 9/9 表示。ログ末尾に `image batch done succeeded=9 failed=0 total=9 elapsedMs=29290`
- `yarn typecheck` / `yarn lint` / `yarn format` 通過

## 既知の制約 / フォローアップ候補

- Gemini SDK 自体の per-call timeout は未設定 (拒否されたら即 throw が来る前提)。万一サーバが本当に Gemini 待ちで 20 分弱固まると、ブリッジ側の 20 分でタイムアウトする。実害は低いが、必要なら別途 `generateGeminiImageContent` 内に timeout を入れる。
- `image-store.ts` の `saveImage` 戻り値は string だが、最初のリビジョンで `await` 漏れに気づきにくかった。型推論で Promise 返しの誤代入を弾くため、`generateImageFile` 内で必ず `await` するよう統一済み。
