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

  it("rejects paths outside the allowed workspace roots", () => {
    // Bogus paths posted directly by a malicious client. `loadFromPath`
    // would refuse to read them, but the chip + JSONL line + LLM marker
    // are emitted independently — they have to filter here too.
    const attachments: Attachment[] = [
      { path: "/etc/passwd" },
      { path: "../escape.png" },
      { path: "secrets/key.pem" },
      { path: "data/attachments/2026/04/legit.png" },
      { path: "artifacts/images/2026/04/legit.png" },
    ];
    assert.deepEqual(collectAttachedPaths(attachments), ["data/attachments/2026/04/legit.png", "artifacts/images/2026/04/legit.png"]);
  });

  it("rejects an image path that doesn't end in .png (matches isImagePath)", () => {
    const attachments: Attachment[] = [{ path: "artifacts/images/2026/04/foo.gif" }];
    assert.deepEqual(collectAttachedPaths(attachments), []);
  });

  it("rejects traversal-shaped paths that match the prefix (Codex review on #1084)", () => {
    // The validators were prefix/suffix only before, so a value like
    // `data/attachments/../secrets/key.pem` passed `startsWith("data/attachments/")`
    // and reached the chat surface as `[Attached file: ...]` even
    // though `loadFromPath` would later refuse to read it.
    const attachments: Attachment[] = [
      { path: "data/attachments/../secrets/key.pem" },
      { path: "data/attachments/foo/../../bar.pdf" },
      { path: "artifacts/images/../escape.png" },
      // Windows / encoded backslash form. `decodeURIComponent` of `%5C`
      // produces `\`, and `path.normalize` treats it as a separator
      // on Windows — the validator must catch it before downstream
      // resolves it.
      { path: "data/attachments\\..\\secrets.pdf" },
      // Single-dot segment: also rejected (defense-in-depth).
      { path: "data/attachments/./foo.pdf" },
      // Real entries should still pass.
      { path: "data/attachments/2026/04/legit.pdf" },
      { path: "artifacts/images/2026/04/legit.png" },
    ];
    assert.deepEqual(collectAttachedPaths(attachments), ["data/attachments/2026/04/legit.pdf", "artifacts/images/2026/04/legit.png"]);
  });
});
