import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveEditorTextAfterReload } from "../../../src/plugins/presentSVG/editorRefresh.js";

describe("resolveEditorTextAfterReload", () => {
  it("replaces a clean editor with the fresh content", () => {
    assert.equal(resolveEditorTextAfterReload({ current: "<svg>old</svg>", fresh: "<svg>new</svg>", wasDirty: false }), "<svg>new</svg>");
  });

  it("keeps a dirty editor's edits", () => {
    assert.equal(resolveEditorTextAfterReload({ current: "<svg>edited</svg>", fresh: "<svg>new</svg>", wasDirty: true }), "<svg>edited</svg>");
  });

  // Regression: a deliberately cleared editor ("" is a valid edit) must
  // not be refilled by an external file change.
  it("keeps a dirty editor even when the user cleared it to empty", () => {
    assert.equal(resolveEditorTextAfterReload({ current: "", fresh: "<svg>new</svg>", wasDirty: true }), "");
  });

  it("keeps the current text when the fetch failed, clean or dirty", () => {
    assert.equal(resolveEditorTextAfterReload({ current: "<svg>a</svg>", fresh: null, wasDirty: false }), "<svg>a</svg>");
    assert.equal(resolveEditorTextAfterReload({ current: "<svg>b</svg>", fresh: null, wasDirty: true }), "<svg>b</svg>");
  });

  it("is idempotent when fresh equals current", () => {
    assert.equal(resolveEditorTextAfterReload({ current: "<svg>x</svg>", fresh: "<svg>x</svg>", wasDirty: false }), "<svg>x</svg>");
  });
});
