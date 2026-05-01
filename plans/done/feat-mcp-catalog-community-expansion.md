# MCP catalog — community expansion (Phase 5+ of #823)

## User prompt

> oauth系、gmailとかgoogle カレンダーとか使えると良いね。でもこれってきちんと使うには審査必要だから面倒？
> あー、その楽な方で実装してほしい。community MCP serverでできるのひととおりサポートできるとよいね
> はい。一気に、１つのPRで。ただし１回目のcommitでPRをつくって、そのPRにつんでいく

→ "BYO OAuth credentials + community MCP server" 路線で catalog を一気に拡張。PR は 1 本、phase ごとにコミットを積む。

## Strategy: BYO credentials, no proprietary OAuth verification

公式 OAuth verification（Google CASA audit など）は restricted scope だと数ヶ月+$$$。
local-first MulmoClaude は **ユーザが自分の OAuth client を発行 → catalog 経由でトークンを貼る** 方式が現実的:

- 審査責任は community MCP server 側（既に通っている / そもそも client-side 動作）
- catalog 側は entry 定義 + setupGuideUrl + secret field の提供のみ
- ユーザは GCP コンソール等で 1 度だけ token を発行する

既存 catalog のパターン（Notion / Slack / Google Maps）と同じ形を踏襲。

## Phases (commits on a single PR)

| Phase | 内容 | entries |
|---|---|---|
| A | Apple Native アプリ束 (macOS only, no creds) | 1 |
| B | Google OAuth: Gmail / Calendar / Drive | 3 |
| C | Token 系: GitHub PAT / Linear | 2 |
| D | その他: Spotify / YouTube transcript | 2 |

合計 **8 entries** 追加。

## Per-entry checklist

各 entry で:

1. `src/config/mcpCatalog.ts` に `McpCatalogEntry` を追加
   - `id` / `displayName` / `description` / `audience` / `upstreamUrl` / `setupGuideUrl` / `spec` / `configSchema` / `riskLevel`
   - 既存パターンを踏襲（Notion / Slack 参照）
2. **i18n 8 ロケール** lockstep 更新（CLAUDE.md ルール）
   - `displayName`、`description`
   - 各 configSchema field の `label` + `help`
   - キー順を全ロケール一致させる
3. **community package は best-effort** — reviewer に PR 上で pin 確認をお願いするコメント
4. リスク判定: low (no auth) / medium (token, scoped) / high (full account access)

## Package candidates

| Phase | id | package (best-effort) | env / config |
|---|---|---|---|
| A | `apple-native` | `apple-mcp` | (none, AppleScript) |
| B | `gmail` | community Gmail MCP（要 reviewer pin） | OAuth credentials JSON path |
| B | `google-calendar` | community GCal MCP | OAuth credentials JSON path |
| B | `google-drive` | `@modelcontextprotocol/server-gdrive` | OAuth credentials JSON path |
| C | `github` | `@modelcontextprotocol/server-github` | `GITHUB_PERSONAL_ACCESS_TOKEN` |
| C | `linear` | community Linear MCP | `LINEAR_API_KEY` |
| D | `spotify` | community Spotify MCP | client ID/secret |
| D | `youtube-transcript` | `@anaisbetts/mcp-youtube` 等 | (none) |

## Out of scope

- 個別 Apple アプリへの分割（Reminders だけ等の個別 entry）— 1 bundle で先行、需要があれば後続 PR で split
- OAuth flow 自体の埋め込み UI — token の発行は手動、catalog は token を受け取るのみ
- Calendar/Email の verified app 化 — 上記の通り audit コスト次第で別議論

## Refs

- 上位 issue: #823（umbrella、close せず継続）
- 既存 catalog: #825 (Phase 1)、#852 (Phase 2)
- 直近 follow-up: #860 (Notion env var fix)
