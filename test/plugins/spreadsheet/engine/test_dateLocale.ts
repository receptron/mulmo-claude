// Which way `03/04/2025` reads. Getting this wrong does not throw — the cell
// holds a real date, just the wrong one, three days or eleven months off
// depending on the pair.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { prefersDayFirst } from "../../../../src/plugins/spreadsheet/engine/date-locale.ts";

describe("prefersDayFirst — the locales the app ships", () => {
  it("reads day-first for the European languages", () => {
    for (const locale of ["es", "pt-BR", "fr", "de"]) {
      assert.equal(prefersDayFirst(locale), true, `${locale} writes day-first`);
    }
  });

  // Their conventional order is year-month-day, so in a two-part date the
  // month still comes before the day — same as US order.
  it("reads month-first for ja, zh and ko", () => {
    for (const locale of ["ja", "zh", "ko"]) {
      assert.equal(prefersDayFirst(locale), false, `${locale} puts the month first`);
    }
  });
});

describe("prefersDayFirst — English splits on region, not language", () => {
  // The app's own locale resolution folds `en-GB` to `en` before a plugin sees
  // it, so a bare `en` cannot be resolved and keeps the US default. A caller
  // that CAN supply the region gets the right answer.
  it("keeps the US default for a bare en", () => {
    assert.equal(prefersDayFirst("en"), false);
  });

  it("reads month-first for the month-first English regions", () => {
    assert.equal(prefersDayFirst("en-US"), false);
    assert.equal(prefersDayFirst("en-CA"), false);
    assert.equal(prefersDayFirst("en-PH"), false);
  });

  it("reads day-first for the rest of the English-speaking world", () => {
    for (const locale of ["en-GB", "en-AU", "en-NZ", "en-IE", "en-IN", "en-ZA"]) {
      assert.equal(prefersDayFirst(locale), true, `${locale} writes day-first`);
    }
  });
});

describe("prefersDayFirst — tag shapes", () => {
  it("accepts underscores as well as hyphens", () => {
    assert.equal(prefersDayFirst("en_GB"), true);
    assert.equal(prefersDayFirst("pt_BR"), true);
  });

  it("ignores case", () => {
    assert.equal(prefersDayFirst("EN-GB"), true);
    assert.equal(prefersDayFirst("FR"), true);
    assert.equal(prefersDayFirst("en-us"), false);
  });

  // A script subtag sits between the language and the region, so reading
  // position 1 as the region flips `en-Latn-US` to day-first (Codex review).
  // The earlier `zh-Hans-CN` case looked like it covered this and did not —
  // non-English tags never consult the region at all.
  it("reads past a script subtag to find the region", () => {
    assert.equal(prefersDayFirst("en-Latn-US"), false, "en-Latn-US is month-first");
    assert.equal(prefersDayFirst("en-Latn-GB"), true, "en-Latn-GB is day-first");
  });

  // An extension starts with a single-character subtag, and nothing after it
  // is a region. `-u-nu-latn` is the case that distinguishes: "nu" is two
  // letters and would otherwise be taken as a region, flipping a bare `en` to
  // day-first. (`-u-ca-gregory` does NOT distinguish — "ca" happens to be a
  // month-first region, so both readings agree by accident.)
  it("does not read an extension subtag as a region", () => {
    assert.equal(prefersDayFirst("en-u-nu-latn"), false, "no region: keeps the US default");
    assert.equal(prefersDayFirst("en-u-ca-gregory"), false);
    assert.equal(prefersDayFirst("en-GB-u-nu-latn"), true, "a real region before the extension still wins");
  });

  it("accepts a numeric UN M.49 region", () => {
    assert.equal(prefersDayFirst("es-419"), true, "Latin American Spanish is still day-first by language");
  });

  it("ignores the region for non-English tags", () => {
    assert.equal(prefersDayFirst("zh-Hans-CN"), false);
    assert.equal(prefersDayFirst("fr-CA"), true, "decided by language, not region");
  });

  // Falling back to month-first keeps the existing behaviour for anything
  // unrecognised, so a new locale cannot silently flip existing sheets.
  it("falls back to month-first for unknown, empty and missing locales", () => {
    assert.equal(prefersDayFirst("xx"), false);
    assert.equal(prefersDayFirst(""), false);
    assert.equal(prefersDayFirst(undefined), false);
    assert.equal(prefersDayFirst(null), false);
  });
});
