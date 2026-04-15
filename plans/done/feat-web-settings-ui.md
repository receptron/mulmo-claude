# Plan: Web-based Settings UI with auto-reload

Issue: #187
Related: #171 (Gmail / Google Calendar MCP), #125 (user-defined MCP servers)

## Problem

MulmoClaude の設定 (allowedTools、MCP サーバ、将来の role デフォルト等) は**すべてソースコードにハードコード** されており、ユーザがアプリ稼働中に変更する経路がない。具体的には:

- `server/agent/config.ts#BASE_ALLOWED_TOOLS` — リテラル配列
- `server/agent/config.ts#buildMcpConfig` — `{ mulmoclaude: ... }` の 1 サーバしか出力しない
- `server/plugin-names.ts#MCP_PLUGIN_NAMES` — 静的 Set

結果:
- Claude Code 組み込みの Gmail / Calendar MCP (#171) が使えない
- 外部 MCP サーバ (`server-filesystem`, `server-github`, …) を追加できない (#125)

## Goal

**Web UI から JSON を書かずに設定を追加でき、サーバ再起動なしで反映される** 仕組みを導入する。

設計方針:
- **毎回リロード**: agent 呼び出しごとに `configs/` を読み直すので、保存ボタンを押した直後のメッセージから新設定が効く
- **JSON 直編集を避ける**: フォーム UI でユーザに入力させ、サーバ側で正規の MCP フォーマットに整形して保存
- **標準フォーマットとの互換性**: MCP 設定は Claude CLI の `--mcp-config` 形式 (`{ "mcpServers": { ... } }`) と同じにする — 書き出したファイルをそのまま `claude` 単体で使えるし、他の Claude CLI 設定と持ち運べる

## Directory structure

```
<workspace>/configs/
  settings.json    ← アプリ全般の設定
  mcp.json         ← 標準 Claude CLI MCP サーバ設定フォーマット
```

`initWorkspace()` で `configs/` と各ファイルを (なければ) 空テンプレートで作成。

### `settings.json`

```json
{
  "extraAllowedTools": [
    "mcp__claude_ai_Gmail",
    "mcp__claude_ai_Google_Calendar"
  ]
}
```

### `mcp.json` (Phase 2)

```json
{
  "mcpServers": {
    "my-filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
      "env": {}
    },
    "my-remote": {
      "type": "http",
      "url": "https://example.com/mcp"
    }
  }
}
```

Claude CLI の公式フォーマットそのまま。ユーザは UI でフォームを埋めるだけ、サーバは JSON を組み立てて書き出す。

## Architectural changes

### Phase 1 — 土台 + extraAllowedTools

**最小で完結するスライス**。MCP 拡張はせず、既存 `BASE_ALLOWED_TOOLS` にユーザ指定ツールをマージするだけ。

変更ファイル:
- `server/workspace.ts` — `initWorkspace` で `configs/` 作成
- `server/config.ts` (新規) — `loadSettings()` / `saveSettings(cfg)` + typed guard (zod は導入しない)
- `server/routes/config.ts` (新規) — `GET /api/config` と `PUT /api/config/settings`
- `server/index.ts` — ルート wire up
- `server/agent/config.ts#buildCliArgs` — 引数に `extraAllowedTools: string[]` を追加し、`allowedTools = [...BASE, ...extra, ...mcpToolNames]` に
- `server/agent.ts#runAgent` — `loadSettings()` を呼んで `buildCliArgs` に渡す
- `src/components/SettingsModal.vue` (新規) — UI
- `src/App.vue` — サイドバーに ⚙ ボタン + モーダルを open

スキーマ:

```ts
// server/config.ts
export interface AppSettings {
  extraAllowedTools: string[];
}
const DEFAULT: AppSettings = { extraAllowedTools: [] };
export function loadSettings(): AppSettings { /* fs.readFileSync, typed guard, fallback to DEFAULT */ }
export function saveSettings(cfg: AppSettings): void { /* validate + atomic write */ }
```

テスト:
- Unit: `loadSettings` / `saveSettings` の happy / missing file / malformed / atomic write
- Route: `GET /api/config` / `PUT /api/config/settings` の validate + permission
- E2E: Settings モーダルを開く → ツール名を追加 → 保存 → モーダル閉じて開き直して永続化を確認

README に新セクション "Configuring Additional Tools" を追加、#171 の Gmail/Calendar 例を書く。

### Phase 2 — MCP サーバ管理 UI

#125 の調査結果と Docker モードの制約を踏まえ、Phase 2 を **2a / 2b / 2c** に分割。2a が最も価値が高く、Docker でも動くのでここから着地する。

#### Docker モードでの制約まとめ

現状の `Dockerfile.sandbox` は `node:22-slim + claude-code + tsx` の最小構成。ユーザ定義 MCP サーバがどう動くかの事前予測:

| 種類 | Docker モード | 理由 |
|---|---|---|
| **HTTP/remote** (Gmail, Calendar, `https://...`) | ✅ 動く | network egress 有り、OAuth credentials は `~/.claude.json` マウントで引き継ぎ |
| **HTTP/localhost** (`http://localhost:N`) | ⚠️ 要 URL 書き換え | container からは host の localhost に届かない → `host.docker.internal` に自動変換 |
| **stdio/`npx ...`** | △ 条件付き | container に `node`, `npx`, `tsx` はあるが毎回 npm download (遅 + network 必須) |
| **stdio/`node ./script.js`** | ❌ パス解決失敗 | host 絶対パスは container 内に存在しない。workspace 内なら `/home/node/mulmoclaude/...` に書き換え要 |
| **stdio/`python3`, `go`, 任意バイナリ** | ❌ 動かない | image に含まれない |

#### Phase 2a — HTTP MCP のみサポート (最優先)

**スコープ**: `type: "http"` のサーバ追加のみ受け付ける。stdio は次フェーズ。

変更点:

1. **`buildMcpConfig` の拡張** — `configs/mcp.json` を読み、自家 `mulmoclaude` サーバと HTTP サーバのみマージ:
   ```ts
   {
     mcpServers: {
       mulmoclaude: { ... },      // 既存
       ...userHttpServers,        // configs/mcp.json の http サーバのみ
     }
   }
   ```

2. **localhost URL の自動書き換え** — Docker モード時 `http://localhost:N` / `http://127.0.0.1:N` → `http://host.docker.internal:N` に変換する純関数を `server/agent/config.ts` に追加、unit test も書く。

3. **`buildCliArgs#allowedTools` の動的化** — `mcp__<user-server>` のワイルドカード書式が Claude CLI で有効か検証。有効なら使う、無理なら接続して `tools/list` 取得 → 名前列挙。

4. **`MCP_PLUGIN_NAMES` の動的化** — user HTTP サーバは role の `availablePlugins` に紐づかない別経路で素通し:
   - `buildMcpConfig` には常に user HTTP servers を含める (role 非依存)
   - `allowedTools` にも常に user HTTP servers のワイルドカードを含める
   - role の `availablePlugins` は既存 GUI プラグインの選択用途に限定

5. **UI (SettingsModal の MCP タブ)**:
   - サーバ一覧 (id, name, url, enabled toggle)
   - "Add HTTP Server" ボタン → フォーム:
     - **Name** (required, slug 化)
     - **URL** (required, https: or http: 検証)
     - **Headers** (key/value の動的追加, API key 用, マスク表示)
   - 編集 / 削除
   - 保存時にサーバ側で `mcp.json` を書き換え (Claude CLI フォーマット準拠)

6. **セキュリティ**:
   - `headers` 内の secret は UI でマスク、`mcp.json` はパーミッション `0600` で保存
   - オリジンガード (`requireSameOrigin`) は既存のものが自動適用

**完了条件**: Gmail / Google Calendar / Brave Search / GitHub MCP (HTTP) が Web UI から追加でき、Docker モード・ネイティブモード双方で動くことを確認。

#### Phase 2b — stdio MCP サポート (Docker 配慮)

**前提**: Phase 2a が先に入っていること。

変更点:

1. **`command` allowlist** — 安全のため `command` は `npx` / `node` / `tsx` のみに制限 (UI の radio セレクタ)
2. **args の workspace パス書き換え** — workspace 内のパス (`workspace/tools/my.js`) → container パス (`/home/node/mulmoclaude/tools/my.js`) に自動変換する純関数を追加
3. **UI 警告** — Docker モード有効時、workspace 外のパスが含まれる stdio サーバに "Docker 内では動かない可能性" バッジを出す
4. **env マスク表示** — API key 等を入力する env key/value フォームで value を password 表示、`mcp.json` に保存

**完了条件**: `@modelcontextprotocol/server-filesystem` を workspace 配下のパスで動かす golden path が Docker モードで通る。

#### Phase 2c — sandbox image 拡張 (#162 にオフロード)

Python, git, jq などが欲しい場合は `Dockerfile.sandbox` を拡張する作業が必要。スコープが広いので **この plan では扱わず #162 側で追跡**。Phase 2b と独立して進行可。

#### インポート/エクスポート (Phase 2d — 余力あれば)

- 他の Claude CLI 設定 (`~/.claude.json` の `mcpServers` セクション) からのインポート
- `mcp.json` ダウンロード

### Phase 3 — 他の設定項目 (将来)

- デフォルト role
- ログレベル / ファイル出力先 (#91 との連携)
- テレメトリ opt-in

## API design

| Method | Path | Body | 返値 |
|---|---|---|---|
| `GET` | `/api/config` | — | `{ settings: AppSettings, mcp: McpConfig }` |
| `PUT` | `/api/config/settings` | `AppSettings` | `{ settings }` |
| `PUT` | `/api/config/mcp` | `McpConfig` (Phase 2) | `{ mcp }` |

CSRF guard (`requireSameOrigin`) は既存のものがそのまま適用される。

## Phase 1 — 実装ステップ

1. `server/config.ts` + unit test
2. `server/workspace.ts#initWorkspace` に `configs/` 作成を追加
3. `server/routes/config.ts` + route test (typed Express generics)
4. `server/index.ts` で route を wire
5. `server/agent/config.ts#buildCliArgs` の引数に `extraAllowedTools` を追加 — 既存テストが壊れないように default 空配列
6. `server/agent.ts#runAgent` で `loadSettings()` を呼ぶ
7. `src/components/SettingsModal.vue` — テキストエリア + save
8. `src/App.vue` — ⚙ ボタン追加 + open state
9. E2E テスト (`e2e/tests/settings.spec.ts`)
10. README 更新 ("Configuring Additional Tools" セクション, Gmail/Calendar 例)

各ステップで `yarn format` / `yarn lint` / `yarn typecheck` / `yarn test` / `yarn test:e2e` を通す。

## Out of scope (Phase 1)

- Phase 2 以降の全項目 (MCP サーバ管理、role デフォルト、テレメトリ)
- 設定の import/export
- 複数ワークスペース対応 (現状は `~/mulmoclaude/` 固定)

## 完了条件 (Phase 1)

- [x] Issue #187 作成
- [x] Plan 作成 (this file)
- [ ] Phase 1 の実装ブランチ作成
- [ ] Phase 1 PR マージ後、#187 コメントで Phase 2 作業開始を宣言
- [ ] Phase 2 の実装は別 PR で (この plan の Phase 2 セクションが設計メモとして参照される)
