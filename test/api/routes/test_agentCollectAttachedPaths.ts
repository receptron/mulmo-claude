// Pins the P1 fix from PR #1052 review: `collectAttachedPaths` must
// not throw on malformed (non-array) `attachments` payloads. The
// helper runs after `beginRun` has committed the session as running
// — if it threw, `endRun` would never fire and every subsequent turn
// would be rejected with 409 until restart.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Attachment } from "@mulmobridge/protocol";
import { collectAttachedPaths } from "../../../server/api/routes/agent.ts";

describe("collectAttachedPaths", () => {
  it("returns [] for undefined", () => {
    assert.deepEqual(collectAttachedPaths(undefined), []);
  });

  it("returns [] for an empty array", () => {
    assert.deepEqual(collectAttachedPaths([]), []);
  });

  it("returns [] for a malformed non-array payload (does not throw)", () => {
    // Cast through unknown to simulate a body that bypassed type
    // checking (e.g. a buggy HTTP client posting a string).
    const malformed = "not-an-array" as unknown as Attachment[];
    assert.doesNotThrow(() => collectAttachedPaths(malformed));
    assert.deepEqual(collectAttachedPaths(malformed), []);
  });

  it("returns [] for `null` posing as the attachments field", () => {
    const malformed = null as unknown as Attachment[];
    assert.deepEqual(collectAttachedPaths(malformed), []);
  });

  it("collects path-bearing entries in declaration order", () => {
    const attachments: Attachment[] = [
      { path: "data/attachments/2026/04/foo.png", mimeType: "image/png" },
      { path: "artifacts/images/2026/04/bar.png", mimeType: "image/png" },
    ];
    assert.deepEqual(collectAttachedPaths(attachments), ["data/attachments/2026/04/foo.png", "artifacts/images/2026/04/bar.png"]);
  });

  it("skips entries with no path (defensive — `persistInlineBytesAsPaths` should rewrite these upstream)", () => {
    const attachments: Attachment[] = [{ path: "data/attachments/2026/04/foo.png" }, { mimeType: "image/png", data: "AAAA" }, { path: "" }];
    assert.deepEqual(collectAttachedPaths(attachments), ["data/attachments/2026/04/foo.png"]);
  });
});
