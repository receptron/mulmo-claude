import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseStoredViewMode,
  viewModeForShortcutKey,
  VIEW_MODE_STORAGE_KEY,
} from "../../../src/utils/canvas/viewMode.js";

describe("parseStoredViewMode", () => {
  it("returns the stored value when it is one of the known modes", () => {
    assert.equal(parseStoredViewMode("single"), "single");
    assert.equal(parseStoredViewMode("stack"), "stack");
    assert.equal(parseStoredViewMode("files"), "files");
    assert.equal(parseStoredViewMode("todos"), "todos");
    assert.equal(parseStoredViewMode("scheduler"), "scheduler");
    assert.equal(parseStoredViewMode("wiki"), "wiki");
    assert.equal(parseStoredViewMode("skills"), "skills");
    assert.equal(parseStoredViewMode("roles"), "roles");
  });

  it("falls back to 'single' when the stored value is null", () => {
    assert.equal(parseStoredViewMode(null), "single");
  });

  it("falls back to 'single' for unknown strings", () => {
    assert.equal(parseStoredViewMode(""), "single");
    assert.equal(parseStoredViewMode("grid"), "single");
    assert.equal(parseStoredViewMode("STACK"), "single"); // case-sensitive
  });
});

describe("viewModeForShortcutKey", () => {
  it("maps digit shortcuts to view modes", () => {
    assert.equal(viewModeForShortcutKey("1"), "single");
    assert.equal(viewModeForShortcutKey("2"), "stack");
    assert.equal(viewModeForShortcutKey("3"), "files");
    assert.equal(viewModeForShortcutKey("4"), "todos");
    assert.equal(viewModeForShortcutKey("5"), "scheduler");
    assert.equal(viewModeForShortcutKey("6"), "wiki");
    assert.equal(viewModeForShortcutKey("7"), "skills");
    assert.equal(viewModeForShortcutKey("8"), "roles");
  });

  it("returns null for any other key", () => {
    assert.equal(viewModeForShortcutKey("0"), null);
    assert.equal(viewModeForShortcutKey("9"), null);
    assert.equal(viewModeForShortcutKey("a"), null);
    assert.equal(viewModeForShortcutKey(""), null);
    assert.equal(viewModeForShortcutKey("Enter"), null);
  });
});

describe("VIEW_MODE_STORAGE_KEY", () => {
  it("is exposed as a stable string", () => {
    assert.equal(typeof VIEW_MODE_STORAGE_KEY, "string");
    assert.equal(VIEW_MODE_STORAGE_KEY, "canvas_view_mode");
  });
});
