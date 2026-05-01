// Pins the iter-1 fix from PR #1084 review (Codex on #1052 follow-up):
// `prepareRequestExtras` must NOT push a path into `attachedFilePaths`
// when `loadFromPath` returns undefined — otherwise the LLM gets told
// `[Attached file: <bogus>]` for a file that wasn't actually loaded.
//
// We don't write fixture files here. The path-validation gate
// (`isAttachmentPath` / `isImagePath`, both prefix + traversal-segment
// reject) is what we're verifying: an invalid path makes
// `loadFromPath` short-circuit returning undefined → both `result`
// and `attachedFilePaths` should remain empty for that entry.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Attachment } from "@mulmobridge/protocol";
import { prepareRequestExtras } from "../../../server/api/routes/agent.ts";

describe("prepareRequestExtras — load-failure marker gate", () => {
  it("returns empty extras for an empty / undefined attachments list", async () => {
    assert.deepEqual(await prepareRequestExtras(undefined), { attachments: undefined, attachedFilePaths: [] });
    assert.deepEqual(await prepareRequestExtras([]), { attachments: undefined, attachedFilePaths: [] });
  });

  it("does NOT push a marker for an invalid path (load fails)", async () => {
    // Pre-fix this would push the bogus path into `attachedFilePaths`,
    // emitting `[Attached file: ...]` to the LLM even though the byte
    // load was rejected.
    const attachments: Attachment[] = [{ path: "data/attachments/../escape.pdf" }];
    const out = await prepareRequestExtras(attachments);
    assert.deepEqual(out.attachedFilePaths, []);
    assert.equal(out.attachments, undefined);
  });

  it("does NOT push a marker for a path outside the allow-list roots", async () => {
    const attachments: Attachment[] = [{ path: "/etc/passwd" }, { path: "secrets/key.pem" }];
    const out = await prepareRequestExtras(attachments);
    assert.deepEqual(out.attachedFilePaths, []);
    assert.equal(out.attachments, undefined);
  });

  it("does NOT push a marker for an attachment with no path at all", async () => {
    // Inline-only entries should have been rewritten to path form by
    // `persistInlineBytesAsPaths` upstream. If one slips through with
    // no path, drop it — don't fabricate a marker.
    const attachments: Attachment[] = [{ mimeType: "image/png", data: "AAAA" }];
    const out = await prepareRequestExtras(attachments);
    assert.deepEqual(out.attachedFilePaths, []);
    assert.equal(out.attachments, undefined);
  });
});
