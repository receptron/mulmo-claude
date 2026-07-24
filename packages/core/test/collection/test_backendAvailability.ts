// `BackendUnavailableError` exists so the layers above a store can tell
// "the backend can't serve this" from "the record isn't there". Those layers
// catch broadly (`catch(() => null)`, `catch { return 0 }`), so the guard is
// load-bearing in BOTH directions: it must match the real thing, and it must
// NOT match ordinary errors — a guard that matched everything would turn
// every genuine failure into "unavailable" and hide real faults.
import { test } from "node:test";
import assert from "node:assert/strict";

import { BackendUnavailableError, isBackendUnavailable } from "../../src/collection/server/backendAvailability.ts";

test("matches a backend-unavailable error and carries its message", () => {
  const err = new BackendUnavailableError("sqlite storage needs the node:sqlite module (Node.js >= 22.5)");
  assert.equal(isBackendUnavailable(err), true);
  assert.match(err.message, /node:sqlite/);
  assert.equal(err.name, "BackendUnavailableError");
  assert.ok(err instanceof Error, "must stay a real Error so existing catch sites keep working");
});

test("does NOT match ordinary failures", () => {
  assert.equal(isBackendUnavailable(new Error("ENOENT: no such file or directory")), false);
  assert.equal(isBackendUnavailable(new TypeError("x is not a function")), false);
  assert.equal(isBackendUnavailable("a string throw"), false);
  assert.equal(isBackendUnavailable(null), false);
  assert.equal(isBackendUnavailable(undefined), false);
  assert.equal(isBackendUnavailable({ name: "BackendUnavailableError" }), false, "a look-alike object must not pass — the guard is by type, not by shape");
});
