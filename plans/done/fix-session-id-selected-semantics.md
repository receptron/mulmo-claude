# plan: collapse `currentSessionId` to "selected session" semantics

## Bugs fixed

1. **Minor**: on a non-chat page (Todos, Wiki, Files, …) the session history panel still draws the blue "selected" border around the last-viewed chat session.
2. **Serious**: if a run finishes while the user is on a non-chat page, the session's `hasUnread` flag gets cleared anyway — the user never actually read it.

Both stem from the same root cause: `currentSessionId` is used under two different meanings in the codebase — (a) "last chat session the user was on, persists across pages" and (b) "session currently visible on screen." The fix unifies them under (b).

## Non-goals

- No favicon behaviour work. The favicon's spinner will stop reflecting a running chat session when the user is on a non-chat page; that is an accepted consequence, not a goal.
- No rename of `currentSessionId` to `selectedSessionId`. Rename is mechanical and can follow separately.
- No changes to the `markSessionRead` server API.

## Design

### Single source of truth

`currentSessionId` means **the session currently displayed on /chat**. It is `""` whenever `isChatPage` is false. The derived `displayedCurrentSessionId` is deleted — it becomes identical to `currentSessionId` under the new rule.

### When `currentSessionId` clears

A single watcher in `App.vue`:

```ts
watch(isChatPage, (isChat, wasChat) => {
  if (wasChat && !isChat) {
    removeCurrentIfEmpty();
    currentSessionId.value = "";
  }
});
```

This replaces two concerns currently scattered through the code:

- Empty-session pruning previously called from `createNewSession` and `loadSession`. Within /chat, session switches no longer prune — the empty session lingers in `sessionMap` until the user leaves /chat. Memory-only, not user-visible.
- The "last active" memory that `resumeOrCreateChatSession` depended on. Dropped (see below).

### Cmd+1 on non-chat → no-op

The `else` branch of `handleViewModeShortcut` becomes a bare return. Cmd+1 on /chat still toggles layout; on any other page it does nothing. Users who want to go to /chat can click a session in the history panel, click the app-home button, or use the URL. `resumeOrCreateChatSession` stays — it's still called from `onMounted` (initial /chat load) and `handleHomeClick` — and its dead "reuse current empty session" branch is dropped: with the new semantics, home-click on a truly empty /chat just creates a new session.

### Unread-clear paths

Three call sites currently compare `currentSessionId.value === sessionId`. Under the new rule they automatically become correct — the comparison yields `false` on non-chat pages because `currentSessionId` is `""`. No code change needed at the comparison sites themselves, but:

- `useSessionSync.ts:38` has the same class of bug (suppressing a server-side `hasUnread = true` broadcast when the id matches `currentSessionId`). Under the new rule it too becomes correct automatically. No code change.

### Watcher on `currentSessionId` (the existing one)

The mark-read block at lines 549–557 stays where it is. It fires on every `currentSessionId` change — including `""` → sessionId (navigating back to /chat) and sessionId → `""` (navigating away). The `""` branch is a no-op (`sessionMap.get("")` is undefined, `sessions.find(...)` is undefined, `wasUnread` is false). The sessionId → `""` branch also no-ops for the same reason. Net: mark-read only fires when a real session becomes selected. Exactly what we want.

### Subscription lifecycle

Also in the existing watcher: when `currentSessionId` goes `A` → `""` (leaving /chat), `previousSessionId = A`, the code checks `prevBusy`. If `A` is running, subscription is kept (events still arrive — badge and unread stay fresh). If `A` is idle, subscription is torn down (fine — nothing to miss). Matches today's behavior; no change.

### `alreadyOnThatChat` simplification

`loadSession` currently checks `sessionId === currentSessionId.value && sessionMap.has(sessionId) && route.params.sessionId === sessionId`. The URL check was defensive against the dual meaning — on /wiki with `currentSessionId = A`, clicking A in the history panel would wrongly short-circuit without it. Under the new rule `currentSessionId` is `""` on non-chat, so `sessionId === ""` fails first. Drop the route-params check.

### SessionTabBar

- `isChatPage` prop removed.
- Unread-dot condition `hasUnread && !(isChatPage && id === currentSessionId)` simplifies to `hasUnread && id !== currentSessionId`. Same truth table under the new rule.
- Tab highlight class (`id === currentSessionId`) now draws on no tab when the user is on a non-chat page. Consistent with "nothing selected."
- Comments updated.

## Files touched

- `src/App.vue` — add `isChatPage` watcher; drop `resumeOrCreateChatSession`; drop the `else` branch in `handleViewModeShortcut`; drop `removeCurrentIfEmpty` calls inside `createNewSession` / `loadSession`; simplify `alreadyOnThatChat`; replace remaining `displayedCurrentSessionId` references with `currentSessionId`; update the comment at line 283 and line 664.
- `src/composables/useViewLayout.ts` — remove `displayedCurrentSessionId` and the `currentSessionId` opt.
- `src/components/SessionTabBar.vue` — drop the `isChatPage` prop + usage.
- `src/composables/useSessionSync.ts` — update the comment only (logic already becomes correct).

## Verification

- `yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`.
- Manual: start on /chat with an unread session, confirm border + unread clear. Switch to /todos mid-run, confirm border disappears and the session stays marked unread after the run finishes. Return to /chat with the same session → unread clears. Cmd+1 on /todos does nothing.
