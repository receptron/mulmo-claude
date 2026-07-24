# feat: exclude scheduler-origin sessions from the long-running (24h+) filter

Date: 2026-07-01
Follow-up to #1885 (long-running 24h+ filter).

## Problem

The `longRunning` history filter added in #1885 matches any session whose
span (`updatedAt − startedAt`) reaches 24h. A `scheduler`-origin session is
a single recurring session kept alive for days, so it trivially crosses the
threshold and pollutes the filter even though it is not a conversation the
user had.

## Decision

Restrict the `longRunning` filter to exclude only `scheduler`-origin
sessions. `human`, `skill`, `bridge`, and `plugin:*` stay — those are real
back-and-forth conversations that can legitimately run long. (Chosen over
"human only" so bridge/skill conversations are not dropped.)

## Changes

- `src/utils/session/longRunning.ts`: new pure helper
  `isLongRunningConversation(session)` = `isLongRunning(session) && origin !== scheduler`.
- `src/components/SessionHistoryPanel.vue`: `matchesFilter` calls the new helper
  for `longRunning` instead of `isLongRunning`.
- `src/config/historyFilters.ts`: document the scheduler exclusion on the
  `longRunning` entry.
- `test/utils/session/test_longRunning.ts`: cover human / undefined / scheduler /
  skill / bridge / plugin and short-span cases.

## Notes

- Pure-logic change only; no server, type, or i18n changes (the
  "Long-running (24h+)" label is unchanged).
- The `longRunning` pill count updates automatically — `countByOrigin` reuses
  `matchesFilter`.
