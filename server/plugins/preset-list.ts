// Preset plugins shipped with the repo (#1043 C-2 follow-up).
//
// Each entry is a published npm package that lives in mulmoclaude's
// `node_modules`; the boot loader registers it through the same path
// as a user-installed runtime plugin (workspace ledger), so the
// frontend dynamic-import + Vue View pipeline runs end-to-end on
// every fresh checkout — no manual `yarn plugin:install` needed for
// testing or for first-launch UX.
//
// Presets and user-installed plugins share the runtime registry. On
// tool-name collision the preset wins (loaded first; static MCP
// built-ins still win over both).
//
// Adding a preset:
//   1. `yarn add <package>` (or extend an existing dep)
//   2. Append a row below
//   3. Restart the server
//
// Removing a preset:
//   1. Remove the row
//   2. Optionally `yarn remove <package>`
//   3. Restart

export interface PresetPlugin {
  /** npm package name (the directory under `node_modules`). */
  packageName: string;
}

export const PRESET_PLUGINS: readonly PresetPlugin[] = [
  // No presets currently. Plugins like `@gui-chat-plugin/weather` are
  // discovered through the user's workspace install ledger
  // (`plugins/plugins.json`) instead — running them as both a preset
  // and a user-install registered the same package twice and produced
  // a "name collides" warning on every boot. The framework remains
  // here for future presets that genuinely should ship pre-loaded.
];
