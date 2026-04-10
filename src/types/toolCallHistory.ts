// One row of the right-side tool-call history pane. Lifted out of
// `src/components/RightSidebar.vue` so non-component code (the
// session domain types, the pending-calls helper, etc.) can refer
// to it without depending on a Vue file.

export interface ToolCallHistoryItem {
  toolUseId: string;
  toolName: string;
  args: unknown;
  timestamp: number;
  result?: string;
  error?: string;
}
