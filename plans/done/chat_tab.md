# Chat Session Tabs

## Overview

A narrow tab bar sits between the role selector and the chat list. It always shows exactly six slots, populated from the server session history (`/api/sessions`). Clicking a tab switches to that session instantly.

## Behavior

- **Always six slots** — empty slots render as blank spacers with equal width.
- **Source** — `sessions` ref (server history), fetched on mount and refreshed after each agent run completes.
- **Switching** — calls `loadSession(id)`. If the session is already live in `sessionMap`, it just updates `currentSessionId` (no fetch). Otherwise loads from server.
- **Tooltip** — shows the session's first user message preview, or the role name if empty.

## Color Scheme

The same three-state color scheme is used consistently across all session UI: tab icons, history icon badges, and history pane list rows.

| State | Color | Meaning |
|---|---|---|
| Running | Yellow (`yellow-400`) | Agent is actively processing |
| Unread | Green (`green-500`) | Agent finished while user was in another session |
| Current | Blue (`blue-500`) | Currently viewed session |
| Idle | Gray (`gray-400`) | Past session, no pending activity |

## Where the colors appear

### Tab bar (icon color)
Each tab shows a single Material Icon for the session's role. Its color reflects the session state per the table above.

### History icon badges (header)
Two small number badges overlay the history (🕐) button:
- **Top-right** — yellow badge: count of running sessions (`activeSessionCount`)
- **Bottom-right** — green badge: count of sessions with unread replies (`unreadCount`)

### History pane list rows
Each session card uses the color scheme for:
- **Border and background tint** — yellow/green/blue/gray
- **Status label** — "Running" (yellow) or "Unread" (green) with a matching dot; otherwise just the date
- **Preview text** — tinted to match the state

## Unread logic

A session's `hasUnread` flag is set to `true` when its SSE stream completes and it is not the currently viewed session (`currentSessionId`). It is cleared when the user switches to that session via a tab click or the history pane.
