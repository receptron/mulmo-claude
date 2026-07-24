// Unit tests for the pure related-collections direction mapping
// (packages/plugins/collection-plugin/src/vue/relatedMenuDisplay.ts) — the
// navigation-direction → Material Icons glyph and i18n label key shown next to
// each neighbor in the related-collections pulldown.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { relatedDirectionIcon, relatedDirectionLabelKey } from "../../../packages/plugins/collection-plugin/src/vue/relatedMenuDisplay";

describe("relatedDirectionIcon", () => {
  it("maps each direction to its arrow glyph", () => {
    assert.equal(relatedDirectionIcon("out"), "arrow_outward");
    assert.equal(relatedDirectionIcon("in"), "arrow_back");
    assert.equal(relatedDirectionIcon("both"), "sync_alt");
  });
});

describe("relatedDirectionLabelKey", () => {
  it("maps each direction to its i18n label key", () => {
    assert.equal(relatedDirectionLabelKey("out"), "collectionsView.relatedOut");
    assert.equal(relatedDirectionLabelKey("in"), "collectionsView.relatedIn");
    assert.equal(relatedDirectionLabelKey("both"), "collectionsView.relatedBoth");
  });
});
