import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldYieldExitError } from "../../server/agent/index.js";

// Pinned at the boundary where pre-#821 unconditionally emitted
// `[Error] claude exited with code <N>` even for user-initiated
// SIGTERM (the Stop button). We want:
//   - Real crash (non-zero, NOT aborted) → still surface as error
//   - Cancel (non-zero, aborted) → swallow (it's expected)
//   - Clean exit (zero, regardless) → no error
describe("shouldYieldExitError", () => {
  it("yields an error on a normal non-zero exit (not aborted)", () => {
    // The classic crash case: claude died for some reason that wasn't
    // our cancel button.
    assert.equal(shouldYieldExitError(1, false), true);
    assert.equal(shouldYieldExitError(2, false), true);
    assert.equal(shouldYieldExitError(127, false), true);
  });

  it("does NOT yield an error when the abort signal fired (Stop button)", () => {
    // proc.kill() typically maps to exit 143 (SIGTERM) or 137
    // (SIGKILL). Either way, if we initiated it via abortSignal, the
    // user already knows — don't double up with a scary error event.
    assert.equal(shouldYieldExitError(143, true), false);
    assert.equal(shouldYieldExitError(137, true), false);
    assert.equal(shouldYieldExitError(1, true), false);
  });

  it("does NOT yield an error on a clean exit", () => {
    assert.equal(shouldYieldExitError(0, false), false);
    assert.equal(shouldYieldExitError(0, true), false);
  });

  it("treats negative exit codes (signal-style on some platforms) like non-zero", () => {
    // Linux node spawn can surface signal terminations as null exit
    // codes; some shells/wrappers report negative values. The helper
    // shouldn't accidentally treat them as success.
    assert.equal(shouldYieldExitError(-1, false), true);
    assert.equal(shouldYieldExitError(-1, true), false);
  });
});
