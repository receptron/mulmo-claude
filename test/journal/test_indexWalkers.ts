import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseDailyFilename } from "../../server/journal/index.js";

// `extractFirstH1` lives at src/utils/markdown/extractFirstH1.ts —
// its tests are in test/utils/markdown/test_extractFirstH1.ts.

describe("parseDailyFilename", () => {
  it("returns the two-digit day for valid DD.md filenames", () => {
    assert.equal(parseDailyFilename("01.md"), "01");
    assert.equal(parseDailyFilename("15.md"), "15");
    assert.equal(parseDailyFilename("31.md"), "31");
  });

  it("returns null for non-matching filenames", () => {
    assert.equal(parseDailyFilename("1.md"), null);
    assert.equal(parseDailyFilename("001.md"), null);
    assert.equal(parseDailyFilename("01.markdown"), null);
    assert.equal(parseDailyFilename("01.txt"), null);
    assert.equal(parseDailyFilename("README.md"), null);
    assert.equal(parseDailyFilename(""), null);
  });

  it("does not match dotfiles or hidden directories", () => {
    assert.equal(parseDailyFilename(".DS_Store"), null);
    assert.equal(parseDailyFilename(".01.md"), null);
  });
});
