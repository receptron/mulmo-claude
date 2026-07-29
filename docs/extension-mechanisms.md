# MulmoClaude 拡張機構リファレンス

MulmoClaude が LLM (Claude Agent SDK) に対して提供する **拡張・連携の経路** は7種類ある。
それぞれ「どこに置くか」「LLM がどう発見するか」「どうやって呼び出すか」が違うので、
新しい機能を追加するときに最初に決めるのは「どのレイヤーで作るか」になる。

このドキュメントは:

- 7つの機構を一覧
- どの機能を持つか (`tools` / `system prompt` / `MCP` / `role gate` / etc.) をマトリクス化
- ソース上の実装ポイント (file:line 直リンク) を埋め込み
- 「どれを選ぶか」の判断ガイド

を提供する。アーキ全体像は [`docs/developer.md`](developer.md) も併読。

---

## 1. 7つの機構 — クイック紹介

| # | 機構 | 配布形態 | 例 |
|---|---|---|---|
| 1 | **Built-in 静的 GUI plugin** | アプリ本体にバンドル | `accounting`, `presentHtml`, `chart`, `wiki` |
| 2 | **Built-in 静的 MCP-only tool** | アプリ本体にバンドル | `notify`, `readXPost`, `searchX` |
| 3 | **Runtime plugin (preset / user-installed)** | npm package | `@mulmoclaude/spotify-plugin`, `@mulmoclaude/bookmarks-plugin` |
| 4 | **External MCP server** | 別プロセス (stdio / HTTP) | GitHub, Linear, Spotify-MCP, YouTube transcript |
| 5 | **Skill** | markdown ファイル | `~/.claude/skills/<name>/SKILL.md` |
| 6 | **Role** | TypeScript / markdown | `general`, `accounting`, `cookingCoach` |
| 7 | **Bridge (messenger)** | 別プロセス (npm package) | Telegram, Slack, Discord, LINE |

---

## 2. ケイパビリティ・マトリクス

各機構が「LLM 呼び出し系」「設定・配布系」「スコープ系」のどの軸を持つか。

| 機構 | 標準提供 | 設定で追加可 | system prompt 注入 | LLM が tool 呼出 | MCP 経由公開 | Role でゲート | 永続スコープ |
|---|---|---|---|---|---|---|---|
| **1. Built-in GUI plugin** | ✅ アプリにバンドル | ❌ コード変更要 | ✅ `### <name>` ブロック | ✅ | ✅ in-process | ✅ `availablePlugins` | アプリ |
| **2. Built-in MCP-only tool** | ✅ アプリにバンドル | ❌ コード変更要 | ✅ | ✅ | ✅ in-process | ✅ `availablePlugins` | アプリ |
| **3. Runtime plugin** | △ preset 数本 | ✅ npm install | ✅ 自動 | ✅ | ✅ in-process | ❌ **常時 ON** | アプリ + workspace files |
| **4. External MCP server** | ❌ | ✅ catalog or `mcp.json` | △ tool 説明のみ | ✅ | ✅ **別 server-id** | ❌ | サーバ側 + tool ENV |
| **5. Skill** | ❌ | ✅ 会話 / `manageSkills` で作成 | ✅ frontmatter 経由 | ❌ **tool ではない** | ❌ | ❌ | `~/.claude/skills/` + workspace |
| **6. Role** | ✅ 10種 | ✅ `manageRoles` で追加 | ✅ persona 全体 | ❌ | ❌ | — *(role 自体)* | コード + `<workspace>/config/roles/` |
| **7. Bridge** | ❌ | ✅ 別プロセス起動 | ❌ | ❌ | ❌ | ❌ | bridge プロセス側 |

凡例:
- **標準提供**: `yarn install` 直後、追加設定なしで使えるか
- **system prompt 注入**: `buildSystemPrompt` (server/agent/prompt.ts) が実行時に prompt に書き込むか
- **LLM が tool 呼出**: LLM が `tools/call` で起動できるか (= プログラム連携可能か)
- **MCP 経由公開**: in-process MCP サーバ `mulmoclaude` のリストに乗るか / 別 server-id で乗るか
- **Role でゲート**: `role.availablePlugins` の対象になるか

