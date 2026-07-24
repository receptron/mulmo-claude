import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fmtCoord, fmtAltitude, fmtTakenAt, hasValidCoords } from "../../../src/plugins/photoLocations/format.js";

describe("fmtCoord", () => {
  it("renders finite numbers with 5 decimals", () => {
    assert.equal(fmtCoord(35.123456), "35.12346");
    assert.equal(fmtCoord(-0), "0.00000");
  });

  it("degrades to em-dash for anything that is not a finite number", () => {
    assert.equal(fmtCoord(Number.NaN), "—");
    assert.equal(fmtCoord(Number.POSITIVE_INFINITY), "—");
    assert.equal(fmtCoord("35.6"), "—");
    assert.equal(fmtCoord(null), "—");
    assert.equal(fmtCoord(undefined), "—");
  });
});

describe("fmtAltitude", () => {
  // 0m is still a real altitude — it must render, unlike the coord pair rule.
  it("renders zero", () => {
    assert.equal(fmtAltitude(0), "0");
  });

  it("rounds toward the integer string", () => {
    assert.equal(fmtAltitude(-25.4), "-25");
    assert.equal(fmtAltitude(120.6), "121");
  });

  it("returns null (hides the badge) for non-numbers", () => {
    assert.equal(fmtAltitude("120"), null);
    assert.equal(fmtAltitude(undefined), null);
    assert.equal(fmtAltitude(Number.NaN), null);
  });
});

describe("fmtTakenAt", () => {
  it("formats a valid ISO date", () => {
    const out = fmtTakenAt("2026-05-11T10:23:45.000Z");
    assert.notEqual(out, "—");
    assert.ok(!out.includes("Invalid"));
  });

  it("degrades to em-dash for missing input", () => {
    assert.equal(fmtTakenAt(undefined), "—");
    assert.equal(fmtTakenAt(""), "—");
  });

  // Regression: a hand-edited sidecar carrying the raw EXIF datetime format
  // used to render "Invalid Date Invalid Date".
  it("degrades to em-dash for unparseable dates", () => {
    assert.equal(fmtTakenAt("2024:05:11 10:23:45"), "—");
    assert.equal(fmtTakenAt("not a date"), "—");
  });
});

describe("hasValidCoords", () => {
  it("accepts an ordinary pair", () => {
    assert.equal(hasValidCoords({ lat: 35.68, lng: 139.76 }), true);
  });

  it("accepts the range boundaries", () => {
    assert.equal(hasValidCoords({ lat: 90, lng: 180 }), true);
    assert.equal(hasValidCoords({ lat: -90, lng: -180 }), true);
  });

  // Regression: out-of-range values from a hand-edited sidecar used to pass
  // the finiteness-only check and render as plausible coordinates.
  it("rejects out-of-range values", () => {
    assert.equal(hasValidCoords({ lat: 90.0001, lng: 5 }), false);
    assert.equal(hasValidCoords({ lat: 1234, lng: 5 }), false);
    assert.equal(hasValidCoords({ lat: 5, lng: -180.0001 }), false);
  });

  it("rejects non-numeric or missing halves", () => {
    assert.equal(hasValidCoords({ lat: "35.6", lng: 139.7 }), false);
    assert.equal(hasValidCoords({ lat: 35.6 }), false);
    assert.equal(hasValidCoords({}), false);
    assert.equal(hasValidCoords({ lat: Number.NaN, lng: 139.7 }), false);
  });

  // Mirrors the server's write-side rule: 0,0 only comes from corruption.
  it("rejects the 0,0 null-island pair but not single zeros", () => {
    assert.equal(hasValidCoords({ lat: 0, lng: 0 }), false);
    assert.equal(hasValidCoords({ lat: 0, lng: 139.7 }), true);
    assert.equal(hasValidCoords({ lat: 35.6, lng: 0 }), true);
  });
});
