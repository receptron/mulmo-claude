# manageRoles MCP tool 削除

Issue: #949 (manage\* プラグインのアーキテクチャ整理)

## 背景

#949 の議論で確定した方針:

- **wiki**: LLM Write/Edit 直 + chat 履歴 derive
- **roles / skills / sources**: 用途に応じて維持・削除を判断
- **manageRoles は削除** — 実用上 Skill で十分カバーでき、tool 追加は無駄に増やさない方針

実装の前提:

- 既存の `/roles` フロントエンド画面 (`src/plugins/manageRoles/View.vue` を `App.vue:173` で `currentPage === 'roles'` 時に表示) は **そのまま残す**
- ユーザは UI から create / edit / delete 可能のまま
- 失う機能は「LLM が tool 呼び出しで role を作る」一点のみ — Skill で代替可

## 変更内容

### 削除

| ファイル                                | 役割                       |
| --------------------------------------- | -------------------------- |
| `src/plugins/manageRoles/definition.ts` | tool schema                |
| `src/plugins/manageRoles/index.ts`      | ToolPlugin wrapper         |
| `src/plugins/manageRoles/Preview.vue`   | chat preview (tool 結果用) |

### 移動

| 元                                 | 先                             |
| ---------------------------------- | ------------------------------ |
| `src/plugins/manageRoles/View.vue` | `src/components/RolesView.vue` |

### 修正

- `src/App.vue` — import path 更新 (`./plugins/manageRoles/View.vue` → `./components/RolesView.vue`)
- `src/tools/index.ts` — `manageRoles: manageRolesPlugin,` 行と import を削除
- `src/config/toolNames.ts` — `manageRoles: "manageRoles",` 削除
- `server/agent/plugin-names.ts` — `ManageRolesDef` import / TOOL_ENDPOINTS / PLUGIN_DEFS から削除
- `server/agent/mcp-server.ts` — `if (name === "manageRoles") { ... }` ブロック削除
- `src/lang/{en,ja,zh,ko,es,pt-BR,fr,de}.ts` — `pluginManageRoles.previewCount` キーを削除 (Preview.vue 専用、他は View.vue が使うので残す)

### 変更なし

- `server/api/routes/roles.ts` — `/api/roles` / `/api/roles/manage` route はフロントエンドが使用継続
- `test/routes/test_rolesManage.ts` — server-side テストはそのまま意味あり
- `test/composables/test_useFreshPluginData.ts` — `/api/roles` response shape の例として使ってるだけで manageRoles プラグインに依存してない

## ビルトイン role への影響確認

`src/config/roles.ts` の builtin 4 role の `availablePlugins` を grep — **`manageRoles` を含むものは無し**。安全に削除可能。

## prompt への影響

prompt 内に `manageRoles` の言及があれば削除。grep で確認。

## テスト戦略

- 既存テストが全 pass する前提
- `RolesView.vue` 移動後も `/roles` ページが動作することは既存 e2e で担保 (あれば)
- 新規テスト不要 (削除のみ + ファイル移動)

## 完了条件

- [ ] manageRoles plugin の 3 ファイル削除 + View.vue 移動
- [ ] server / src の 4 ファイル修正 (App.vue / tools/index / toolNames / plugin-names / mcp-server)
- [ ] 8 locale から `previewCount` 削除
- [ ] `yarn typecheck && yarn lint && yarn build && yarn test` clean
- [ ] LLM が manageRoles tool を呼んだ時の挙動 — もう存在しない tool なので tool not found エラー (動作上問題なし)
- [ ] フロントエンド `/roles` 画面が引き続き動作

## Out of scope

- manageWiki の削除 (次の PR、lint_report の HTTP 化が前提)
- manageRoles の代替として Skill の機能拡張 (別 issue)