---

## 3. 各機構の実装

### 3.1 Built-in 静的 GUI plugin

**何**: View/Preview Vue コンポーネント + サーバ tool 定義 + ワークスペースディレクトリを **co-locate** した拡張。
canvas 上で結果を可視化したい場合の第一選択。

**例**:
- `src/plugins/accounting/` — 仕訳入力、損益、貸借
- `src/plugins/presentHtml/` — その場 HTML プレビュー
- `src/plugins/chart/`, `src/plugins/spreadsheet/`, `src/plugins/markdown/`
- `src/plugins/manageRoles/`, `src/plugins/manageSkills/`

**追加方法**:

1. `src/plugins/<name>/` に以下を置く
   - `meta.ts` — `definePluginMeta({ toolName, apiRoutesKey, apiRoutes, workspaceDirs?, staticChannels? })`
   - `definition.ts` — MCP `ToolDefinition`
   - `index.ts` — `PluginRegistration` (View/Preview を `wrapWithScope` でラップ)
   - `View.vue` / `Preview.vue`
2. **3 つのバレル**に登録:
   - `src/plugins/metas.ts` の `BUILT_IN_PLUGIN_METAS` に append
   - `src/plugins/index.ts` の `BUILT_IN_PLUGINS` に append
   - `src/plugins/server.ts` の `BUILT_IN_SERVER_BINDINGS` に append
3. ルートを `server/api/routes/<name>.ts` に追加 (plugin が endpoint を持つ場合)

**ソース実装**:

- 集約: `src/plugins/metas.ts` (`defineHostAggregate`)
- 静的 binding 一覧: `src/plugins/server.ts` の `BUILT_IN_SERVER_BINDINGS`
- LLM 露出: `server/agent/activeTools.ts:82-94` — `PLUGIN_DEFS` を `role.availablePlugins` でフィルタ
- 外部 endpoint: `TOOL_ENDPOINTS[def.name]` (`server/agent/plugin-names.ts`)
- Role ゲート: `server/agent/activeTools.ts:78` — `const allowed = new Set<string>(role.availablePlugins)`

```ts
// server/agent/activeTools.ts:82
for (const def of PLUGIN_DEFS) {
  if (!allowed.has(def.name) || seen.has(def.name)) continue;
  out.push({
    name: def.name,
    fullName: fullNameFor(def.name),     // mcp__mulmoclaude__<name>
    description: def.description,
    prompt: promptFor(def),
    endpoint: TOOL_ENDPOINTS[def.name],  // /api/<route>
    source: "static-gui",
  });
}
```

---

### 3.2 Built-in 静的 MCP-only tool

**何**: GUI を持たず、サーバ側ロジックだけで完結する MCP tool。

**例**: `server/agent/mcp-tools/notify.ts`, `server/agent/mcp-tools/x.ts` (`readXPost` / `searchX`)

**ENV ゲート**: 個別 tool 側が `requiredEnv: [...]` を宣言した場合のみ、`isMcpToolEnabled` (`server/agent/mcp-tools/index.ts`) がその ENV var を見て出し入れする。現状 ENV ゲートされているのは `x` (`readXPost` / `searchX` — `X_BEARER_TOKEN` 必須) のみ。`notify` は `requiredEnv` を持たないので常に有効。

**ソース実装**:

- 一覧: `server/agent/mcp-tools/index.ts` の `mcpTools`
- Gating: `isMcpToolEnabled(tool)` (同ファイル)
- LLM 露出: `server/agent/activeTools.ts:95-106`

```ts
// server/agent/activeTools.ts:95
for (const tool of mcpTools) {
  const toolName = tool.definition.name;
  if (!allowed.has(toolName) || seen.has(toolName) || !isMcpToolEnabled(tool)) continue;
  out.push({
    name: toolName,
    fullName: fullNameFor(toolName),
    description: tool.definition.description,
    prompt: tool.prompt,
    // 静的 MCP tool は内部 dispatch なので endpoint なし
    source: "static-mcp",
  });
}
```

---

### 3.3 Runtime plugin (preset / user-installed)

