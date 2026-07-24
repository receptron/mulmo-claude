# refactor(#2483): known-duplicates 表の残党 sweep

`docs/shared-utils.md` の "Known duplicates" 表を現行 `main` と突き合わせ、**実在の残党**を fold し、**表が古くなっている行**を現状に合わせる。

## 現行 main での検証結果(entry ごと)

| # | Entry | 現況 | 判断 |
|---|---|---|---|
| 1a | `errorMessage` — `packages/plugins/spotify-plugin/src/client.ts:229` | **残存**。`err instanceof Error ? err.message : String(err)` の素朴コピー | fold → `@mulmoclaude/common` |
| 1b | `errorMessage` — `packages/plugins/html-plugin/src/vue/View.vue:72` | **残存**。同じ素朴コピー | fold → `@mulmoclaude/common` |
| 1c | `errorMessage(error: SpotifyClientError)` — `spotify-plugin/src/profile.ts:113` | **コピーではない**。`SpotifyClientError` の kind ごとのドメイン整形 (switch)。同名なだけ | `formatClientError` にリネーム(将来の誤 grep 防止)。fold しない |
| 2a | `escapeHtml` — `packages/plugins/spotify-plugin/src/index.ts:620` | **残存**(chained `.replace`) | fold → `@mulmoclaude/common` |
| 2b | `escapeHtml` — `packages/markdown-utils/src/markdown/mermaidExtension.ts:28` | **残存**(chained `.replace`) | fold → `@mulmoclaude/common`(下記の設計判断) |
| 2c | `escapeHtml` — `packages/core/src/wiki/render.ts:14` | 現 canonical(switch-map) | `@mulmoclaude/common` へ移し、`@mulmoclaude/core/wiki` は re-export(既存 import 面は不変) |
| 2d | inline `escape` arrow — `server/api/routes/runtime-plugin.ts:170` | **残存**。issue は「見当たらない」としているが、`escapeHtml` ではなく `escape` という名前で実在する(issue の記載のほうが誤り) | fold → `@mulmoclaude/core/wiki` |
| 3 | `ONE_DAY_MS` — `server/workspace/wiki-pages/snapshot.ts:31` | **残存**。`const ONE_DAY_MS = 24 * 60 * 60 * 1000;` | `server/utils/time.ts` から import |
| 4 | 表 `isRecord` 行「2コピーが配列を通す」 | **stale**。`server/plugins/runtime-loader.ts` は canonical を import 済み、`spotify-plugin/src/normalize.ts` も `!Array.isArray` あり。現存 12 定義すべて挙動同一 | 表のみ更新(コード変更なし) |
| 5 | 表 `writeFileAtomic` 行「3コピー乖離 / `opts.mode` 無視」 | **stale**。#2399 で解消済み。現存は `packages/core/src/files/atomic.ts` の canonical と、`@mulmobridge/chat-service` の意図的ミラー1本のみ | 表のみ更新(コード変更なし) |
| 6 | 表 `escapeHtml` 行の「inline arrow in runtime-plugin.ts」 | **表のほうが正しい**(2d 参照)。issue の「削除」指示は誤り | fold した上で行を更新 |

## 設計判断: `escapeHtml` の canonical を `@mulmoclaude/common` に置く

issue の選択肢 (a) を採る。

