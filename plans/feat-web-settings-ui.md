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

#125 の調査結果を踏まえると、以下の配管変更が必要:

1. **`buildMcpConfig` の拡張** — `configs/mcp.json` を読み込み、自家 `mulmoclaude` サーバと**マージ** して返す:
   ```ts
   {
     mcpServers: {
       mulmoclaude: { ... },      // 既存
       ...userDefinedServers,     // configs/mcp.json からマージ
     }
   }
   ```

2. **`buildCliArgs#allowedTools` の動的化** — 現状は `mcp__mulmoclaude__<plugin>` だけ。ユーザ定義サーバ `foo` の全ツールを通すには `mcp__foo` (Claude CLI のサーバ単位ワイルドカード) を追加する方針で検証 (Claude CLI 側で全ツール許可の書式があるか確認)。無理ならサーバに接続して `tools/list` を取得 → 名前列挙。

3. **`MCP_PLUGIN_NAMES` の動的化** — `getActivePlugins` が静的 Set でフィルタしているが、ユーザ定義サーバは role の `availablePlugins` に紐づかない別経路で素通しするのが自然。具体的には:
   - `buildMcpConfig` には常に user servers を含める (role に依存しない)
   - `allowedTools` にも常に user servers のワイルドカードを含める (role に依存しない)
   - role の `availablePlugins` は既存プラグイン (GUI 付き) の選択用途に限定する

4. **UI (SettingsModal の MCP タブ)**:
   - サーバ一覧 (id, name, type, enabled toggle)
   - "Add Server" ボタン → フォームダイアログ:
     - **Name** (required, slug 化)
     - **Type**: `stdio` / `http` ラジオ
     - stdio の場合: command, args (行ごと), env (key/value の動的追加)
     - http の場合: URL
   - 既存サーバの編集 / 削除
   - 保存時にサーバ側で `mcp.json` を書き換え (既存フォーマット準拠)
   - インポート/エクスポート (JSON ファイル添付 / ダウンロード) — 他の Claude CLI 設定との相互運用

5. **セキュリティ検討**:
   - ユーザが任意の `command` を入れて子プロセスを起動できる → サーバはローカル (localhost バインド) なので CSRF / オリジンガードで守られているが、 Docker サンドボックス環境での分離方針を明記
   - env に API key を書く人が出る → ファイルパーミッション (0600) で保存、UI 上はマスク表示

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
