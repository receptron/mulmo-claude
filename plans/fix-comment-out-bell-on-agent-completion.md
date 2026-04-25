# Fix: comment out bell on agent-completion (duplicate of Session History Panel badge)

## The rule

**Never fire two notifications for the same event.** Two badges in
the same chrome row that flip on the same trigger are noise — the
user has to dismiss both, and the second one carries no information
the first one didn't already carry.

## When the duplicate occurs

The double notification only occurs **when a chat session receives
a new message**. That is the precise condition under which both
indicators flip together:

1. **Session History Panel toggle button** — the red unread count
   badge on the panel toggle icon. Driven by
   `session.hasUnread`. It can only be set by `endRun()` in
   `server/events/session-store/index.ts` (line 140), which is
   called once per chat-session turn completion.
2. **Notification bell** — the red unread count badge on the
   bell icon. Driven by `publishNotification()` arrivals on the
   `notifications` pubsub channel.

These are independent signals fed by independent call paths. They
overlap only when the *same event* triggers both — i.e. when
`publishNotification` is called from a code path that has just
posted a new message to a chat session.

## Audit of `publishNotification` call sites

| Call site | Posts a message to a chat session at the same time? | Duplicate? |
|---|---|---|
| `server/api/routes/agent.ts:494` (agent-turn finally block, non-human origins) | **Yes** — fires immediately after `endRun(chatSessionId)` in the same `finally` | **Yes — this is the bug** |
| `server/workspace/sources/pipeline/notify.ts` (news pipeline interesting-article alerts) | No — the pipeline writes to source feeds / data, not to a chat session | No |
| `server/agent/mcp-tools/notify.ts` (`notify` MCP tool, agent-invoked) | Only when the user explicitly asked the agent for a notification ("通知して" / "tell me when …"). In that case the bell IS the user-requested signal — out of scope here | Out of scope |
| `server/events/notifications.ts:154` (`scheduleTestNotification`, legacy/dev) | No — dev/test endpoint | No |

So the duplicate exists at exactly **one** call site: the
`finally` block of `runAgentInBackground` in `agent.ts`, added by
PR #792 (commit `97aee460`,
`feat(notify): publishNotification on non-human turn completion
(#789)`).

## Verified frontend chain

### Surface 1 — Session History Panel toggle button

1. `server/api/routes/agent.ts:487`: `endRun(chatSessionId)` (always, regardless of origin).
2. `server/events/session-store/index.ts:140`: `session.hasUnread = true`.
3. `notifySessionsChanged()` propagates to the frontend.
4. `src/composables/useSessionDerived.ts:53`: `unreadCount = sessions.filter(s => s.hasUnread).length`.
5. `src/components/SessionHistoryToggleButton.vue:18-22`: red `unreadCount` badge on the panel toggle icon.

### Surface 2 — Notification bell

1. `server/api/routes/agent.ts:494` (this PR comments this out): `publishNotification({ kind: agent, ... })` for non-human origins.
2. `server/events/notifications.ts:82-84`: publishes to `PUBSUB_CHANNELS.notifications`.
3. `src/composables/useNotifications.ts:66-69`: subscribes, prepends the payload.
4. `src/composables/useNotifications.ts:115`: `unreadCount = notifications.filter(n => !readIds.has(n.id)).length`.
5. `src/components/NotificationBell.vue:94-98`: red `unreadCount` badge on the bell icon.

The initiator of the turn (human, bridge user, scheduled job,
skill chain, another agent — any of them) does not change this
analysis. As long as the agent posts a reply to a chat session
and `publishNotification` fires for the same turn, both badges
flip together.

## Decision

**Comment out** the `publishNotification` call in `agent.ts`'s
`finally` block — do not delete it. Keeping the block (and its
associated imports / helper) commented in-place makes the prior
intent visible: a future reader sees *why* the line was disabled
without having to dig through `git log`.

The accompanying inline comment is signed `(by snakajima)` so
the authority for the decision is explicit at the call site.

## Change

`server/api/routes/agent.ts`:

1. Lines 31-32: comment out the imports of `NOTIFICATION_KINDS`
   and `publishNotification` (otherwise the unused-import lint
   rule fires once the call site below is dead).
2. Lines 387-401: comment out the `completionNotificationTitle`
   helper (only caller is the commented block; otherwise the
   unused-function lint rule fires).
3. Lines 488-499: comment out the `publishNotification` call
   site, with a header comment that names the duplicate-with-
   Session-History-Panel reason and ends with `(by snakajima)`.

`SessionOrigin` and `SESSION_ORIGINS` are kept un-commented —
they are still used by `BackgroundRunParams` and the
bridge-origin decoration switch elsewhere in the file.

## Side effects

- The macOS Reminder sink (PR #789) is downstream of the same
  `publishNotification` call. It therefore stops firing on
  agent completion — which is fine: the agent-completion
  reminder is exactly the duplicate event; the user already
  sees the chat-session unread badge in the web UI, and any
  bridge-originated reply has already been pushed back to the
  bridge platform's app (Telegram / Slack / etc.), which itself
  reaches the phone.
- Other `publishNotification` callers (news pipeline, `notify`
  MCP tool, scheduled-test endpoint) are **unaffected**. Only
  the agent-turn-completion call site is suppressed.

## Acceptance

- [ ] Bridge-origin (Telegram / Slack / LINE / …) session
      completes → Session History Panel toggle button shows
      the red unread badge, Notification Bell does **not** show
      a new entry.
- [ ] Skill-origin session completes → same: history toggle
      badges, bell does not.
- [ ] Scheduler-origin session completes → same: history toggle
      badges, bell does not.
- [ ] Human-origin session completes → bell unchanged (still no
      new entry).
- [ ] News pipeline interesting-article match → bell still fires
      (regression check; that path doesn't touch a chat session,
      so it isn't a duplicate).
- [ ] Agent invokes the `notify` MCP tool ("通知して" /
      "tell me when …") → bell still fires (regression check).
- [ ] `yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`,
      `yarn test` all clean.
