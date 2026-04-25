# feat: favicon status dots + decoupled background

## Problem

Today's favicon overloads the background color to communicate two
different things:

1. **Activity** — is a session running? (blue / cyan)
2. **Attention** — is a reply waiting? (green / fuchsia)

…on top of the calendar/time-of-day flavour palette (morning, weekend,
late-night, etc.). Whenever a session is running, the flavour palette
goes dark — you never see "weekend teal" while Claude is thinking,
even though weekend-ness has nothing to do with whether the agent is
busy.

Worse, two of the activity/attention rules consult the **current
session** (`activeSession.value?.hasUnread`,
`activeSession.value?.updatedAt`). If the user is on `/files`, the
sources view, or any non-chat view, `activeSession` is `undefined`
and the favicon misreports — for example a background session
running for 3 minutes in another tab won't tip the icon to cyan
because we only check the foreground session's `updatedAt`.

## Goal

Split the favicon into three independent visual channels that each
own a single concern:

| Channel | Says | Driven by |
|---|---|---|
| **Yellow dot** (top-left) | "at least one session is running" | global `isRunning` |
| **Red dot** (top-right) | "a reply is waiting somewhere" | global unread + notifications |
| **Background color** | "ambient context" — error, load, time-of-day, festive | resolver, with running/unread rules removed |

The dots own the activity/attention story; the background owns the
ambient story. They no longer fight for the same pixels.

Every signal feeding this must be **global**, not per-current-session,
because the user is regularly on non-chat views.

## Visual changes

### Yellow dot (new)

- 5 px radius, white 1.5 px outline (matching the existing red dot)
- Top-left corner (`x = dotR + 1`, `y = dotR + 1`)
- Color: `#EAB308` yellow-500
- Visible whenever any session has `isRunning === true`

The existing white "running glow" ring is **removed** in this change.
One running indicator is enough; the dot and the ring both fired on
the same condition and the ring was the softer / more ambiguous of
the two. `isRunning` is still wired into the renderer, but now its
only visual effect is toggling the dot.

### Red dot (unchanged)

- Already top-right, 5 px, red-600 with white outline
- Trigger condition unchanged (notifications OR any session unread)

### Background color (slimmed)

Drop the two rules whose job is now handled by the dots:

- ❌ `running` (blue) — yellow dot shows it
- ❌ `hasUnread` (green) — red dot shows it

Keep everything else, including the **escalations** of those states,
because the dots are binary but the background can convey severity:

- ✅ `error` (red) — still the strongest alert
- ✅ `overloaded` (orange) — CPU > 0.9
- ✅ `manyUnread` (fuchsia) — ≥5 unread is more than "yeah there's a reply"
- ✅ `runningLong` (cyan) — >60 s thinking is more than "started a run"
- ✅ All flavour rules — birthday, new-year, christmas, late-night, morning, weekend, idle

Net effect: when a single session is running for 10 seconds and the
user has 1 unread reply, the icon now shows **weekend teal +
yellow dot + red dot** instead of **plain blue with no calendar
context**. Festive colors finally show up while the agent works.

### Resolver priority after change

```text
1. error          (red)
2. overloaded     (orange)
3. manyUnread     (fuchsia) ← escalation of "has unread"
4. runningLong    (cyan)    ← escalation of "running"
5. birthday       (yellow)
6. newYear        (deep red)
7. christmas      (deep green)
8. lateNight      (indigo)
9. morning        (amber)
10. weekend       (teal)
11. idle          (gray)
```

The previous rules 5 (`running` blue) and 6 (`hasUnread` green) are
removed — the dots cover them.

## Decoupling from the current session

`useFaviconState` currently consumes:

- `currentSummary: ComputedRef<SessionSummary | undefined>` — the
  on-screen session row
- `activeSession: ComputedRef<ActiveSession | undefined>` — the
  in-memory entry for the on-screen session

Both go away. Instead it consumes a **global** view:

- `sessions: ComputedRef<SessionSummary[]>` — every known session
- `sessionsUnreadCount: ComputedRef<number>` — already global, kept
- `isRunning: ComputedRef<boolean>` — already global (scans the whole
  session map), kept

Two derived facts that previously read from the current session move
to whole-list scans:

- **Done state** (`hasUnread`): now derived purely from
  `sessionsUnreadCount > 0`. The favicon doesn't need to ask "is
  *this* session unread?" — any unread anywhere counts.
- **`runningSinceMs`**: now the **earliest `updatedAt`** of any
  session with `isRunning === true`. If three sessions are running
  and the oldest started 90 s ago, that 90 s is what triggers the
  cyan "running long" escalation. Falls back to `Date.now()` if no
  running session has a parseable `updatedAt`.

## Architecture

Files touched:

| File | Change |
|---|---|
| `src/composables/useDynamicFavicon.ts` | Add `drawActiveSessionDot` (top-left). Remove the white "running glow" ring block. Wire the existing `isRunning` flag to call the dot drawer. New constant `ACTIVE_SESSION_DOT_COLOR = "#EAB308"`. |
| `src/composables/useFaviconState.ts` | Drop `currentSummary` / `activeSession` opts. Add `sessions: ComputedRef<SessionSummary[]>`. Rewrite `faviconState` and `runningSinceMs` to use only global signals. |
| `src/composables/favicon/resolveColor.ts` | Remove the `running` and `hasUnread` branches from `resolveByState`. Drop the matching entries from `COLORS` and `FAVICON_REASONS`. |
| `src/composables/favicon/types.ts` | Remove `running` and `hasUnread` from `FAVICON_REASONS`. The 4-state `FAVICON_STATES` enum stays — `running` and `done` still drive priority inside the resolver, even though they no longer paint a unique background. |
| `src/App.vue` | Update `useFaviconState({…})` call to pass `sessions` instead of `currentSummary` / `activeSession`. |
| `test/composables/favicon/test_resolveColor.ts` | Drop the two cases asserting blue/green for `running` / `done`; add cases asserting that those states now fall through to flavour. |

## Test plan

- Unit: `resolveFaviconColor({ state: "running", … })` with no
  escalations and a Saturday afternoon clock now returns weekend
  teal — not blue.
- Unit: `resolveFaviconColor({ state: "done", sessionsUnreadCount: 1 })`
  on a weekday morning returns morning amber — not green. (The red
  dot covers the unread.)
- Unit: `resolveFaviconColor({ state: "running", runningSinceMs:
  90 s ago })` still returns cyan — escalation preserved.
- Manual: open two sessions, send a message in one, navigate to
  `/files`, confirm yellow dot appears within ~1 s and persists.
- Manual: leave a session running for >60 s on a weekend afternoon,
  confirm icon shows cyan background + yellow dot + (red dot if
  unread elsewhere).
- Manual: idle on a Saturday at 14:00, confirm teal background with
  no dots.

## Out of scope

- Animations on the dots (pulse, fade-in).
- Per-role / per-origin dot color (e.g. blue dot for scheduler runs).
- Reflecting *which* session is running — the dot is binary.
