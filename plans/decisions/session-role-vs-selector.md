# Decision: RoleSelector ownership vs. session role

**Status**: settled (PR #701, refined by PR #774)
**Tracks**: #714 (closes), #665 (originating review)
**Last updated**: 2026-04-25

## Problem

The chat workspace surfaces a `RoleSelector` dropdown in the top bar.
At any moment two competing definitions of "current role" exist:

- **Selector role** — what's chosen in the dropdown right now
- **Session role** — the role the *active* session is actually
  running under (e.g. a Slack-bridge session created as `Tutor`, a
  scheduler-launched session, etc.)

When a user opens an existing session whose role differs from the
selector's current value, *which one wins?*

## Decision: user-owned selector (option B)

The selector is **user-owned**. Switching sessions does NOT mutate
the selector. The selector only matters at:

- Pressing `+` to create a new session
- Sending the first user message of a brand-new session
- Any `appApi.startNewChat(message)` call without an explicit roleId

For an existing session, the **session's own roleId** drives:

- The MCP tool filter applied to the agent run
- The system-prompt role context
- The right-sidebar role-prompt panel
- The suggested-query list

This is documented inline at `src/App.vue:397-401` next to the
`sessionRole` computed that bakes the session-derived value.

## Rejected alternative: session-owned selector (option A)

`activateSession()` would force `currentRoleId = session.roleId`
whenever a session is loaded. Originally suggested in PR #665's
codex review.

Why we didn't take it:

- A user who selects "Tutor" intending to send the next message as
  Tutor would lose the choice the instant they click any other
  session tab — even briefly, even by accident.
- It conflates two concepts (what's running here vs. what the user
  wants next) into one widget, making the selector feel like it
  belongs to the session rather than the user.
- PR #701 weighed both flows in detail and chose B for these
  reasons.

## What's implemented (post-#774)

- `useCurrentRole` (`src/composables/useCurrentRole.ts`) holds the
  selector's chosen role at module scope. The state survives
  `SessionHeaderControls` remounts when the side panel toggles.
- `SessionHeaderControls.vue` mounts the dropdown UI; nothing else
  reads or writes `currentRoleId` directly except `App.vue` at
  new-session creation time.
- `App.vue:sessionRole` derives the role to actually run the agent
  with from `activeSession.roleId`, falling back to `roles[0]`.
- `ToolResultsPanel.vue` and `StackView.vue` display the session's
  role name + icon in their header so the user sees which role the
  current session is running under, even if the selector says
  something else.

## Residual UX gap (intentional, deferred)

The selector and the session-role indicator can disagree visually
without anything bad happening — sending still uses the session
role. But a user unfamiliar with the model might:

1. See selector = "General"
2. Forget the session was opened as "Tutor"
3. Send a message expecting "General" behaviour
4. Get "Tutor" output

The session-role icon in the panel header is the existing
mitigation. Two further mitigations were considered in #714:

- **Case 2** — small `(session: Tutor)` helper text under the
  selector when it diverges from the active session, click-to-sync.
  Lightweight (~half day) but blurs the user-owned-selector
  principle slightly because the click action provides a fast path
  back to "session-driven selector". Deferred.
- **Case 3** — a confirmation dialog at send-time when the selector
  and session role disagree. Heavy; rejected because the gain is
  small and the dialog adds friction to every cross-role exchange.
  Not pursued.

If real user feedback shows the gap matters, file a fresh issue and
revisit case 2 — its implementation is small and additive. Don't
revisit case A.

## Cross-references

- Originating concern: PR #665 (codex review P2 comment)
- Decision adoption: PR #701 (user-owned selector)
- State refactor: PR #774 (`useCurrentRole` singleton)
- File renames since #714 was filed: the issue refers to
  `src/composables/useRoleSelection.ts`; that module is now
  `useCurrentRole.ts` (renamed in PR #774).
