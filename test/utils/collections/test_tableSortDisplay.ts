// Unit tests for the pure list-table sort header display mappings
// (packages/plugins/collection-plugin/src/vue/tableSortDisplay.ts) — the
// icon glyph, button colour, aria-sort token, and hover-preview state machine
// backing the sortable column headers. Pinned here so the component (and its
// composable) stay thin reactive shells.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  previewSortDir,
  sortIconNameForDir,
  sortButtonClassForDir,
  sortAriaTokenForDir,
  type SortDir,
} from "../../../packages/plugins/collection-plugin/src/vue/tableSortDisplay";

describe("previewSortDir", () => {
  it("returns the actual direction when not hovered", () => {
    for (const dir of [null, "asc", "desc"] as const) {
      assert.equal(previewSortDir(dir, false), dir);
    }
  });

  it("previews the NEXT click's direction when hovered (none → asc → desc → none)", () => {
    assert.equal(previewSortDir(null, true), "asc");
    assert.equal(previewSortDir("asc", true), "desc");
    assert.equal(previewSortDir("desc", true), null);
  });
});

describe("sortIconNameForDir", () => {
  it("points down only for descending", () => {
    assert.equal(sortIconNameForDir("desc"), "arrow_downward");
  });

  it("points up for ascending and off", () => {
    assert.equal(sortIconNameForDir("asc"), "arrow_upward");
    assert.equal(sortIconNameForDir(null), "arrow_upward");
  });
});

describe("sortButtonClassForDir", () => {
  it("is dark while a direction is active", () => {
    assert.equal(sortButtonClassForDir("asc"), "text-slate-600");
    assert.equal(sortButtonClassForDir("desc"), "text-slate-600");
  });

  it("is light for the off state", () => {
    assert.equal(sortButtonClassForDir(null), "text-slate-300");
  });
});

describe("sortAriaTokenForDir", () => {
  it("maps each direction to its aria-sort token", () => {
    const cases: [SortDir, string][] = [
      ["asc", "ascending"],
      ["desc", "descending"],
      [null, "none"],
    ];
    for (const [dir, token] of cases) {
      assert.equal(sortAriaTokenForDir(dir), token);
    }
  });
});

// Deliberate asymmetry (see tableSortDisplay.ts): the icon/colour follow the
// hover PREVIEW, while aria-sort reflects the REAL direction. Assistive tech
// must never be told a hover preview is the current sort state.
describe("hover-preview vs aria asymmetry", () => {
  it("hovering a descending column previews the cleared look but keeps aria on descending", () => {
    const real: SortDir = "desc";
    const preview = previewSortDir(real, true);
    assert.equal(preview, null);
    assert.equal(sortButtonClassForDir(preview), "text-slate-300", "icon/colour follow the preview");
    assert.equal(sortAriaTokenForDir(real), "descending", "aria stays on the real state");
  });
});