**何**: npm パッケージとして配布される plugin。
boot 時に `node_modules/<pkg>/` から `import()` して登録される。
**全 role で常時 ON** — `availablePlugins` に書く必要なし。

**例 (preset)**:
- `@mulmoclaude/spotify-plugin` — `manageSpotify` (OAuth + listening data + player + search)
- `@mulmoclaude/recipe-book-plugin` — `manageRecipes`
- `@mulmoclaude/debug-plugin` — `/debug` ページ

**Preset と user-installed の違い**:
- preset: `server/plugins/preset-list.ts` の `PRESET_PLUGINS` に列挙、`yarn install` で自動入る
- user-installed: `<workspace>/plugins/` の workspace ledger 経由 (`/api/plugins/runtime/install`)

**ソース実装**:

- Preset 一覧: `server/plugins/preset-list.ts:29` — `PRESET_PLUGINS`
- 登録: `server/plugins/runtime-registry.ts:43` — `registerRuntimePlugins`
- 取得: `server/plugins/runtime-registry.ts:91` — `getRuntimePlugins`
- LLM 露出 (常時 ON): `server/agent/activeTools.ts:108-125`
- Dispatch route: `server/api/routes/runtime-plugin.ts:68` — `POST /api/plugins/runtime/:pkg/dispatch`

```ts
// server/agent/activeTools.ts:108 — runtime は role gate を通さず always-on
for (const plugin of getRuntimePlugins()) {
  const def = plugin.definition;
  if (seen.has(def.name)) continue;
  out.push({
    name: def.name,
    fullName: fullNameFor(def.name),
    description: def.description,
    prompt: promptFor(def),
    endpoint: `/api/plugins/runtime/${encodeURIComponent(plugin.name)}/dispatch`,
    source: "runtime",
  });
  seen.add(def.name);
}
```

```ts
// server/plugins/preset-list.ts:29
export const PRESET_PLUGINS: readonly PresetPlugin[] = [
  { packageName: "@mulmoclaude/spotify-plugin" },
  { packageName: "@mulmoclaude/recipe-book-plugin" },
  { packageName: "@mulmoclaude/debug-plugin" },
];
```

---

### 3.4 External MCP server (catalog / `mcp.json`)

**何**: 別プロセスで動く MCP サーバ。Claude Agent SDK が `--mcp-config` で起動して直接喋る。
mulmoclaude のコードは中継しない (= プラグイン契約は走らない)。

**例**:
- catalog 経由: GitHub, Linear, Spotify-MCP, YouTube transcript, Google Drive / Calendar / Gmail
- 手動 `mcp.json`: 任意の stdio / HTTP MCP

**設定先**: `<workspace>/config/mcp.json`

```json
{
  "mcpServers": {
    "github": { "type": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] },
    "spotify": { "type": "http", "url": "http://localhost:8123" }
  }
}
```

**LLM が tool として見るとき**: `mcp__<serverId>__<toolName>` (例 `mcp__github__create_issue`)。
in-process の `mcp__mulmoclaude__*` とは **別の MCP server** として並列に動く。

**ソース実装**:

- スペック型: `server/system/config.ts:122` — `McpConfigFile`
- 読込: `server/system/config.ts:191` — `loadMcpConfig()`
- agent 起動時の merge: `server/agent/index.ts:54-60`
- Docker パス書き換え: `server/agent/config.ts:50-77` — `prepareUserHttpServer` / `prepareUserStdioServer`
- 健全性チェック: `server/agent/mcpHealth.ts` — package validation, npm 解決テスト

```ts
// server/agent/index.ts:54
const userMcpRaw = loadMcpConfig().mcpServers;
const userServers = prepareUserServers(userMcpRaw, useDocker, workspacePath);
const hasUserServers = Object.keys(userServers).length > 0;
const hasMcp = activePlugins.length > 0 || hasUserServers;
```

**重要**: External MCP は **role でゲートされない**。`mcp.json` に書いた瞬間、全 role で利用可能になる。

---

### 3.5 Skill

**何**: markdown で書かれた手順書。LLM の **tool ではない** — frontmatter + 本文を持ち、
Claude Code SDK が「使うべき場面」を判断して system prompt の一部として LLM に提示する。

