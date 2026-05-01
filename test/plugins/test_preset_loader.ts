// Smoke test for the preset plugin loader (#1043 C-2 follow-up).
// Verifies that `loadPresetPlugins()` resolves entries declared in
// `config/preset-plugins.ts` against `node_modules/<pkg>/` and
// produces the same `RuntimePlugin` shape user-installed plugins do.
//
// Runs against the real `node_modules` rather than a fixture so a
// drift between `package.json` and `config/preset-plugins.ts` is
// caught here (`yarn add` was forgotten, the package was renamed,
// the upstream stopped exporting TOOL_DEFINITION, etc.).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadPresetPlugins } from "../../server/plugins/preset-loader.js";
import { PRESET_PLUGINS } from "../../server/plugins/preset-list.js";

describe("loadPresetPlugins", () => {
  it("loads every preset declared in config/preset-plugins.ts", async () => {
    const loaded = await loadPresetPlugins();
    assert.equal(loaded.length, PRESET_PLUGINS.length, "every preset entry should resolve to a RuntimePlugin");
    const loadedNames = new Set(loaded.map((entry) => entry.name));
    for (const preset of PRESET_PLUGINS) {
      assert.ok(loadedNames.has(preset.packageName), `preset ${preset.packageName} should be in the loaded set`);
    }
  });

  it("each loaded preset carries a non-empty version and a cachePath inside node_modules", async () => {
    const loaded = await loadPresetPlugins();
    for (const entry of loaded) {
      assert.ok(entry.version.length > 0, `preset ${entry.name} should expose a version`);
      assert.ok(entry.cachePath.includes("node_modules"), `preset ${entry.name} cachePath should resolve under node_modules`);
    }
  });

  it("each loaded preset carries a TOOL_DEFINITION the runtime registry can index", async () => {
    const loaded = await loadPresetPlugins();
    for (const entry of loaded) {
      assert.ok(typeof entry.definition.name === "string" && entry.definition.name.length > 0, `preset ${entry.name} TOOL_DEFINITION.name must be non-empty`);
      assert.ok(typeof entry.definition.description === "string", `preset ${entry.name} TOOL_DEFINITION.description must be set`);
    }
  });
});
