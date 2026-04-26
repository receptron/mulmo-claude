# Shared Thinking indicator (chat sidebar + slide view)

GitHub: https://github.com/receptron/mulmoclaude/issues/839

## Problem

Chat sidebar (`ToolResultsPanel.vue`) shows three bouncing dots + status
text + elapsed badge while the agent is running. The slide view
(`plugins/presentMulmoScript/View.vue`) only has tiny per-button spinners
on the movie / character / beat buttons; while a long generation is in
flight the user sees no top-level "still working" affordance.

## Approach

1. Extract the inlined indicator from `ToolResultsPanel.vue` into a new
   `src/components/ThinkingIndicator.vue`. Props:
   - `statusMessage: string` — required
   - `runElapsedMs?: number | null` — optional; only the chat sidebar passes it
   - `pendingCalls?: PendingCall[]` — optional; only the chat sidebar passes it
   Keeps `role="status"` + `aria-live="polite"` for a11y.
2. Replace the inlined block in `ToolResultsPanel.vue` with the new component.
3. Mount it in `plugins/presentMulmoScript/View.vue` just below the header.
   Drives visibility from a new `busyStatus` computed that picks the most
   specific label from movie / beat / character / audio generation state.
4. i18n: add 4 keys under `pluginMulmoScript` for the four busy states.
   Translate into all 8 locales.

## Out of scope

- Threading the parent's agent `isRunning` into the slide view — a
  separate concern; current local-state coverage is enough for the
  visual cue.
