// The Firestore listener retry policy has exactly one implementation.
//
// `remote-host`'s command listener and the shared-collection store both need
// the same three answers (retry this error? wait how long? give up when?), and
// two copies would drift SILENTLY — one subsystem retrying a revoked grant
// forever while the other gives up on a network blip. The behaviour itself is
// covered by `test_hostRunner.ts`; what this file pins is that there is nothing
// to drift.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import * as listen from "../../src/firestore/listen.ts";
import * as hostRunner from "../../src/remote-host/server/hostRunner.ts";

describe("firestore listen policy", () => {
  it("hostRunner re-exports the shared implementation, not a copy of it", () => {
    // Identity, not equality of behaviour: a second implementation that
    // happens to agree today is exactly what this prevents.
    assert.equal(hostRunner.classifyListenerError, listen.classifyListenerError);
    assert.equal(hostRunner.backoffDelayMs, listen.backoffDelayMs);
    assert.equal(hostRunner.shouldGiveUpListening, listen.shouldGiveUpListening);
    assert.equal(hostRunner.LISTEN_RETRY_WINDOW_MS, listen.LISTEN_RETRY_WINDOW_MS);
  });

  it("a revoked grant is fatal and a blip is not", () => {
    // The two cases the shared-collection store branches on. Restated here
    // because that store reads this module directly, not through hostRunner.
    assert.equal(listen.classifyListenerError({ code: "permission-denied" }), "fatal");
    assert.equal(listen.classifyListenerError({ code: "unavailable" }), "transient");
    // An error with no code at all — a thrown string, a wrapped rejection —
    // is fatal, because retrying something unrecognised forever is worse.
    assert.equal(listen.classifyListenerError("boom"), "fatal");
  });

  it("backoff climbs and then caps, so a long outage is not a busy loop", () => {
    assert.equal(listen.backoffDelayMs(0), 1_000);
    assert.equal(listen.backoffDelayMs(1), 2_000);
    assert.equal(listen.backoffDelayMs(30), 30_000);
  });
});
