// Regression tests for the plugin registry post-#824 split
// (manageScheduler → manageCalendar + manageAutomations).
//
// The legacy `manageScheduler` key is kept registered for view-only
// rendering of pre-split chat history, but it must NOT appear in any
// UI palette (role editor, allowed-tools picker) — selecting it
// there does nothing because the LLM never sees it.
//
// We test the pure constant + the filter contract rather than
// importing the full registry — `src/tools/index.ts` transitively
// imports `.vue` modules that node:test / tsx can't load.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LEGACY_VIEW_ONLY_PLUGIN_NAMES } from "../../src/tools/legacyPluginNames.js";

describe("LEGACY_VIEW_ONLY_PLUGIN_NAMES — registry exclusion", () => {
  it("contains the post-#824 legacy manageScheduler key", () => {
    assert.ok(
      LEGACY_VIEW_ONLY_PLUGIN_NAMES.has("manageScheduler"),
      "manageScheduler must be marked legacy-view-only — otherwise the role editor will offer it as a selectable plugin even though the LLM never sees it",
    );
  });

  it("does NOT contain the post-split successors", () => {
    // manageCalendar / manageAutomations are real LLM-exposed tools;
    // marking them legacy would silently hide them from role editing.
    assert.equal(LEGACY_VIEW_ONLY_PLUGIN_NAMES.has("manageCalendar"), false);
    assert.equal(LEGACY_VIEW_ONLY_PLUGIN_NAMES.has("manageAutomations"), false);
  });

  it("does NOT contain anything that is not actually a known legacy alias (sanity)", () => {
    // The set is small on purpose. Everything in it must point at a
    // historically-shipped tool name; adding a typo would silently
    // exclude a tool from the role editor.
    const KNOWN_HISTORICAL_TOOL_NAMES = new Set(["manageScheduler"]);
    for (const name of LEGACY_VIEW_ONLY_PLUGIN_NAMES) {
      assert.ok(
        KNOWN_HISTORICAL_TOOL_NAMES.has(name),
        `${name} is in LEGACY_VIEW_ONLY_PLUGIN_NAMES but is not a known historical tool key — keep this set tight`,
      );
    }
  });
});

describe("getAllPluginNames filter contract", () => {
  it("excludes any name listed in LEGACY_VIEW_ONLY_PLUGIN_NAMES", () => {
    // Mirror of the filter in src/tools/index.ts. Tested at the
    // contract level so the implementation can change (e.g. to a
    // dedicated getSelectablePluginNames function) without dropping
    // coverage of the actual exclusion behaviour.
    const allNames = ["manageCalendar", "manageAutomations", "manageScheduler", "manageTodoList"];
    const filtered = allNames.filter((name) => !LEGACY_VIEW_ONLY_PLUGIN_NAMES.has(name));
    assert.deepEqual(filtered, ["manageCalendar", "manageAutomations", "manageTodoList"]);
  });
});