**置き場 (Claude Code SDK の制約)**:

Claude Code SDK が skill を読みに行くパスは **2 つだけ**で、CLI オプションで第三のパスを指定する方法はない:

- `~/.claude/skills/<name>/SKILL.md` — user scope (どこからでも読まれる)
- `<cwd>/.claude/skills/<name>/SKILL.md` — project scope (実行時 cwd の直下)

この制約のため、MulmoClaude では:

- **MulmoClaude エンドユーザ向け**: `<workspace>/.claude/skills/` (デフォルト `~/mulmoclaude/.claude/skills/`) — agent 起動時 cwd を workspace に固定しているので、ここが project scope として効く
- **リポジトリ直下の `.claude/skills/`**: 開発者が monorepo で `cwd=<repo>` で作業するとき用。**MulmoClaude を「アプリ」として使うユーザからは見えない** — 同梱したくないなら repo `.claude/` に置けば自然に区切られる

**Frontmatter 例**:

```yaml
---
name: weekly-summary
description: 毎週金曜に今週の wiki 編集をまとめる手順
schedule: "interval 168h"
---
```

**`schedule:` を持つ skill** は scheduler が自動実行する (`server/api/routes/scheduler.ts`)。

**Preset skills (launcher 同梱)**:

リポジトリには **launcher が同梱して出荷するプリセット skill** が `server/workspace/skills-preset/<name>/SKILL.md` に置かれている。命名規約は `mc-` プレフィックス (= "MulmoClaude managed")。リポジトリ側を編集して PR を出すのが正規ルート。

現在の preset (`mc-` prefix 持ち):

| Preset | 用途 |
|---|---|
| `mc-settings` | 設定 (roles / mcp.json / sources / skills / automations) の編集手順 |
| `mc-library` | 読書記録 — 読みたい本 / 読了の登録、感想を本人の言葉で記録、後から想起できるジャーナル |
| `mc-cooking-coach` | レシピの保存・更新・削除と `data/cooking/recipes/README.md` 索引維持 |

同期の実装は `server/workspace/skills-preset.ts` (`syncPresetSkills`)。起動時に `server/workspace/workspace.ts` から呼ばれる。

