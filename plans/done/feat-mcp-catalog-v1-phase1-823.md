# MCP Catalog — Phase 1 (#823)

Phase 1 = catalog データ定義 + Catalog セクション UI、**config 不要 entry のみ**。Per-server config schema や secret masking は Phase 2 行き。

Closes part of #823.

## Goals

- ユーザが Settings の MCP タブで checkbox 一発で MCP server を install / uninstall できる
- 一般ユーザ向け entry を default 展開、開発者向けは折りたたみ
- 各 entry に upstream + setup guide のリンクを目立つ位置に表示

## Phase 1 entries (config-free 7 個)

すべて install 時に追加設定不要 (env / args 固定で動く)。

### 🟢 General

1. **Memory** — `@modelcontextprotocol/server-memory` (official)
2. **Sequential Thinking** — `@modelcontextprotocol/server-sequential-thinking` (official)
3. **Apple Reminders** (macOS) — community `mcp-server-applescript-reminders` 系 (※ package 名は PR レビューで最終確定)
4. **Apple Calendar** (macOS) — community
5. **Apple Notes** (macOS) — community
6. **Apple Music** (macOS) — community
7. **Screenshot** — community `mcp-screenshot` 系

### 🔵 Developer

なし (Phase 1 は config-free のみ。Developer の Puppeteer 等は config 不要だが Phase 3 でセクション分けと一緒に着地)

## Implementation

### `src/config/mcpCatalog.ts` (new)

```ts
export interface McpCatalogEntry {
  id: string;
  displayName: string;          // i18n key 経由
  description: string;          // i18n key
  audience: "general" | "developer";
  upstreamUrl: string;          // 📦 npm / GitHub
  setupGuideUrl?: string;       // 📚 setup 手順 (optional)
  spec: McpServerSpec;          // ServerSpec — type だけ持つ既存と同じ shape
  configSchema: McpConfigField[];  // Phase 1 では空配列
  riskLevel: "low" | "medium" | "high";
}

export interface McpConfigField {
  key: string;
  label: string;
  kind: "secret" | "text" | "path" | "url" | "select";
  placeholder?: string;
  required: boolean;
  helpUrl?: string;
  helpText?: string;
  options?: string[];
}

export const MCP_CATALOG: McpCatalogEntry[] = [
  // ... 7 entries
];
```

各 entry の `id` は既存の `McpServerEntry.id` と同じ key。Catalog から install すると `mcp.json` の servers に entry.id で追加される。Uninstall は同 id の server を `remove`。

### `SettingsMcpTab.vue` (modify)

既存の add-server form の **上**に Catalog セクションを追加:

```
┌ Pre-configured MCP servers ─────────────────────┐
│ 🟢 General             [v expanded]              │
│ ┌──────────────────────────────────────────────┐│
│ │ ☑ Memory                          🟢 low     ││
│ │   <description>                               ││
│ │   📦 npm  📚 docs                             ││
│ └──────────────────────────────────────────────┘│
│ 🔵 Developer           [> collapsed]             │
└──────────────────────────────────────────────────┘
─────────────────────────────────────────────────────
[Custom servers]   ← 既存
```

- entries は `MCP_CATALOG.filter(e => e.audience === ...)` で section 分け
- checkbox state = catalog entry の id が `props.servers` に存在するか
- Toggle on → `emit("add", { id, spec: entry.spec })`
- Toggle off → `emit("remove", indexOfId)`
- 既に同 id の custom server がある場合 (Phase 1 では稀) → 確認ダイアログは Phase 2 で

### i18n keys (8 locale)

```
settingsMcpTab.catalog.heading             // "Pre-configured MCP servers"
settingsMcpTab.catalog.audience.general    // "General"
settingsMcpTab.catalog.audience.developer  // "Developer"
settingsMcpTab.catalog.risk.low            // "low"
settingsMcpTab.catalog.risk.medium         // "medium"
settingsMcpTab.catalog.risk.high           // "high"
settingsMcpTab.catalog.upstream            // "Source"
settingsMcpTab.catalog.setupGuide          // "Setup"
settingsMcpTab.catalog.entry.<id>.displayName
settingsMcpTab.catalog.entry.<id>.description
```

per-entry `displayName` と `description` を 8 locale × 7 entries = **56 key/locale 追加**。

## Out of scope (Phase 2+)

- Config schema を伴う entry (Notion / Slack / Weather / Google Maps / Todoist)
- Secret masking
- Developer audience セクション (今回は General のみ)
- Catalog vs custom server 衝突時の確認ダイアログ
- Docker mode の path validator
- 1 entry → N instance (複製)
- Linear / GitHub / GitLab / Postgres / SQLite / Puppeteer (Phase 3)
- OAuth 系 (v2 全般)

## Acceptance criteria

- [ ] Settings の MCP タブに「Pre-configured MCP servers > General」セクションが見える
- [ ] **Memory** チェック → `mcp.json` に追加 → Settings 保存後 active
- [ ] **Memory** 再チェック (off) → `mcp.json` から削除
- [ ] 各 entry に `📦` upstream リンクが表示され、クリックで GitHub に遷移
- [ ] 7 entries 全部表示 (Apple ネイティブは macOS 以外でも表示するが、起動失敗は server 側ログのみ)
- [ ] 8 ロケール対応
- [ ] `yarn typecheck / lint / format / test / build` clean

## Notes

- **community package 名は PR レビューで最終確定**: Apple ネイティブ系と Screenshot は npm エコシステムでメンテ活発度を確認のうえ固定。Phase 1 PR ではコメントで候補を併記する
- macOS native MCP は **Linux / Windows では起動失敗**するが、catalog 上は表示する (ユーザが OS を理解している前提)。Phase 2 で `osConstraint: "darwin"` フィールドを追加して非対応 OS では灰色表示 + 警告
