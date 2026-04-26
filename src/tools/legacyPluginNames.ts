// Plugin keys that exist for backward-compat rendering only and must
// NOT appear in role-editor / allowed-tools palettes — picking them
// in a role does nothing because the LLM never sees them
// (server/agent/plugin-names.ts and src/config/toolNames.ts both
// omit them post the relevant rename, e.g. #824 split manageScheduler
// into manageCalendar + manageAutomations).
//
// Lives in its own file (no Vue imports) so unit tests under
// `test/tools/` can import the set without dragging the whole
// plugin registry — which transitively pulls .vue files that
// node:test / tsx can't load.

export const LEGACY_VIEW_ONLY_PLUGIN_NAMES: ReadonlySet<string> = new Set(["manageScheduler"]);
