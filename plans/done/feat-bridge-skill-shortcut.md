# `//{skill}` — bridge shortcut for "reset + start skill"

## Why

Bridge users (Telegram, etc.) often want to **start a fresh chat with a
specific skill** from a remote device. Today that requires two messages:

```
/reset
/shiritori
```

On a phone keyboard that's two send actions and a wait between them. We
want a single-message shortcut: `//shiritori` → "new session, run skill."

The naming follows familiar precedent: `//` is "do twice / forcefully
fresh," analogous to how some shells use `!!` or how Slack treats `//`
as a stronger variant of `/`.

## Scope

**In scope.** Bridge slash-command handler (`packages/chat-service`)
only. Web UI is unaffected — it has no equivalent slash flow; users
there hit the **+** button to start a new chat.

**Out of scope.** Role switching shortcut (e.g. `//role:office /skill`)
or any UI changes.

## Design

### New behaviour

`//{skill_id} [args...]`:

1. Split on whitespace. The first token (after stripping the leading
   `//`) is the skill name; the rest are args forwarded verbatim.
2. Validate `{skill_id}` against the registered skill list (same
   allowlist that today gates plain `/{skill}` forwarding).
3. If it doesn't match a registered skill → reply with the standard
   "Unknown command" + help footer (no reset, no forward).
4. If it matches → call `resetChatState(transportId, externalChatId,
   currentRoleId)` (preserve the role, mirror plain `/reset`).
5. Forward `/{skill_id} {args}` to the agent on the **new** session.
   Real example: `//mag2 https://x.com/u/1` resets and forwards
   `/mag2 https://x.com/u/1`.

### Wire-level change

`CommandResult` gains one optional field:

```ts
export interface CommandResult {
  reply: string;
  nextState?: TransportChatState;
  /** When set, instead of short-circuiting with `reply`, the relay
   *  must continue into `startChat` using `forwardAs` as the message
   *  text and `nextState` as the active chat state. Used by the
   *  `//{skill}` shortcut: reset + forward in one turn. */
  forwardAs?: string;
}
```

### Relay change

In `packages/chat-service/src/relay.ts`, the post-command branch
becomes:

```ts
const commandResult = await handleCommand(text, transportId, chatState);
if (commandResult) {
  if (!commandResult.forwardAs) {
    return { kind: "ok", reply: commandResult.reply };
  }
  // forwardAs path: adopt the new state and continue into startChat
  // with the rewritten text below.
  if (commandResult.nextState) chatState = commandResult.nextState;
  text = commandResult.forwardAs;
}
```

We let it fall through into the existing `startChat(...)` block. No
duplicate code path.

### Help text

Add one line under the Skills section of `buildHelpText()`:

```
Tip: //<skill> starts a fresh session and runs the skill in one shot.
```

(Only when at least one skill is registered — keeps the help concise
for hosts that don't expose any.)

## Files touched

| File | Change |
|---|---|
| `packages/chat-service/src/commands.ts` | Add `forwardAs?` field; add `//` prefix branch in `handleCommand`; update help text |
| `packages/chat-service/src/relay.ts` | Honour `forwardAs` — adopt `nextState`, rewrite `text`, fall through |
| `packages/chat-service/test/test_commands.ts` | New `describe("//{skill} shortcut")` block |
| `server/workspace/helps/telegram.md` | Mention `//<skill>` next to `/reset` |

No host-app changes needed — the chat-service factory already exposes
`resetChatState` and `listRegisteredSkills` as DI hooks.

## Tests

Unit tests in `test_commands.ts`:

1. `//shiritori` with skill registered → returns `{ reply, nextState,
   forwardAs: "/shiritori" }`; `resetChatState` was called once with
   the existing `roleId`.
2. `//notaskill` with skills registered → returns standard
   "Unknown command" reply; `resetChatState` was NOT called.
3. `//` (bare) → "Unknown command" (empty skill name never matches).
4. `//mag2 https://example.com/post` → `forwardAs` =
   `/mag2 https://example.com/post`; `resetChatState` was called.
5. `//mag2 a b c` (multi-token args) → `forwardAs` = `/mag2 a b c`.
6. `//shiritori` when no skill list is wired → "Unknown command"
   (same fallback as plain `/{skill}` with no list).

## Risks / tradeoffs

- **Discoverability.** `//` is non-obvious. The `/help` line + a
  mention in `helps/telegram.md` is the entire surface area for
  teaching it; we accept that early-adopters learn from the docs.
- **Surface area.** One new optional field on `CommandResult` and one
  fall-through branch in `relay.ts`. No new modules, no new types
  beyond the field.
- **Compatibility.** Plain `/reset` and `/{skill}` keep working
  identically. The only new path is double-slash.

## Rollout

Single PR. No flag — the feature is purely additive behind a syntax
that today returns "Unknown command", so existing users see no
regression.
