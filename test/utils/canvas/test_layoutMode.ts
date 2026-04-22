import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseStoredLayoutMode, LAYOUT_MODE_STORAGE_KEY, LEGACY_VIEW_MODE_STORAGE_KEY, LAYOUT_MODES } from "../../../src/utils/canvas/layoutMode.js";

describe("parseStoredLayoutMode", () => {
  it("returns stack when stored value is 'stack'", () => {
    assert.equal(parseStoredLayoutMode("stack"), LAYOUT_MODES.stack);
  });

  it("returns single when stored value is 'single'", () => {
    assert.equal(parseStoredLayoutMode("single"), LAYOUT_MODES.single);
  });

  it("defaults to single for null", () => {
    assert.equal(parseStoredLayoutMode(null), LAYOUT_MODES.single);
  });

  it("defaults to single for any unknown value (including legacy page names)", () => {
    assert.equal(parseStoredLayoutMode(""), LAYOUT_MODES.single);
    assert.equal(parseStoredLayoutMode("files"), LAYOUT_MODES.single);
    assert.equal(parseStoredLayoutMode("todos"), LAYOUT_MODES.single);
    assert.equal(parseStoredLayoutMode("STACK"), LAYOUT_MODES.single);
    assert.equal(parseStoredLayoutMode("<script>"), LAYOUT_MODES.single);
  });
});

describe("storage keys", () => {
  it("LAYOUT_MODE_STORAGE_KEY is the new key", () => {
    assert.equal(LAYOUT_MODE_STORAGE_KEY, "canvas_layout_mode");
  });

  it("LEGACY_VIEW_MODE_STORAGE_KEY preserves the pre-split key name", () => {
    assert.equal(LEGACY_VIEW_MODE_STORAGE_KEY, "canvas_view_mode");
  });
});
