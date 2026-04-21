import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toSafeFilename } from "../../../src/utils/files/filename.js";

describe("toSafeFilename", () => {
  it("leaves a clean filename untouched", () => {
    assert.equal(toSafeFilename("project-summary"), "project-summary");
  });

  it("replaces filesystem-hostile chars with underscores", () => {
    assert.equal(toSafeFilename('a/b\\c:d*e?f"g<h>i|j'), "a_b_c_d_e_f_g_h_i_j");
  });

  it("preserves spaces and unicode (safe on modern filesystems)", () => {
    assert.equal(toSafeFilename("プロジェクト 概要"), "プロジェクト 概要");
  });

  it("trims whitespace and falls back when result is empty", () => {
    assert.equal(toSafeFilename("   ", "document"), "document");
  });

  it("uses the default fallback when none is provided", () => {
    assert.equal(toSafeFilename(""), "download");
  });
});
