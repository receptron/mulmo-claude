# Refactor: ID generation helpers (#723)

## Background

Issue #723 catalogued 18+ direct `crypto.randomUUID()` call sites
across `server/` with three distinct intents:

| Intent | Current shape | Example |
|---|---|---|
| **UUID v4** — globally unique, round-trips through URLs / jsonl | `crypto.randomUUID()` | `chatSessionId`, `task.id`, notification id |
| **Short hex slug** — 16-hex suffix for filenames | `crypto.randomUUID().replace(/-/g, "").slice(0, 16)` | `imageId`, `sheetId`, naming suffix |
| **Domain-prefixed scannable id** | `${prefix}_${Date.now()}_${randomBytes(3).toString("hex")}` via `makeId()` | todo / scheduler record ids |

Problems:

1. Layer 2 (the `.replace().slice(0, 16)` pattern) is duplicated
   verbatim in 3 places — `spreadsheet-store.ts`, `image-store.ts`,
   `naming.ts`. Extracting it makes intent ("short 16-hex slug")
   legible at call sites.
2. `makeId()` uses `randomBytes` from `node:crypto` while everything
   else uses `crypto.randomUUID()` — two primitives where one would
   do. User directive: drop `randomBytes`.
3. Direct `crypto.randomUUID()` calls for UUID v4 IDs don't signal
   *why* v4 — a `makeUuid()` wrapper documents the intent.

## Scope for this PR (server only)

User's note: "まず、意味ごとに関数化できるものは関数化しよう" —
first, extract the duplicated patterns into named helpers.

Focus on **server-side** call sites. Client-side (`src/plugins/*`)
and `packages/*` use their own `crypto.randomUUID()` calls; those
are separate PRs.

### Changes to `server/utils/id.ts`

```ts
import { randomUUID } from "crypto";

// Layer 1 — full UUID v4, 36 chars, hyphenated. Use when the id
// round-trips through URLs, jsonl files, or external systems that
// already expect v4 formatting.
export function makeUuid(): string {
  return randomUUID();
}

// Layer 2 — 16-char hex slug. 64 bits of entropy, safe as a
// filename suffix.
export function shortId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 16);
}

// Layer 3 — domain-prefixed scannable id.
// `<prefix>_<epochMs>_<6 hex chars>`. Now funnels through randomUUID
// so randomBytes is no longer imported.
export function makeId(prefix: string): string {
  const randomHex = randomUUID().replace(/-/g, "").slice(0, 6);
  return `${prefix}_${Date.now()}_${randomHex}`;
}
```

### Migrate call sites (server only)

**To `shortId()`:**
- `server/utils/files/spreadsheet-store.ts:39` (sheetId)
- `server/utils/files/image-store.ts:38` (imageId)
- `server/utils/files/naming.ts:47` (suffix; `RANDOM_SUFFIX_LEN`
  constant becomes dead and is dropped)

**To `makeUuid()`** (server-side chatSessionId / task.id / notification id):
- `server/index.ts:562`
- `server/workspace/skills/scheduler.ts:98`
- `server/workspace/skills/user-tasks.ts:83, 223`
- `server/api/routes/schedulerTasks.ts:115`
- `server/api/routes/scheduler.ts:125` (chatSessionId)
- `server/events/notifications.ts:63`

**Also migrated** (same files already touched — easier to do now
than open a follow-up):
- `server/agent/mcp-server.ts` (4 tool-call `uuid` fields)
- `server/api/routes/scheduler.ts` lines 72/90/110/141 (4 tool-call
  `uuid` fields)

**Out of scope** (separate code: client plugins, relay npm package,
atomic-write tmp filenames):
- `src/plugins/*/index.ts`
- `packages/relay/src/webhooks/*.ts`
- `server/utils/files/atomic.ts` + `packages/chat-service/src/atomic-write.ts`
  (tmp filenames — not IDs)

## Verification

- `yarn format && yarn lint && yarn typecheck && yarn build`
- `yarn test` — `makeId` format is tested at `test/utils/test_id.ts`
  (if exists); otherwise no test impact
- grep: no remaining `crypto.randomUUID().replace(/-/g, "").slice(0, 16)`
  in server/
- grep: no `randomBytes` import in server/utils/id.ts

## Follow-up (not this PR)

- Client-side `src/plugins/*` helper — probably a matching
  `src/utils/id.ts`, but client never generates "short ids" so only
  `makeUuid()` applies
- `packages/relay/src/webhooks/*.ts` — independent npm package,
  can't import from `server/`; either duplicate the helper or leave
  direct `crypto.randomUUID()` calls
- Document the three layers in daily-refactoring skill