**Catalog vs Active 分離 (#1335 PR-A)**:

- **Source**: `<launcher>/server/workspace/skills-preset/<name>/SKILL.md`
- **Sync 先 (catalog)**: `<workspace>/data/skills/catalog/preset/<name>/SKILL.md` — 起動毎に上書き、launcher-owned
- **Active レイヤー**: `<workspace>/.claude/skills/<name>/SKILL.md` — Claude Code が discover、prompt に description が乗る

Catalog にあるだけでは prompt に乗らない (Claude Code の resolver は `.claude/skills/` しか見ない)。preset を有効化するには catalog → `.claude/skills/` にコピーする必要がある。コピー UI (★ star) は #1335 PR-B、上流 Anthropic skills の git sync は PR-C で予定。PR-A の時点で catalog はファイル上は populated されるが、UI 経由の active 化はまだない (手動 `cp` でアクティブ化可能)。

設計の動機: preset を増やしても勝手に system prompt が肥大化しないようにする。ユーザは catalog を眺める / 試す → 気に入ったものだけ ★ で恒常 active 化する 2 段モデル。

**ソース実装**:

- Discovery: `server/workspace/skills/index.ts` の `discoverSkills` — user + project を merge、project 優先
- Route: `server/api/routes/skills.ts:57` — `GET /api/skills`
- 編集 (project scope のみ): `saveProjectSkill` / `updateProjectSkill` / `deleteProjectSkill`
- MulmoClaude UI: `src/plugins/manageSkills/View.vue` — CRUD UI

```ts
// server/api/routes/skills.ts:57
const skills = await discoverSkills({ workspaceRoot: workspacePath });
```

**ドキュメント系操作の典型パターン: skill + hook**:

`presentDocument` / `presentSpreadsheet` / `manageWiki` といったドキュメント系の更新は、独自 endpoint を増やさず **skill が規約を教える → LLM が Read/Write/Edit で直接ファイル操作 → 必要な後処理は Claude Code SDK の hook で受ける**、という設計に寄せている:

1. skill が markdown / YAML / JSON の **保存先と書式規約**を LLM に教える
2. LLM が `Read` / `Write` / `Edit` で `<workspace>/data/<type>/<slug>.md` 等を**直接**更新する (plugin API を介さない)
3. **後処理が必要**な書き込みは Claude Code SDK の **PostToolUse hook** で受ける — `<workspace>/.claude/settings.json` で `hooks.PostToolUse[]` に `matcher: "Write"` を宣言し、hook スクリプトが `tool_input.file_path` を見て **ファイルパスで処理を分岐**する (例: wiki ページ書き込み → インデックス再計算 / `<img>` ref 補修、accounting JSON 書き込み → 集計キャッシュ無効化)

これにより、LLM 視点は「ファイルを書くだけ」のシンプルな世界のまま、サーバ側でドキュメント整合性を担保できる。endpoint を切らないので plugin 用テスト・ドキュメント・MCP 露出も不要。

**重要**:
- skill は **tool ではない**ので、プログラム連携 (`tools/call` で他 plugin から呼ぶ) には使えない
- 「次の朝」もファイルとして残るので、人間とAI で共同編集可能
- `manageSkills` は単なる CRUD UI、skill 自体は Claude Code SDK 内蔵レイヤーが扱う

---

### 3.6 Role

**何**: agent ペルソナ。`prompt` (system prompt 断片) + `availablePlugins` (静的 plugin gate) + `queries` (おすすめクエリ) のパッケージ。

**例 (built-in)**: `general`, `office`, `guide`, `artist`, `tutor`, `storyteller`, `settings`, `accounting`, `cookingCoach`, `debug`

**追加 (user-defined)**: MulmoClaude の Settings → Roles から `manageRoles` 経由、または `<workspace>/config/roles/<id>.json` を直接置く (ローダは `.json` のみ読む — `server/workspace/roles.ts`)

**ソース実装**:

- Schema: `src/config/roles.ts:25-32` — `RoleSchema`
- Built-in: `src/config/roles.ts:36` — `export const ROLES: Role[]`
- Persona prompt 注入: `server/agent/prompt.ts:683` — `buildSystemPrompt`
- Plugin gate: `server/agent/activeTools.ts:78` — `role.availablePlugins`

```ts
// src/config/roles.ts:25
const RoleSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string(),
  prompt: z.string(),
  availablePlugins: availablePluginsSchema,
  queries: z.array(z.string()).optional(),
  isDebugRole: z.boolean().optional(),
});
```

**重要**:
- role は **tool ではない** — chat 開始時に user が選び、その session 中は固定
- runtime plugin は `availablePlugins` を **無視して常時 ON** (#3 で前述)
- `isDebugRole: true` の role は production build で hide される (`debug` role)

---

### 3.7 Bridge (messenger 入口)

**何**: messenger app から MulmoClaude に話しかけるための **別プロセス**。
LLM の tool ではなく、ユーザのアクセス経路。

**例 (14個)**:
- 公式: `cli`, `telegram`, `discord`, `slack`, `line`, `whatsapp`, `matrix`, `irc`, `mastodon`, `bluesky`, `mattermost`, `zulip`, `messenger`, `google-chat`
- 追加 (`packages/bridges/`): chatwork, email, line-works, nostr, rocketchat, signal, teams, twilio-sms, viber, webhook, xmpp

**起動**:

```bash
yarn cli                              # 同一マシンで CLI bridge
yarn telegram                         # Telegram bot bridge
npx @mulmobridge/discord@latest       # 別マシンから接続
```

**ソース実装**:

- 各 bridge: `packages/<name>/` (公式) または `packages/bridges/<name>/`
- 接続プロトコル: `packages/protocol/` の socket.io イベント定義
- サーバ側 endpoint: `server/agent/index.ts` の `runAgent` を bridge から socket.io 経由で叩く

**重要**: bridge は MulmoClaude の **入り口** であって LLM の拡張ではない。
LLM 視点では bridge は見えない (= ユーザメッセージは普通の chat 入力として届く)。

---

## 4. 全体像 — LLM がどう発見するか

session 開始時の処理 (`server/agent/index.ts:39-99`):

```
        user が role を選択
              │
              ▼
  ┌────────────────────────────────────────┐
  │  getActiveToolDescriptors(role)        │  server/agent/activeTools.ts:77
  │                                        │
  │  - PLUGIN_DEFS (静的 GUI)  +  role gate │
  │  - mcpTools     (静的 MCP) +  role gate │
  │  - getRuntimePlugins()     (常時 ON)    │
  └─────────┬──────────────────────────────┘
            │
            ├─→ buildMcpConfig() で in-process MCP サーバ「mulmoclaude」起動
            │     server/agent/config.ts:176
            │     (上記 tool 群が tools/list で公開される)
            │
            ├─→ buildSystemPrompt() で role.prompt + 各 tool の prompt を組成
            │     server/agent/prompt.ts:683
            │     ・skills は workspace から discover して prompt に注入
            │     ・plugin の prompt セクションは buildPluginPromptSections (line 484)
            │
            ├─→ loadMcpConfig() で <workspace>/config/mcp.json を merge
            │     server/agent/index.ts:54
            │     (External MCP は別 server-id として並列に登録される)
            │
            └─→ Claude Agent SDK 起動 (--mcp-config + --allowedTools)
                  ・LLM は in-process MCP + 各 external MCP を並行で見る
                  ・tool 呼び出しは MCP 経由でルーティング
```

`getActiveToolDescriptors` がアプリ側 tool の **唯一の真実** であることが重要。
過去に config.ts / prompt.ts / mcp-server.ts それぞれが独自フィルタを持っていて drift した経緯があり、現在は3つともこの descriptor リストを参照する (`server/agent/activeTools.ts:1-25` のコメント参照)。

---

## 5. どれを選ぶか — 判断ガイド

| やりたいこと | 選ぶ機構 | 理由 |
|---|---|---|
| canvas で結果を見せたい / アプリ本体に組み込みたい | **#1 Built-in GUI plugin** | View/Preview ペアが用意されている |
| GUI なしのサーバ専用 tool | **#2 Built-in MCP-only** | 軽量、ENV gating が効く |
| 第三者配布 / コミュニティ拡張 | **#3 Runtime plugin** | npm install で増やせる |
| 既存の SaaS / OS 側ツール | **#4 External MCP** | mulmoclaude を改修せずに済む、catalog 整備済み |
| 業務手順 / プロンプトの再利用 | **#5 Skill** | 自然言語で書ける、`schedule:` で自動化可 |
| persona + tool セットの切替 | **#6 Role** | session 開始時に固定、`isDebugRole` で隠せる |
| 別アプリから AI に話しかけたい | **#7 Bridge** | 別プロセスで socket.io 接続 |

---

## 6. 設計指針

新しい機能をどの機構で実装するか迷ったら、**できる限り skill で実現する**ことを基本姿勢とし、以下の順番で検討する。

### 6.1 まず skill で実現できないか考える

新機能の第一候補は **skill (§3.5) + ファイル規約**。LLM は `Read` / `Write` / `Edit` / `Glob` / `Bash` を最初から持っているので:

- データ保存・更新・取得は skill が「どこに、どの形式で置くか」を教えるだけで成立する
- ユーザは markdown / YAML / JSON を直接編集でき、ファイル自体が source of truth
- skill 同士で規約を共有でき、別 Role から流用しやすい

これで済むなら **plugin endpoint・API・テスト・MCP 露出を一切書かなくていい**。reading list、bookmarks、recipe、travel log といった「データを置く・読む・更新する」系は全部このパターンで実装できる。

### 6.2 プログラム的処理が必要なら、まず hook との組み合わせを検討

skill だけだと足りない (= LLM がファイルを書いた後にサーバ側で何か計算したい / 整合性を取りたい) ケースが出てきたら、**plugin を作る前に Claude Code SDK の hook と組み合わせる**:

- LLM は skill の規約どおりに `Write` でファイルを書く
- `<workspace>/.claude/settings.json` の `hooks.PostToolUse[]` (matcher: `"Write"`) が発火
- hook スクリプトが `tool_input.file_path` を見て、該当パスならインデックス更新 / cache 無効化 / 通知発火 / 整合性チェック等を行う

これでも足りない (= LLM が呼び出せる handler が必要) なら、次の選択肢は **skill から外部コマンド / 既存 endpoint を叩く**:

- skill の指示で `Bash` ツール経由でスクリプトを実行する
- 既存の MCP tool (`notify` 等) や built-in plugin endpoint を skill から呼ぶよう促す
- カスタム CLI を `<workspace>/bin/` に置いて skill から呼ばせる

ここまでで済むなら、**plugin を増やさずに新機能が完結する**。

### 6.3 やむを得ない場合のみ plugin を増やす

skill + hook + 外部呼び出しでは表現できない場合に限り plugin を作る。具体的には:

- **複雑なビジネスロジック・不変条件**: accounting (借方/貸方バランス、税計算、月次決算) のように LLM が JSON を直書きすると整合性が壊れるケース → サーバ側 validator + plugin endpoint が必要
- **専用 canvas UI**: chart / spreadsheet / map / canvas drawing 等、markdown レンダリングだけでは不十分で固有 Vue コンポーネントが要るケース
- **リアルタイム / マルチタブ同期**: 複数のタブ・複数の家族端末で同じ状態を共有したいケース (pubsub channel)

**plugin と role は極力増やさない**。判断基準:

- LLM が任意のテキストを書いても問題ないか → **skill** (§3.5)
- 後処理だけ必要か → **skill + hook** (§6.2)
- 「整合した状態」と「壊れた状態」が事後に判別できるか・専用 UI が要るか → **plugin** (§3.1)

### 6.4 Role の追加にも慎重に

現在 built-in Role は 10 種。**これ以上は積極的に増やさない方針**。Role が増えると新規ユーザの「最初に何を選べばいいか」迷いが増え、機能間の境界がぼやける。

Role を増やしたくなったら、まず以下で代替できないか検討する:

- **skill で代替**: ペルソナの違いが軽い (口調・粒度) なら skill の方が軽量、複数 skill が並列に効ける
- **既存 Role の prompt 拡張**: 既存 Role の延長線上にあるなら、その Role の prompt にセクションを足す (`config/helps/*.md` への分割も検討)
- **user-defined role**: 1 ユーザの専用需要なら `manageRoles` でユーザに作ってもらう (built-in に押し込まない)

Role を増やすのが正解になるのは:

- 「会話の最初に明示的に切り替えるべき」レベルの**大きなペルソナの差** (cookingCoach のような専門領域 = 別アプリのつもりで開く)
- `availablePlugins` のセットが他 Role と明確に違う (e.g. office は presentation 系、accounting は仕訳系)
- `queries` で示す代表的なユースケースが他 Role と被らない

### 6.5 システム側で便利な skill を多めに同梱する

skill は markdown 1 枚で、追加コストが小さい。MulmoClaude 側があらかじめ **便利な skill をプリセットとして複数同梱**しておくと、ユーザが skill を 1 つも書かなくても多くの機能が手に入る。これが「plugin / role を増やさず機能を増やす」基本戦略になる。

同梱 skill を考えるときのポイント:

- LLM がそれを実行する場面はどんなトリガで来るか (会話の流れで自然に出てくる? `schedule:` で定期実行?)
- skill 内で参照する規約ファイル (`config/helps/*.md`) と分離するか統合するか
- 似た役割の skill を分けるか統合するか — 細かすぎると LLM が「使うべき場面」を判断しにくくなる

---

## 7. 関連ドキュメント

- [`developer.md`](developer.md) — アーキ全体、ディレクトリ構造、開発フロー
- [`plugin-runtime.md`](plugin-runtime.md) — runtime plugin の API 契約 (#3)
- [`bridge-protocol.md`](bridge-protocol.md) — bridge の socket.io プロトコル (#7)
- [`mulmobridge-guide.md`](mulmobridge-guide.md) — bridge の使い方ガイド
- [`docs/tips/`](tips/) — preset の setup ガイド (Spotify, Bedrock 等)
- `plans/done/feat-mcp-catalog-*.md` — MCP catalog の設計経緯 (#4)
