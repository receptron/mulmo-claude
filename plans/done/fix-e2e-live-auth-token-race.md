# fix: E2E Live (no LLM) の断続的401フレーク (#2069)

## 症状

スケジュール実行 **E2E Live (no LLM)** が断続的に失敗。日ごとに別スペック
（mulmo-script-edit / wiki / happy-tour / wiki-piped-links …）が落ちる。7/05 頃から継続。
失敗時ページに `[Error] Server error 401: {"error":"unauthorized"}`。

## 根本原因

CI (`.github/workflows/e2e_live_no_llm.yaml`) は `yarn dev`（Vite dev モード）を
`MULMOCLAUDE_AUTH_TOKEN` を**固定せず**起動している。

- Vite `transformIndexHtml`（`vite.config.ts` `readDevToken()`）は env が無いと
  `.session-token` を **index.html 配信のたびに読んで** `<meta name="mulmoclaude-auth">`
  に注入する。
- バックエンドが `.session-token` を書く前、または `yarn dev` 再起動でトークンが
  再生成された後にページが配信されると、**空トークン**が meta に入る。
- SPA は空トークンで起動 → `Authorization` ヘッダ無しで認証対象の `/api/*`
  （bearer 保護対象。`/api/files/*` や view-token 等の除外は別）が **401**
  （roles / skills / `/api/agent`）。presentMulmoScript が動かず、
  `mulmo-script-generate-movie-button` が出ずタイムアウト（line 67）。

CI 負荷でレースの勝敗が変わり、落ちるスペックが日替わりになる。

## 検証（稼働中サーバへ read-only curl）

- 配信 meta トークン 64桁 → authed `/api/health` = 200
- 空/無トークン → 401（＝レース時に meta が空になると全API 401、失敗と一致）

## 修正

dev サーバ起動の直前に、ランダムな 64hex トークンを生成して `$GITHUB_ENV` に固定:

```yaml
- name: Pin auth token for the dev server
  run: echo "MULMOCLAUDE_AUTH_TOKEN=$(openssl rand -hex 32)" >> "$GITHUB_ENV"
```

これで:
- Vite `readDevToken()` は env の分岐で即トークンを返す（**ファイルを読まない**）。
- バックエンドは `env.authTokenOverride`（同 env）でトークンをピン留めして enforce。
- 両者が同一トークンを決定的に共有し、ファイル読みレース／再生成ズレが消える。

fresh-boot 用 `e2e-live/fixtures/isolated-dev-server.ts` が既に採っている手法と同じ。

## 検証（CI）

本 PR は workflow ファイル自体を変更するため、`pull_request.paths` により
**E2E Live (no LLM) が PR 上で実行**され、修正が実地検証される。
