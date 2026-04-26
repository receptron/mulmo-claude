# Shared Thinking indicator (chat-input area)

GitHub: https://github.com/receptron/mulmoclaude/issues/839
PR: https://github.com/receptron/mulmoclaude/pull/840 (merged 2026-04-26)

## Outcome

A new `src/components/ThinkingIndicator.vue` is mounted in `App.vue`
between `SuggestionsPanel` and `ChatInput` in both layouts (single
sidebar + stack bottom bar). The original in-`ToolResultsPanel`
indicator was removed during code review (duplicate `role=status`).
The new mount uses the same `activeSessionRunning` signal the chat
sidebar already had, so it lights up on every agent turn regardless
of which plugin view fills the canvas.

## What didn't ship

- Mounting the indicator inside `presentMulmoScript/View.vue` —
  abandoned because the user asked for the indicator to surface on
  every plugin view, not just the slide one. App.vue is the right
  layer.
- A `provideActiveSessionRunning` / `useActiveSessionRunning`
  composable pair — added during the slide-view-internal attempt,
  ended up unused once the placement moved to App.vue. Removed in
  the cleanup follow-up.
- Slide-view-specific i18n keys
  (`pluginMulmoScript.statusGeneratingMovie/Beats/Characters/Audio/Thinking`)
  for the same reason — replaced by a single top-level `app.thinking`.
  Removed in the cleanup follow-up.
