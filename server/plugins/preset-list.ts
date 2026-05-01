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
  // weather is migrated from build-time bundle to runtime preset so
  // the runtime path runs on every fresh checkout. The package
  // exports `fetchWeather` (Japan Meteorological Agency) — a no-side-
  // effects external API call, perfect for verifying both the MCP
  // dispatch path and the frontend View render path.
  { packageName: "@gui-chat-plugin/weather" },
];
