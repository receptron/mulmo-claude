// Both call forms of the transport subscribers reach the same shape (#3015).
//
// `MulmoScriptTransport` is exported from `/vue` on a published package, so
// the pre-root two-argument calls must keep working — and they must mean the
// DEFAULT root, which is what a caller written before roots existed was
// asking for. New callers pass an object, which cannot omit `root` and has no
// positions to transpose.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeGenerationSubscription, normalizeScriptChangedSubscription } from "../src/vue/subscription";
import type { MulmoScriptGenerationEvent } from "../src/core/contract";

const filePath = (): string => "stories/deck.json";
const seen: MulmoScriptGenerationEvent[] = [];
const genHandler = (event: MulmoScriptGenerationEvent): void => {
  seen.push(event);
};
const handler = (): void => {};

describe("onGenerationEvent accepts both call forms", () => {
  it("keeps the pre-root two-argument form working, on the default root", () => {
    // The break these tests exist for: a third positional parameter bound this
    // caller's `handler` to `root`, and the event path then called it as
    // `root()` — every event lost, at the first one.
    const subscription = normalizeGenerationSubscription(filePath, genHandler);
    assert.equal(subscription.filePath, filePath);
    assert.equal(subscription.handler, genHandler);
    assert.equal(subscription.root(), undefined, "a caller that predates roots means the default root");
  });

  it("passes an options object through untouched", () => {
    const root = (): string => "repoA";
    const subscription = normalizeGenerationSubscription({ filePath, root, handler: genHandler });
    assert.equal(subscription.root(), "repoA");
    assert.equal(subscription.handler, genHandler);
  });

  it("rejects the legacy form with no handler instead of subscribing a broken listener", () => {
    assert.throws(() => normalizeGenerationSubscription(filePath), TypeError);
  });
});

describe("onScriptChanged accepts both call forms", () => {
  it("keeps the pre-root three-argument form working, on the default root", () => {
    const subscription = normalizeScriptChangedSubscription(filePath, "view-1", handler);
    assert.equal(subscription.ownOrigin, "view-1");
    assert.equal(subscription.handler, handler);
    assert.equal(subscription.root(), undefined);
  });

  it("passes an options object through untouched", () => {
    const subscription = normalizeScriptChangedSubscription({ filePath, root: () => "repoA", ownOrigin: "view-1", handler });
    assert.equal(subscription.root(), "repoA");
    assert.equal(subscription.ownOrigin, "view-1");
  });

  it("rejects a legacy call missing ownOrigin or handler", () => {
    assert.throws(() => normalizeScriptChangedSubscription(filePath, "view-1"), TypeError);
    assert.throws(() => normalizeScriptChangedSubscription(filePath), TypeError);
  });

  it("never treats an empty ownOrigin as a missing one", () => {
    // `""` is a falsy but legitimate origin; a truthiness check here would
    // throw on a caller that is doing nothing wrong.
    const subscription = normalizeScriptChangedSubscription(filePath, "", handler);
    assert.equal(subscription.ownOrigin, "");
  });
});
