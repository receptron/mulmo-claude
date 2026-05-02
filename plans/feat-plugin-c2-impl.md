# Plan: C-2 — runtime plugin install (Phase 1 of #1043 plugin SDK)

Tracking: #1043 — umbrella for plugin SDK / dynamic install / marketplace.

## Goal

ユーザが npm install するだけで mulmoclaude に plugin（MCP definition + Vue View = `gui-chat-protocol` の `ToolPlugin`）を追加できるようにする。サーバ再起動で activate。

技術 feasibility は spike 5 段階で確認済み（#1043 の [comment](https://github.com/receptron/mulmoclaude/issues/1043#issuecomment-4357950541)）。本 plan はそれを production-quality な実装に落とす設計。

## Non-goals

- Hot reload（再起動で activate で十分。将来追加可能）
- Permission model / sandboxing（user explicit install = trust）
- Marketplace UI（C-4、別 issue）
- 公式 registry 制限（"any npm package" を install できる）

## Architecture

### Workspace 配置

```
~/mulmoclaude/
  plugins/
    plugins.json                      ← install 台帳 (source of truth)
    @gui-chat-plugin-weather-0.1.0.tgz
    @mulmochat-plugin-quiz-0.4.0.tgz
    .cache/                           ← 起動時 extract、version 別
      @gui-chat-plugin/weather/0.1.0/
        package.json
        dist/
          index.js                    ← MCP TOOL_DEFINITION + execute
          vue.js                      ← Vue View（runtime fetch）
          style.css
```

`plugins.json` shape:
```ts
type LedgerEntry = {
  name: string;        // "@gui-chat-plugin/weather"
  version: string;     // "0.1.0"
  tgz: string;         // basename
  installedAt: string; // ISO 8601
};
type Ledger = LedgerEntry[];
```

### Server 起動シーケンス

1. `server/plugins/runtime-loader.ts` を `server/index.ts` boot 中に呼ぶ
2. `~/mulmoclaude/plugins/plugins.json` 読み
3. 各 entry について:
   - tgz から `.cache/<name>/<version>/` に extract（cache hit ならスキップ）
   - `package.json` 読み、`exports["."].import` 経由で `dist/index.js` を `import()`
   - `TOOL_DEFINITION` を取得
4. 静的 plugin (`PLUGIN_DEFS` from `server/agent/plugin-names.ts`) と merge
   - **collision policy**: 静的 wins（built-in は shadow できない）。runtime 同士の collision はエラー（先入れ優先）
5. 結果を `RUNTIME_PLUGIN_REGISTRY` グローバルに stash
6. Express が generic dispatch route `/api/plugins/runtime/:pkgEncoded/dispatch` を提供
7. MCP server は `RUNTIME_PLUGIN_REGISTRY` を読んで `ALL_TOOLS` に注入

### Frontend 動的ロード

1. App boot 時 `GET /api/plugins/runtime/list` で installed plugins を取得
2. 各 plugin について:
   - `import("/api/plugins/runtime/<pkg>/<ver>/dist/vue.js")` で動的 import
   - `plugin.viewComponent` / `plugin.previewComponent` を `src/tools/index.ts` の plugins map に追加
   - `style.css` を `<link>` で挿入
3. importmap で `"vue"` を host bundle 経由の Vue に向ける（同一 instance）

### importmap の production build 対応

開発時:
- `index.html` に静的 importmap を入れる
- `<script type="importmap">{"imports":{"vue":"/_runtime/vue.js"}}</script>`
- `/_runtime/vue.js` は dev: vite middleware が serve、prod: Express static

`/_runtime/vue.js` の中身は1行:
```ts
export * from "vue";
```

これを vite が transform して、host が使う Vue dep に解決する。Production build では `build.rollupOptions.input` に追加して hashed chunk を emit、`transformIndexHtml` で hash 付き URL に書き換え。

### MCP tool dispatch

各 runtime plugin は同じ generic endpoint を共有:

```
POST /api/plugins/runtime/:pkgEncoded/dispatch
body: { tool: string, args: Record<string, unknown> }
```

- `:pkgEncoded` = URL-encoded package name (`%40gui-chat-plugin%2Fweather`)
- Express handler は `RUNTIME_PLUGIN_REGISTRY` から該当 plugin の `execute()` を呼ぶ
- `execute()` の戻り値を `ToolResult` envelope で返す

## 実装フェーズ

### Phase A: server-side runtime loader

| File | 内容 |
|---|---|
| `server/plugins/runtime-loader.ts` (new) | tgz scan → extract → TOOL_DEFINITION load。`loadRuntimePlugins()` を export |
| `server/plugins/runtime-registry.ts` (new) | `RUNTIME_PLUGIN_REGISTRY` 型 + getter + collision check |
| `server/utils/files/plugins-io.ts` (new) | ledger read/write (`writeFileAtomic` 経由)。`server/utils/files/<domain>-io.ts` の規約に従う |
| `server/workspace/paths.ts` (modify) | `WORKSPACE_DIRS.plugins`、`WORKSPACE_DIRS.pluginCache`、`WORKSPACE_FILES.pluginsLedger` 追加 |
| `server/index.ts` (modify) | startup で `loadRuntimePlugins()` 呼び |

Test: `test/plugins/test_runtime_loader.ts`、`test/plugins/test_runtime_registry.ts`

### Phase B: MCP server 統合

