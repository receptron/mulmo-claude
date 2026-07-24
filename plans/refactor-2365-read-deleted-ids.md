# refactor: one readSessionDeletedIds beside the payload type it reads

Issue: #2365

## Context

`jscpd` flagged 67 tokens duplicated **inside one directory**:

| File                                | Symbol                    |
| ----------------------------------- | ------------------------- |
| `src/composables/useSessionHistory.ts` | `readDeletedIds` (module-private) |
| `src/composables/useSessionSync.ts`    | `readDeletedIds` (module-private) |

Byte-identical. Both interpret the `PUBSUB_CHANNELS.sessions` payload, and both
subscribe to that same channel:

- `useSessionHistory` drops the ids from the cached sidebar list
- `useSessionSync` drops them from `sessionMap` and fires `onCurrentSessionDeleted`

Cursor diffs never carry deletions (`deletedIds` is always `[]` in the REST
response — see the #205 comments in `routes/sessions.ts`), so this payload is the
**only** cross-tab signal that a session is gone. Change the payload shape and fix
only one copy and the app breaks asymmetrically: one surface prunes, the other
keeps showing a session that no longer exists. To the user that reads as "old
sessions sometimes stick around", which points at nothing.

## Where the shared helper goes

`src/config/pubsubChannels.ts`, directly under the `SessionsChannelPayload`
interface it reads.

Checked first whether the repo keeps `src/config/` free of logic — it does not,
and deliberately so:

- `pubsubChannels.ts` already exports pure functions: `toPosixWorkspacePath`,
  `sessionChannel`, `fileChannel`, `collectionChannel`.
- `visibleWorkspaceDirs.ts` exports `isVisibleTopLevel`.
- `createFilePolicy.ts` imports `isSafeSlug` and applies it.

The pattern is "the contract plus the small pure helpers that enforce it", and
`toPosixWorkspacePath` is the exact precedent: it exists in this file so the
channel name and the payload can't drift apart. `readSessionDeletedIds` is the
same shape of helper for the same reason.

`pubsubChannels.ts` is also already a shared surface, not a frontend-only one —
`server/events/session-store/index.ts` (the publisher) imports
`SessionsChannelPayload` from it. Putting the reader here means publisher type
and subscriber reader sit in one file, which is the adjacency that prevents the
drift the issue describes. A separate `src/utils/session/*.ts` module would
re-open a milder version of the same gap.

## The `as` cast

The duplicated body used `(payload as SessionsChannelPayload).deletedIds`, which
CLAUDE.md forbids. The shared version narrows with real guards from
`@mulmoclaude/common` (via `src/utils/types.ts`) instead:

```ts
export function readSessionDeletedIds(payload: unknown): string[] {
  if (!isRecord(payload)) return [];
  const { deletedIds } = payload;
  if (!isUnknownArray(deletedIds)) return [];
  return deletedIds.filter((entry): entry is string => typeof entry === "string");
}
```

**Why not a single `isSessionsChannelPayload(v): v is SessionsChannelPayload`.**
A sound predicate for that type has to require `deletedIds` to be `string[]`,
which would make `{ deletedIds: ["a", 1] }` fail the guard and return `[]` —
silently discarding a valid deletion of `"a"`. That is a behaviour change, and it
is precisely the "a session lingers and nobody knows why" failure the issue is
about. Writing the guard leniently instead (accepting `unknown[]` elements while
claiming `SessionsChannelPayload`) would be an unsound predicate — a cast wearing
a guard's name.

So the narrowing is done with guards that are true at every step: `isRecord`
(gives `Record<string, unknown>`, so `payload.deletedIds` is honestly `unknown`),
`isUnknownArray` (keeps the element type `unknown` instead of `Array.isArray`'s
`any[]`), then the per-element `entry is string` predicate that was already
there. No `as` anywhere.

## Behaviour preservation

`isRecord` rejects arrays where the old `typeof payload !== "object"` accepted
them — but an array has no `deletedIds` property, so the old code fell through to
`Array.isArray(undefined) === false` and returned `[]`. Same output, one branch
earlier. Every other input class is unchanged.

## The #205 comment

Stays at the subscription site in `useSessionHistory.ts`. It explains why *that
composable* subscribes at all (its cursor-diff fetch can't see deletions) — a
local decision about `fetchSessions`, not a property of the payload reader. The
payload side of the same fact is already documented on `SessionsChannelPayload`
in `pubsubChannels.ts`.

## Verification

Tests live in `test/config/test_pubsubChannels.ts` (the existing test for this
module), covering: `null`, `undefined`, a string, a number, an array, an object
with no `deletedIds`, `deletedIds` not an array, mixed string/non-string
elements, an empty array, and the happy path.

Mutation-checked, not just "tests pass": with the `typeof entry === "string"`
filter dropped, the mixed-element case goes **RED** (`[ 'a', 1, 'b' ]` vs
`[ 'a', 'b' ]`). Restored → green.

## Catalog

`docs/shared-utils.md` gets a 1-line entry. It qualifies: the helper is now
imported by two composables (and is the contract's reader for any third
subscriber), which is exactly the cross-cutting case the catalog exists to stop
being re-implemented.
