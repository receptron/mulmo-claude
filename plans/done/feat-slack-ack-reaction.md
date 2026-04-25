# plan: Slack bridge ack reaction (`:eyes:`)

Tracking: #695

## Goal

When the Slack bridge receives an inbound message, add an emoji
reaction to it immediately — **before** the agent starts processing —
so the user sees a visual "the bot got it" indicator within ~1 s.

## Env var

`SLACK_ACK_REACTION` — single variable, dual-purpose:

| Value (case-insensitive) | Enabled? | Emoji |
|---|---|---|
| (unset) / empty string | ✗ | — |
| `0` / `false` / `off` / `no` | ✗ | — |
| `1` / `true` / `on` / `yes` | ✓ | `eyes` (default) |
| Any other non-empty string | ✓ | literal value |

Validation: accepted emoji must match `/^[a-z0-9_+-]+$/` (standard
Slack shortcode charset, no surrounding colons). Invalid values
fail fast on startup — before Socket Mode opens — with a clear
error, matching the existing `parseGranularity` pattern.

Default off so every existing operator gets zero behaviour change
and zero new log noise from a missing `reactions:write` scope.

## Behaviour

In `socketMode.on("message", …)`, after the existing filters pass
(subtype / bot-id / self-user / allowlist / non-empty text) and
before `client.send(externalChatId, text)`:

```ts
if (ackEmoji !== null) {
  web.reactions
    .add({ channel: channelId, timestamp: event.ts, name: ackEmoji })
    .catch((err) => console.warn(`[slack] reactions.add failed (continuing): ${err}`));
}
```

Key properties:

- **Non-blocking**: the `.catch` runs in the background; agent
  processing starts immediately.
- **Swallow-and-log**: `missing_scope`, `already_reacted`,
  `message_not_found`, rate-limit — all logged as warnings, none
  stop the main handler.
- **Applies to every accepted inbound**: channel posts, thread
  replies, DMs. If we're going to process it, we react.
- **No removal after reply**: the reaction remains as a "seen"
  marker.

## Files

### New — `packages/bridges/slack/src/ackReaction.ts`

Pure env-var parser, exported as `parseAckReaction(raw: string | undefined): string | null`. Returns the emoji name when enabled, `null` when disabled. Throws on invalid non-empty values so `index.ts` can fail startup rather than silently running without the feature.

### `packages/bridges/slack/src/index.ts`

- Import `parseAckReaction`, call it alongside `parseGranularity` on startup.
- Add the `reactions.add` call described above in the message handler.
- Log the configured state in the startup banner (e.g., `Ack reaction: eyes` or `Ack reaction: (disabled)`).

### New — `packages/bridges/slack/test/test_ackReaction.ts`

Cases:

- unset / empty → `null`
- explicit off values (`0`, `false`, `off`, `no`, upper-case variants) → `null`
- explicit on values (`1`, `true`, `on`, `yes`, upper-case variants) → `"eyes"`
- custom emoji (`white_check_mark`, `thumbsup`, `my_bot_ack`) → passed through
- invalid emoji (`:eyes:` with colons, `has space`, `emoji-with.dot`, empty-after-strip) → throws
- sanity: `eyes` itself is NOT mistaken for a boolean

### `packages/bridges/slack/README.md` / `README.ja.md`

Docs additions:

1. **Scope list** gets an optional `reactions:write` item, marked
   as needed only when `SLACK_ACK_REACTION` is enabled.
2. **Environment Variables** table gets a new row for
   `SLACK_ACK_REACTION` with link to a short section that
   documents the on/off/emoji grammar with a worked example.

## Testing

### Unit

`test/test_ackReaction.ts` as above. Run via the existing
`yarn workspace @mulmobridge/slack test` path (same harness as
`test_sessionId.ts`).

### Manual smoke (reviewer checklist)

- Without the env var: no behavior change, no warnings.
- With `SLACK_ACK_REACTION=1` and `reactions:write` scope granted:
  send a message → 👀 appears on it within ~1 s → agent reply
  lands later, 👀 remains.
- With `SLACK_ACK_REACTION=white_check_mark` + scope: same with ✅.
- With `SLACK_ACK_REACTION=1` but scope NOT granted: 👀 does not
  appear, handler continues, reply lands normally, `[slack]
  reactions.add failed …` shows in logs.
- Invalid value (`SLACK_ACK_REACTION=":eyes:"`): bridge fails to
  start with a clear error.

## Versioning / release

Separate follow-up PR:

- `@mulmobridge/slack` 0.3.0 → 0.4.0 (minor: new opt-in feature).
- CHANGELOG entry under `[Unreleased]`.
- npm publish + tag `@mulmobridge/slack@0.4.0` + GitHub release
  with `--latest=false`.

Same flow as #663.

## Out of scope

- Remove-after-reply.
- Per-context emoji.
- Reaction on the bot's own outbound messages.
- Automatic retry on failure.
