# Plan: `currentRoleId` changes only via user dropdown action

## Goal

Make the role dropdown fully user-owned. The only code that writes
`currentRoleId.value` should be the `update:currentRoleId` emit from
`RoleSelector.vue` (i.e. v-model in `App.vue:31`). Every other mutation
site is removed.

## Motivation

Today the selector doubles as both a UI control and a reflection of the
active session's role. That means the dropdown can change without the
user touching it (session tab click, agent `switchRole`, URL
`?role=`, session restore on mount). The goal of this change is a
clearer mental model: the selector shows *what the user chose*, not
*what the current session happens to be using*.

## Scope

Only the `currentRoleId` ref in `src/composables/useRoles.ts` is in
scope. **Session-level** `session.roleId` is out of scope — sessions
still own their own role and nothing about agent runs, SSE payloads,
or session records changes.

## Current mutation sites (from audit)

| # | Location | Trigger | Decision |
|---|---|---|---|
| 1 | `useRoles.ts:19` — `ref(ROLES[0].id)` | Module init | **Keep** (initial default) |
| 2 | `App.vue:31` v-model emit | User picks from dropdown | **Keep** (the only sanctioned path) |
| 3 | `App.vue:326` watch `route.query.role` | URL `?role=` on nav | **Remove** |
| 4 | `App.vue:560` in `createNewSession` | Every new session | **Remove** |
| 5 | `App.vue:621` in `activateSession` | Tab click / session restore | **Remove** |
| 6 | `App.vue:690` `setCurrentRoleId` | Agent `switchRole` SSE event | **Remove** |
| 7 | `App.vue:849` in `startNewChat` | Plugin override restore | **Remove** (becomes unnecessary once #4 is gone) |
| 8 | `App.vue:886` in `onMounted` | URL `?role=` on boot | **Remove** |

## User-visible consequences (decide before coding)

These are the behavior changes the user will actually see. Each one is
a deliberate tradeoff of this refactor, not a bug to fix afterwards.

1. **Session tab click no longer syncs the dropdown.** If the user is
   viewing a "General" session and clicks a tab whose session was
   created under "Wiki", the dropdown keeps showing "General" even
   though the loaded session is a Wiki session. The transcript and
   tool list shown in the sidebar derive from `currentRole`, so they
   also stay on General. Sessions remain internally tagged with their
   own `session.roleId`, but the UI no longer surfaces it.

2. **Agent-initiated role switch no longer updates the selector.** The
   `switchRole` SSE event is currently the agent saying "the user's
   request is better handled by role X, switch." After this change
   the agent can no longer influence the dropdown. *(See "Open
   questions" for whether the event itself should be removed server-
   side or just ignored client-side.)*

3. **URL `?role=` becomes purely informational.** A link like
   `/chat?role=wiki` will no longer preselect Wiki on load. The query
   param can still be kept on outgoing URLs (via `buildRoleQuery`),
   but inbound sync is gone.

4. **`onMounted` URL sync is removed.** Hard-loading a URL with
   `?role=wiki` lands the user on their last-used role, not Wiki.

5. **Plugin `startNewChat(msg, roleId)` override.** Currently this
   forces a one-shot role for the new session and then restores the
   previous selector role. Under the new rules the selector never
   moved in the first place, so the restore at `App.vue:849`
   disappears. The new session still records the override on
   `session.roleId`.

## Required code changes

### 1. `src/App.vue`

- **Delete** the watcher at lines 317–328 (`watch(() => route.query.role, …)`).
- **`createNewSession` (L554–565)**: remove line 560 (`currentRoleId.value = rId;`). The function still takes an optional `roleId` arg and tags the new session with it; it just stops mutating the global ref.
- **`activateSession` (L615–626)**: remove line 621. `roleId` param is now unused — remove from the signature and from both call sites (`resumeOrCreateChatSession` L603, `loadSession` L646 and L662). Update the comment at L618–620 to reflect the new contract.
- **`buildAgentEventContext` (L683–)**: remove `setCurrentRoleId` from the returned context object (L689–691).
- **`startNewChat` (L833–852)**: drop the `previousRoleId` bookkeeping (L839, L848–850). The function reduces to `createNewSession(roleId)` + `sendMessage(message)`.
- **`onMounted` (L871–915)**: remove the URL-role sync block at L883–887.

### 2. `src/utils/agent/eventDispatch.ts`

- **`AgentEventContext`**: remove the `setCurrentRoleId` and `onRoleChange` fields (L12–13).
- **`EVENT_TYPES.switchRole` handler (L35–40)**: either delete the case entirely, or keep it as a no-op with a comment. Preferred: delete the case and, in a follow-up pass (see Open Questions), stop the server from emitting the event.
- Update `AgentEventContext` callers anywhere else (grep for `setCurrentRoleId`).

### 3. No changes to

- `src/composables/useRoles.ts` — `currentRoleId` itself stays; only its writers change.
- `src/components/RoleSelector.vue` — the sanctioned writer.
- `session.roleId` and any server code — out of scope.
- `buildRoleQuery()` at App.vue:270 — can still emit `?role=` on outgoing URLs. Nothing reads it back in, which is fine.

## Open questions (resolve before implementing)

1. **`EVENT_TYPES.switchRole`**: if the client ignores it, does the
   server need to stop emitting it? Keeping it as dead weight is
   cheap; removing it is cleaner. Recommend: client ignores in this
   PR, file a follow-up issue to drop the event.
2. **Should the new session's role still be the dropdown's role?**
   Yes — `createNewSession()` without arg still reads
   `currentRoleId.value` at L557 and stamps it onto the new session.
   Only the *reverse* direction (session → dropdown) is severed.
3. **`rolesUpdated` event** already does not touch `currentRoleId` —
   no change needed.
4. **`?role=` on outbound URLs**: keep or strip? Keeping it is
   harmless (and lets URLs still carry the user's intent for
   bookmarking/sharing, even if we no longer honour them on load).
   Recommend: keep as-is.

## Test plan

- **Unit**: existing tests in `test/` that exercise `eventDispatch`
  need `AgentEventContext` updated (remove `setCurrentRoleId`,
  `onRoleChange` from mocks).
- **E2E (Playwright)**:
  - Pick role → send message → verify dropdown stays on picked role.
  - Pick role A → agent emits `switchRole` B → dropdown still A.
  - Open session X (role A), click tab for session Y (role B) →
    dropdown still A; session Y transcript still renders correctly
    (session Y's own `roleId` drives the agent on its next run, not
    the dropdown).
  - Hard-load `/chat?role=wiki` with last-used role General →
    dropdown shows General.
  - `+` while on Wiki role → new session tagged `wiki`. Pick General
    from dropdown on `/chat` → `onRoleChange` creates a new General
    session (unchanged behaviour).
- **Manual**: exercise the plugin `startNewChat(msg, roleId)` path
  (wiki Lint action, if still present) and confirm the new session
  gets the override `roleId` while the dropdown does not flicker.
- Run `yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`.

## Rollout

Single PR. No feature flag — the behaviour change is small enough to
review in one diff, and splitting would leave the intermediate state
inconsistent (half of the paths honouring the session, half not).
