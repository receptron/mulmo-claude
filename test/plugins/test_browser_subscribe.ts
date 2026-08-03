// The `subscribe` half of the protocol 2.0.0 migration, and the more subtle
// half: `dispatch` lets a bad response reach the caller, but a bad FRAME must
// be dropped. A channel is shared with every other subscriber on it, and the
// documented idiom is `parse: (raw) => Schema.parse(raw)` — zod's `parse`
// throws — so a rethrow here would take the channel down for everyone over one
// malformed frame.
//
// Same class of risk as the dispatch bug Codex caught: a parser accepted in the
// signature but not honoured at runtime. (Gap pointed out by CodeRabbit on
// #2783 — dispatch had these tests and subscribe did not.)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parsedFrameDelivery } from "../../src/utils/plugin/runtime.ts";

describe("parsedFrameDelivery (#2783 subscribe drop rules)", () => {
  it("delivers what parse returned, not the raw frame", () => {
    const seen: unknown[] = [];
    parsedFrameDelivery(
      () => "parsed",
      (payload) => seen.push(payload),
    )({ raw: true });
    assert.deepEqual(seen, ["parsed"]);
  });

  it("passes the raw frame to parse", () => {
    const seen: unknown[] = [];
    parsedFrameDelivery(
      (raw) => {
        seen.push(raw);
        return raw;
      },
      () => {},
    )({ id: 1 });
    assert.deepEqual(seen, [{ id: 1 }]);
  });

  // The rule that separates this from `dispatch`.
  it("drops a frame whose parse throws, without rethrowing", () => {
    let delivered = false;
    const deliver = parsedFrameDelivery(
      () => {
        throw new Error("malformed frame");
      },
      () => {
        delivered = true;
      },
    );
    assert.doesNotThrow(() => deliver({ bad: true }), "a throwing parse must not escape to the channel");
    assert.equal(delivered, false);
  });

  it("drops a frame whose parse returns null", () => {
    let delivered = false;
    parsedFrameDelivery(
      () => null,
      () => {
        delivered = true;
      },
    )({ bad: true });
    assert.equal(delivered, false);
  });

  // A dropped frame must not kill the subscription: the next good one still
  // arrives. This is what "drop" means as opposed to "unsubscribe".
  it("keeps delivering after a dropped frame", () => {
    const seen: unknown[] = [];
    const deliver = parsedFrameDelivery(
      (raw) => (raw === "bad" ? null : raw),
      (payload) => seen.push(payload),
    );
    deliver("bad");
    deliver("good");
    deliver("bad");
    deliver("also good");
    assert.deepEqual(seen, ["good", "also good"]);
  });

  it("does not call a handler that was never supplied", () => {
    assert.doesNotThrow(() => parsedFrameDelivery((raw) => raw, undefined)({ any: "frame" }));
  });
});
