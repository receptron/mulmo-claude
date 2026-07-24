# refactor(#2302): App.vue — extract session lifecycle into a composable (safe layer)

Refs #2302. Mirrors the "safe layer" slices of #2382 / #2381 / #2380: keep
the component's template + rendered DOM byte-for-byte identical, move only
script logic out, and add unit tests for the pure rules the move exposes.

## Why a composable (not `utils/`)

`src/App.vue` (1376 lines) is already the most composable-ified of the five
audited files: 30+ `use*` imports, pure helpers already living under
`utils/session/` · `utils/agent/` · `utils/collections/`. The remaining bloat
is one concern — **session lifecycle** — so the issue's prescription is
composable extraction, not another `utils` pass.

## This PR (safe layer)

Extract the session create / switch / load cluster into
`src/composables/useSessionLifecycle.ts`, wired by dependency injection (a
typed options object, same shape as `useSessionSync`). Moved verbatim:

- `navigateToSession` (internal)
- `removeCurrentIfEmpty`
- `createNewSession`
- `activateSession` (internal)
- `loadSession`
- `refreshSessionTranscript`
- `resumeOrCreateChatSession`
- `onRoleChange`

Cross-cutting deps passed in: `sessionMap`, `currentSessionId`, `isChatPage`,
`roles`, `currentRoleId`, `sessions`, `mergedSessions`,
`ensureSessionSubscription` (stays in App.vue — it belongs to the *event
stream* concern that a later PR extracts into `useSessionEventStream`),
`focusChatInput`, `collapseChatSuggestions`. `useRoute` / `useRouter` are
called inside the composable (setup context), matching house style.

App.vue keeps its template, watchers, event-stream functions
(`ensureSessionSubscription` / `handleSessionFinished` / `catchUpMissedEvents`
…), send flow, and app-api provider untouched; they call the destructured
functions the composable returns.

## Pure rules extracted + tested

`removeCurrentIfEmpty`, `createNewSession`, `loadSession`, `activateSession`
and `resumeOrCreateChatSession` each carry an inline DECISION that was never
unit-tested. Move those to `src/utils/session/sessionLifecycle.ts` and test in
`test/utils/session/test_sessionLifecycle.ts`:

1. `resolveNewSessionRoleId(explicit, currentRoleId, roleIds)` — the role
   fallback chain `explicit ?? (current || roles[0] || "")`. TOP priority: a
   silent wrong value here starts a chat in the wrong role. Test explicit
   wins, current fallback, first-role fallback, all-empty → "".
2. `shouldReplaceHistory(removedEmpty, isChatPage)` — `replace` vs `push`
   decision, shared by `createNewSession` + `loadSession`. Full truth table.
3. `isSessionEmpty(session)` — the `removeCurrentIfEmpty` predicate.
4. `isSessionAlreadyDisplayed(sessionId, currentSessionId, inMemory)` —
   `loadSession`'s early-return guard.
5. `isOnTargetSessionRoute(routeSessionId, targetSessionId, onChatPage)` —
   `activateSession`'s "skip redundant navigate (would strip `?result=`)".
6. `resolveResumeAction(topSessionId, topInMemory)` → `create|activate|load` —
   `resumeOrCreateChatSession`'s branch.

Each test is verified to go RED when the rule is inverted.

## Out of scope (deferred, tracked by #2302)

- `useSessionEventStream` (pub/sub + event dispatch + catch-up)
- `useAppApiProvider`, `useSendMessage`, `useGoogleMapsKey`
- template → `MainRouterOutlet.vue`

## e2e / DOM safety

App.vue's only two testids (`chat-sidebar`, `session-history-side-panel`) and
their surrounding flex/nesting are untouched — this PR edits `<script setup>`
exclusively. No testid renamed, no DOM reordered, no `SessionSidebar` prop /
slot change. Behaviour identical (verbatim move + DI).

## Constraints

No `any`, no `as`, functions < 20 lines, `const` over `let`, relative imports.
No package version bumps.
