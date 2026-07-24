import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isTransientStatus, classifyLoadFailure } from "../../../src/plugins/wiki/pageEditLoader.js";

describe("isTransientStatus", () => {
  it("treats a network failure (status 0) as transient", () => {
    assert.equal(isTransientStatus(0), true);
  });

  it("treats 5xx as transient", () => {
    assert.equal(isTransientStatus(500), true);
    assert.equal(isTransientStatus(503), true);
  });

  it("does not treat 404 / 4xx as transient", () => {
    assert.equal(isTransientStatus(404), false);
    assert.equal(isTransientStatus(400), false);
  });
});

describe("classifyLoadFailure", () => {
  // Regression: a snapshot 5xx used to be reported as "page deleted" for a
  // page that exists.
  it("reports error when the snapshot failed transiently", () => {
    assert.equal(classifyLoadFailure(500, { ok: false, status: 404 }), "error");
    assert.equal(classifyLoadFailure(0, { ok: false, status: 0 }), "error");
  });

  it("reports error when the live-page fallback failed transiently", () => {
    assert.equal(classifyLoadFailure(404, { ok: false, status: 503 }), "error");
    assert.equal(classifyLoadFailure(404, { ok: false, status: 0 }), "error");
  });

  // Snapshot gc'd (404) and the live page genuinely doesn't exist (200 ok but
  // no content, or a 404) → the page really is gone.
  it("reports deleted when both are genuine not-found", () => {
    assert.equal(classifyLoadFailure(404, { ok: true, status: 200 }), "deleted");
    assert.equal(classifyLoadFailure(404, { ok: false, status: 404 }), "deleted");
  });

  // Auth / rate-limit / bad-request failures say nothing about whether the page
  // exists; only NOT-FOUND semantics do. Reporting them as "deleted" showed a
  // false "page deleted" state the user could not recover from (Codex review).
  it("reports error for a live fetch that failed for a non-not-found reason", () => {
    for (const status of [400, 401, 403, 429]) {
      assert.equal(classifyLoadFailure(404, { ok: false, status }), "error", `status ${status} is not a deletion`);
    }
  });
});
