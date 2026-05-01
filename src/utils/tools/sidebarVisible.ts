// Pure predicate for "should this tool result appear in the sidebar list?"
// Centralised so the sidebar render, the upstream `sidebarResults`
// computed, the auto-select-on-insert path, and keyboard navigation
// all use the exact same definition of "visible". Out-of-sync filters
// would let a hidden result get auto-selected (no card highlights but
// the canvas follows an invisible selection) or let arrow-key nav
// step through items the user can't see.
//
// A result is visible iff:
//   - its plugin has no previewComponent (legacy fallback path —
//     the sidebar shows a plain title span), OR
//   - the result carries a `data` field (the gui-chat-protocol's
//     view-side payload — its presence is the "show me a preview"
//     signal; absence means the action is fire-and-forget).
//
// This module stays free of the Vue plugin registry on purpose:
// Node test files (e.g. test_sessionEntries.ts) import callers of
// this predicate, and importing the registry would pull every
// plugin's .vue file into the test process at module-eval time.
// Callers that want a default "ask the registry" wiring import
// `sidebarVisibleApp.ts` instead.

import type { ToolResultComplete } from "gui-chat-protocol/vue";

export type HasPreviewFn = (toolName: string) => boolean;

export function isSidebarVisible(result: ToolResultComplete, hasPreview: HasPreviewFn): boolean {
  if (!hasPreview(result.toolName)) return true;
  return result.data !== undefined;
}
