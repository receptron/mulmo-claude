# Monorepo — yarn workspaces (#360)

## Goal

`chat-service` / `bridge-client` / `bridges` を npm パッケージとして切り出し、`npx @mulmoclaude/bridge-telegram` で使えるようにする。

## 現状分析

### Cross-boundary imports (修正が必要な箇所: 5 件のみ)

| import | from | to | 分類 |
|---|---|---|---|
| `EVENT_TYPES` | `relay.ts` | `src/types/events.ts` | → `@mulmoclaude/types` |
| `API_ROUTES` (chatService subset) | `index.ts` | `src/config/apiRoutes.ts` | → DI or types |
| `writeFileAtomic` | `chat-state.ts` | `server/utils/files/atomic.ts` | → DI |
| `CHAT_SOCKET_EVENTS` | `bridges/_lib/client.ts` | `server/api/chat-service/socket.ts` | → `@mulmoclaude/types` |
| `Attachment` type | `bridges/` (2 files) | `server/api/chat-service/types.ts` | → `@mulmoclaude/types` |

## Phase 1: monorepo structure + `@mulmoclaude/types`

### 1.1 Root workspace config

```json
// package.json に追加
"workspaces": ["packages/*"]
```

### 1.2 `packages/types/` 作成

```text
packages/types/
  package.json    ← @mulmoclaude/types
  tsconfig.json
  src/
    index.ts      ← barrel export
    events.ts     ← EVENT_TYPES, EventType
    routes.ts     ← CHAT_SERVICE_ROUTES (chatService subset only)
    socket.ts     ← CHAT_SOCKET_EVENTS, CHAT_SOCKET_PATH, ChatSocketEvent
    attachment.ts ← Attachment interface
```

**NOT included in types**: API_ROUTES 全体 (root の concerns), WORKSPACE_PATHS, PUBSUB_CHANNELS — これらは root のみ使用。

### 1.3 Import 書き換え

- `server/api/chat-service/relay.ts`: `../../src/types/events.ts` → `@mulmoclaude/types`
- `server/api/chat-service/index.ts`: `API_ROUTES.chatService.*` → types の定数 or DI
- `bridges/_lib/client.ts`: `../../server/api/chat-service/socket.ts` → `@mulmoclaude/types`
- `bridges/telegram/router.ts`: `../../server/api/chat-service/types.ts` → `@mulmoclaude/types`
- `bridges/_lib/client.ts`: Attachment import → `@mulmoclaude/types`

### 1.4 Build

`tsup` for packages (esbuild-based, fast):

```json
// packages/types/package.json
{
  "name": "@mulmoclaude/types",
  "version": "0.1.0",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": { "build": "tsup src/index.ts --dts" }
}
```

### 1.5 CI

- `yarn workspaces foreach run build` を CI に追加
- root の `yarn build` は変更なし (workspaces が先に build される)

## Phase 2: `@mulmoclaude/chat-service` 切り出し

`server/api/chat-service/` → `packages/chat-service/`

残る DI 課題:
- `writeFileAtomic` → `ChatServiceDeps.writeFile` に追加
- `API_ROUTES` → factory の option で route paths を受け取る

## Phase 3: Bridge 系切り出し

`bridges/_lib/` → `packages/bridge-client/`
`bridges/cli/` → `packages/bridge-cli/`
`bridges/telegram/` → `packages/bridge-telegram/`

bin entry で `npx` 対応。

## Open questions

1. npm org `@mulmoclaude` の取得 → ユーザー確認
2. tsup vs tsc — 小パッケージなので tsup 推奨
3. Phase 1 だけで 1 PR (types 切り出し + workspace config) — Phase 2/3 は別 PR
