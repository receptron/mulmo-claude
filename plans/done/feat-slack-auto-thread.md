# plan: Slack bridge — auto-thread in `thread` mode

Tracking: #658

## Goal

When `SLACK_SESSION_GRANULARITY=thread`, a top-level post in a Slack
channel should spawn a new thread on the first bot reply (and all
subsequent replies for that conversation). Users firing off several
unrelated top-level posts get one thread per topic — replies don't
interleave at top level.

## Non-goals

- No new env var. Piggyback on the existing `SLACK_SESSION_GRANULARITY`.
- No change to `channel` or `auto` semantics.
- DM (`channel_type === "im"`) behaviour deliberately untouched (threading is meaningless in 1:1 IMs).

## Design

Current code reads `event.thread_ts` and passes the resulting
`threadTs | undefined` into both session id construction and the
outbound reply. The key insight: when thread-mode is on, a top-level
post's own `event.ts` IS a valid thread anchor — passing it as
`thread_ts` to `chat.postMessage` causes Slack to retroactively
promote that message into a thread root and thread the reply under it.

So `thread` mode only needs to treat `event.thread_ts ?? event.ts` as
the effective thread anchor for channel messages.

### Inbound path (user → bridge → server)

```ts
const isChannelMessage = event.channel_type !== "im";
const effectiveThreadTs: string | undefined =
  typeof event.thread_ts === "string" && event.thread_ts
    ? event.thread_ts
    : granularity === "thread" && isChannelMessage
      ? (typeof event.ts === "string" ? event.ts : undefined)
      : undefined;
```

Pass `effectiveThreadTs` into:

1. `buildExternalChatId(channelId, effectiveThreadTs, granularity)` — so each top-level post in thread mode gets its own session keyed `channel_eventTs`.
2. `sendChunked(channelId, effectiveThreadTs, reply)` — so the bot reply carries `thread_ts`.
3. The error-notification `chat.postMessage` fallback — same reasoning.

### Outbound path (server → bridge push)

Already correct. `parseExternalChatId` reverses `channel_eventTs` back
into `{ channel, threadTs: eventTs }`, and `client.onPush` already
passes `threadTs` into the post. No change needed.

### `buildExternalChatId` logic check

Current:

```ts
const useThread = (mode === "thread" || mode === "auto") &&
                  typeof threadTs === "string" && threadTs.length > 0;
```

With the inbound synthesis above, `threadTs` is already the correct
"effective" value, so this function doesn't need to change. The
`|| mode === "auto"` branch is preserved too — `auto` still only
threads when the user actually started a thread.

### DM short-circuit

Slack delivers `channel_type: "im"` on DM events. In thread mode we
still want DMs to behave top-level since there's no threading UI to
speak of. The `isChannelMessage` gate above covers this.

## Testing

`packages/bridges/slack/test/sessionId.test.ts` already exists. Extend
or mirror it with unit tests that feed the new synthesis logic:

- `channel` mode + top-level event → no thread_ts
- `channel` mode + in-thread event → in-thread
- `thread` mode + top-level channel event → synthesised thread_ts = event.ts
- `thread` mode + in-thread event → existing thread_ts passes through
- `thread` mode + top-level IM event → no thread_ts (DM short-circuit)
- `auto` mode + top-level event → no thread_ts (unchanged)
- `auto` mode + in-thread event → in-thread (unchanged)

Extract the synthesis into a pure helper (`effectiveThreadTs(event, mode)`)
in `sessionId.ts` so the test can import it without starting the bridge.

## Docs

- `packages/bridges/slack/README.md` — update the `SLACK_SESSION_GRANULARITY` section to document the new `thread` mode semantics explicitly: "top-level posts auto-create a thread on the first reply".
- `packages/bridges/slack/README.ja.md` — same, translated.

## Rollout

No migration. On redeploy, anyone already using `thread` mode starts
getting per-topic threads. Flag this in the PR description so
operators know.

## Files to touch

- `packages/bridges/slack/src/sessionId.ts` — export new `effectiveThreadTs` helper.
- `packages/bridges/slack/src/index.ts` — call it, replace the ad-hoc `threadTs` in the three `chat.postMessage` sites.
- `packages/bridges/slack/test/sessionId.test.ts` — new cases (create file if missing).
- `packages/bridges/slack/README.md` / `README.ja.md` — update granularity doc.

## Done when

- `yarn test` green on the new cases.
- `yarn lint`, `yarn typecheck`, `yarn build` green.
- Manual smoke (documented in PR): `SLACK_SESSION_GRANULARITY=thread`, post three unrelated messages at top level → three distinct threads, each with the bot reply nested.