| File | 内容 |
|---|---|
| `server/agent/mcp-server.ts` (modify) | `ALL_TOOLS` に runtime plugins を merge。collision check + log warn |
| `server/agent/config.ts` (modify) | `MCP_PLUGINS` set に runtime tool name を追加。spawned MCP env でも見えるように |
| `server/api/routes/runtime-plugin-dispatch.ts` (new) | `POST /api/plugins/runtime/:pkgEncoded/dispatch` |
| `server/api/routes/runtime-plugin-list.ts` (new) | `GET /api/plugins/runtime/list` |
| `server/api/index.ts` (modify) | route 登録 |
| `src/config/apiRoutes.ts` (modify) | `API_ROUTES.plugins.runtime.{dispatch, list, asset}` 追加 |

Test: `test/agent/test_mcp_server_runtime_merge.ts`、`test/api/routes/test_runtime_plugin_dispatch.ts`

### Phase C: frontend 動的ロード

| File | 内容 |
|---|---|
| `src/_runtime/vue.ts` (new) | `export * from "vue"` shim（importmap target） |
| `src/tools/runtime-loader.ts` (new) | App boot で `/api/plugins/runtime/list` → 各 plugin を動的 import → plugins map に register |
| `src/tools/index.ts` (modify) | static map と runtime map を merge する getter |
| `src/main.ts` (modify) | `await loadRuntimePlugins()` を `app.mount` 前に挟む |
| `index.html` (modify) | `<script type="importmap">` で `"vue"` → `/_runtime/vue.js` |
| `vite.config.ts` (modify) | dev middleware: `/api/plugins/runtime/.../dist/vue.js` proxy。production build: `/_runtime/vue.js` を rollup input に追加 |
| `server/index.ts` (modify) | prod static-mount: `/api/plugins/runtime/<pkg>/<ver>/<file>` を `.cache/` から serve |

Test: `e2e/plugin-runtime-load.spec.ts`（mock plugin で動作確認）

### Phase D: install CLI + web UI

| File | 内容 |
|---|---|
| `scripts/plugin-install.mts` (new) | `npm pack <pkg>` → workspace tgz → ledger 更新 |
| `scripts/plugin-uninstall.mts` (new) | ledger から remove → tgz 削除 |
| `package.json` (modify) | `yarn plugin:install`、`yarn plugin:uninstall` script |
| `src/views/SettingsPluginsView.vue` (new) | install / uninstall UI（既存の Settings 画面に tab 追加でも） |
| `server/api/routes/plugin-install.ts` (new) | `POST /api/plugins/install`（web UI 経由）。npm pack をサーバ側で実行 |

Test: `test/scripts/test_plugin_install.ts`

### Phase E: production build + 動作確認

- vite production build で importmap が正しく hash 付き URL を指す
- `/_runtime/vue.js` を transformIndexHtml で書き換え
- E2E test (full path: install → restart → web UI で plugin 表示)
- docker mode 動作確認（cache dir のマウント）

## Open questions

- **plugin の dependencies はどうする？** 例: weather plugin の `dist/samples-*.js` chunk は同じ tgz に入ってる。だが他の npm package（lodash 等）に依存する plugin が来たら？
  - **方針**: plugin authors は dependency を bundle 済みで publish する責任。`package.json` の `dependencies` は無視（インストール時に解決しない）。bundle 不可能な物 (vue 等) は peerDependency に。これを `docs/plugin-development.md` に明記
  - **検証**: weather/camera/browse は単一 tgz で完結。他が来たら個別対応
- **plugin 同士の name collision**: 検出してエラーログ。両方 install 不可。設計上どちらを採るか難しいので**先勝ち**で running 中は固定、user に「片方を uninstall してください」と通知
- **plugin の install 後 server restart**: 現状プロセスマネージャーは何？`yarn dev` 時は手動再起動。docker / npx での自動 restart は別途検討
- **uninstall 時のキャッシュ**: tgz は消すが `.cache/` は残置（次回起動時に再 extract されない）。次の起動で ledger に無い entry を `.cache/` から GC

## Out of scope（今後）

- Plugin update（version bump）UX — 当面 uninstall + install で済ます
- Plugin signing / 公式 registry 制限 — permission model と一緒に検討
- Hot reload — 必要性が出たら設計
- Plugin 間通信 — 必要性が出たら設計
- Marketplace UI — C-4

## Test plan (umbrella)

- [ ] Unit: runtime-loader、runtime-registry、ledger I/O
- [ ] Unit: collision detection (static vs runtime, runtime vs runtime)
- [ ] Integration: MCP server が runtime plugin を `tools/list` で出す
- [ ] Integration: dispatch route が runtime plugin の execute を呼ぶ
- [ ] E2E: install CLI → server restart → frontend が plugin を mount
- [ ] E2E: web UI install → server restart → 同上
- [ ] Manual: docker mode で動作確認
- [ ] Manual: production build で importmap が正しく動作

## PR 分割案

1. **Phase A + B** (server-side complete): runtime loader、registry、MCP merge、dispatch route。CLI も使えないので user value はまだゼロ、レビューだけ
2. **Phase D (install CLI のみ)**: `yarn plugin:install` で tgz 配置 + ledger 更新。Phase A+B と組み合わせて user が手で `yarn plugin:install ... && yarn dev` できる
3. **Phase C** (frontend 動的ロード): View が描画できるようになる、これで user value が出る
4. **Phase D (web UI)**: 設定画面から install
5. **Phase E**: production build 動作確認 + 仕上げ