- `@mulmoclaude/markdown-utils` は `@mulmoclaude/core` が依存する leaf なので `@mulmoclaude/core/wiki` は import できない(循環)。
- `@mulmoclaude/common` は zero-dep / browser-safe leaf で、どの tier からも downhill に import できる。`errorMessage` (#2400) / `toUtcIsoDate` (#2480) と同じ形。
- `@mulmoclaude/core/wiki` は `escapeHtml` を re-export し続けるので、既存の 4 consumer(collection-plugin の Vue、host の `wikiEmbeds*`、spreadsheet View)は無変更。

### ビルド順の副作用

`markdown-utils` が `@mulmoclaude/common` に依存すると、root `package.json` の `build:packages` / `build:packages:dev` の **tier 1 が並列**(`protocol` / `web-push` / `webhook-runtime` / `task-scheduler` / `common` / `markdown-utils`)なので、cold build で `common/dist` 未生成のまま `markdown-utils` の `tsc` が走るレースが発生する。

対処: `@mulmoclaude/common` を **tier 0**(単独・先頭)に切り出し、残りを従来どおり並列にする。これは「uphill import を隠すための tier 追加」ではなく、`common` が真の最下層 leaf であることを build 順に反映させるだけの変更。`docs/build-orchestration.md` の tier 一覧も現状(5 tier)に合わせて更新する。

## 意図的に残すコピー

- `packages/chat-service/src/atomic-write.ts` の `writeFileAtomic` — `@mulmobridge/chat-service` は bridge tier の published leaf で、`@mulmoclaude/core/files` を import すると uphill になる。`fs` に触るので `@mulmoclaude/common`(browser-safe leaf)にも置けない。**KEEP** し、既存コメントに理由を明記して表にも記載する。
- `isRecord` の 11 コピー — 挙動同一。バンドル境界をまたぐ 3 行の型ガードなので今回は触らず、表を現状に更新するのみ。

## 手順

1. `plans/` にこのファイルを追加 (`docs(plan):`)
2. `@mulmoclaude/common` に `escapeHtml` を追加 + `packages/common/test/test_escape_html.ts`(switch-map と chained `.replace` の出力同値をテストで固定してから置換)
3. `packages/core/src/wiki/render.ts` を re-export 化
4. `markdown-utils` / `spotify-plugin` / `html-plugin` に `@mulmoclaude/common` 依存を追加し、ローカルコピーを削除
5. `server/api/routes/runtime-plugin.ts` の inline `escape` を `@mulmoclaude/core/wiki` の `escapeHtml` に差し替え
6. `snapshot.ts` の `ONE_DAY_MS` を `server/utils/time.ts` から import
7. `spotify-plugin/src/profile.ts` の `errorMessage` を `formatClientError` にリネーム
8. root `package.json` の build tier 0 切り出し + `docs/build-orchestration.md` 更新
9. `docs/shared-utils.md` の Known duplicates 表を現状に更新(catalog ルール6)
10. `yarn format` / `yarn lint` / `yarn typecheck` / `yarn build` / 関連テスト

## 検証

- `packages/common` の新テストで `escapeHtml` の 5 文字マップ・多重 `&`・空文字を固定
- 既存の wiki render テスト / markdown-utils テスト / host テストが green
- fold 前後で出力が変わらないこと(2 綴りの同値性をテストで先に固定してから置換)

## バージョン方針

- `@mulmoclaude/*` は publish 時まで bump しない(CLAUDE.md / memory)。
- `@mulmobridge/*` には runtime export を追加しないので smoke `drift` gate は無影響。
- `node scripts/mulmoclaude/launcherSync.mjs` は green のまま。
- 新規に宣言した `@mulmoclaude/common` の range はすべて `^1.1.0` — 既存 consumer(core / x-plugin / markdown-plugin / accounting-plugin / mulmoscript-plugin / launcher)と同一。

## 実施結果

- ビルド順レースは机上論ではなく実測: `packages/common/dist` を消すと `yarn workspace @mulmoclaude/markdown-utils run build` が exit 2 で落ちる。tier 0 切り出し後は cold build が通ることを確認済み。
- `escapeHtml` のテストは変異検査済み — `["'", "&#39;"]` を `["'", "'"]` に壊すと 7 件中 4 件が red になり、戻すと green。
- `server/build/dispatcher.mjs` は `packages/core` を触ったため再生成が必要(CI の `git diff --exit-code` gate 対象)。`yarn build` で更新されたものをコミット済み。
