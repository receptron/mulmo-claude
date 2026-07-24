# fix #1902: chat-index CHAT_DIR is stale (`chat/` vs `conversations/chat/`)

## User prompt (JP)

> https://github.com/receptron/mulmoclaude/pull/1884 これってこの変更以前から一覧のタイトル部分にサマリーが反映されてない。サマリー的なタイトルが作れらていないか、表示に失敗しているので調査して。
>
> 未来だけ動けば良い。修正して。

## Root cause

`server/workspace/chat-index/paths.ts:8` hardcodes `CHAT_DIR = "chat"`. The workspace layout moved to `conversations/chat` in the #284 reorg (`server/workspace/paths.ts:96` — `chat: "conversations/chat"`), but this file was not updated.

Consequence: `backfillAllSessions`, `listSessionIds`, `indexSession` all read/write `<workspace>/chat/…` (an empty dir since #284). Every `readManifest` in `sessions.ts:225` returns `{ entries: [] }`, so `indexById.get(sessionId)` is always undefined, and `preview` in `buildSessionSummary` (`sessions.ts:163`) falls back to `meta.firstUserMessage`. AI-generated titles are never persisted or displayed.

Introduced by `f0c5f46b6` (Apr 12, 2026 — chat-index feature). PR #1884 improves summary quality but does not touch this path.

## Fix

Derive `CHAT_DIR` from `WORKSPACE_DIRS.chat` so the two stay in lockstep. No migration of orphaned legacy entries (`~/mulmoclaude/conversations/chat/index/*` from Apr 16 and earlier) — user requested "future only".

### Change

**`server/workspace/chat-index/paths.ts`**

```ts
import { WORKSPACE_DIRS } from "../paths.js";
export const CHAT_DIR = WORKSPACE_DIRS.chat;
```

`chatDirFor(workspaceRoot)` returns `path.join(workspaceRoot, CHAT_DIR)`, which resolves to `<workspaceRoot>/conversations/chat` — matching what `sessions.ts` list handler reads at line 224.

### Test updates

- `test/chat-index/test_paths.ts` — replace hardcoded `"chat"` expectations with `path.join("conversations", "chat")` and update the `CHAT_DIR` value assertion.
- `test/chat-index/test_indexer.ts` — change the seed helper to `mkdirSync(join(workspace, "conversations", "chat"), …)` and use the same path for chatDir.
- `test/chat-index/test_maybe_index_session.ts` — same seed-helper adjustment.
- `test/routes/test_sessionsRoute.ts` — no change needed. It already resolves both dirs via runtime `import` of `WORKSPACE_PATHS.chat` and `indexDirFor(workspacePth)`, so the drift-comment on line 84-85 becomes obsolete (both trees will collapse into one) but the test itself still passes; the stale comment gets updated.

## What is NOT changed

- No backfill migration script for orphaned `~/mulmoclaude/conversations/chat/index/*.json` written before Apr 16. New indexer runs will refresh entries lazily via `maybeIndexSession` from the agent finally-hook.
- No env-driven force backfill added. Users who want immediate rebuild can run `CHAT_INDEX_FORCE_RUN_ON_STARTUP=1` (already exists in `server/index.ts:930`).

## Verification

1. `yarn format && yarn lint && yarn typecheck && yarn build && yarn test`
2. Manual: start the server, open a session, complete a turn, confirm `<workspace>/conversations/chat/index/<sessionId>.json` is written and the sessions list shows the AI-generated title.
