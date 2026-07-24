# docs: MCP の Docker stdio opt-in と env の渡し方を追記 (#2071)

## 背景

カスタム stdio MCP（`npx` 等）を **Docker モードで動かす方法**と**環境変数の渡し方**が、
ユーザ向けドキュメントから見つけられない。実装は既にあるのに記載が無い/古い。

- `docs/mcp-sandbox.md`（Settings UI の "Learn more" リンク先）は「Docker では stdio 不可」と
  断定し、`hostExecInDocker: true`（#1421 Phase B、ホスト側 stdio↔HTTP ゲートウェイ）に未言及。
- `README.md` / `README.ja.md` の MCP 節に `env` と `hostExecInDocker` の説明が無い。

実装の裏付け:
- `src/config/mcpTypes.ts` — `StdioSpec.env`, `StdioSpec.hostExecInDocker`
- `server/agent/config.ts` `prepareUserServers` — Docker 時は stdio を drop、`hostExecInDocker`
  なら `startStdioHttpShim` でホスト起動し http へ書換
- `server/agent/stdioHttpShim.ts` — `supergateway` で `env: { ...process.env, ...spec.env }`
- `src/utils/mcp/interpolateSpec.ts` — `${VAR}` はカタログ install 時のみ解決（保存はリテラル）

## 変更

- `docs/mcp-sandbox.md`
  - 冒頭の断定を「既定で drop、opt-in あり」に訂正
  - 「Running a stdio MCP under Docker anyway (`hostExecInDocker`)」節を追加（ホスト側
    ゲートウェイの仕組み・リスク・フォールバック）
  - 「Passing environment variables」節を追加（`env` の届き方、リテラル/平文 0600 注意）
  - 「What MulmoClaude does in practice」に例外、「Workarounds」に opt-in を反映
- `README.md` および全翻訳（`README.{ja,de,es,fr,ko,pt-BR,zh}.md`）
  - Stdio の説明を Docker 挙動込みで正確化（既定 drop ＋ `hostExecInDocker`）
  - `env`（平文/0600）を追記
  - IMAP を想定した stdio + env + `hostExecInDocker` の例を追加

## 検証

- 見出しスラッグとアンカーリンク一致、コードフェンス均衡を確認。
- `yarn format`/`yarn lint` は markdown 非対象、docs 専用 CI linter は無し。
