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
import { sameRoot } from "../src/core/contract";
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

describe("the object form is checked at the subscribe call, not at delivery", () => {
  // This package is published, so a JavaScript consumer reaches these
  // functions with no call-site checking. An object missing `root` passed
  // straight through, and the failure surfaced later as
  // `sub.root is not a function` — thrown inside a pubsub delivery, where
  // there is no caller left to catch it and the only symptom is a View that
  // silently stops updating (CodeRabbit on #3015).
  const filePath = (): string => "stories/deck.json";
  const handler = (): void => {};

  it("treats an object with no root as the default root", () => {
    // The one field with a safe answer: a caller who did not think about
    // roots meant the default one.
    const subscription = normalizeGenerationSubscription({ filePath, handler } as never);
    assert.equal(typeof subscription.root, "function");
    assert.equal(subscription.root(), undefined);
  });

  it("treats a script-changed object with no root the same way", () => {
    const subscription = normalizeScriptChangedSubscription({ filePath, ownOrigin: "view-1", handler } as never);
    assert.equal(subscription.root(), undefined);
    assert.equal(subscription.ownOrigin, "view-1");
  });

  it("throws at the subscribe call for a non-function root", () => {
    assert.throws(() => normalizeGenerationSubscription({ filePath, root: "repoA", handler } as never), /root must be a function/);
  });

  it("throws at the subscribe call for a missing filePath or handler", () => {
    assert.throws(() => normalizeGenerationSubscription({ handler } as never), /filePath and handler/);
    assert.throws(() => normalizeGenerationSubscription({ filePath } as never), /filePath and handler/);
    assert.throws(() => normalizeScriptChangedSubscription({ ownOrigin: "view-1", handler } as never), /filePath and handler/);
  });

  it("throws for a script-changed object with no ownOrigin", () => {
    assert.throws(() => normalizeScriptChangedSubscription({ filePath, handler } as never), /ownOrigin must be a string/);
  });
});

describe("a root getter that returns a non-string cannot break delivery", () => {
  // The exact path Codex named (P2 on #3015): the object form only checks that
  // `root` is CALLABLE, so an untyped caller can pass `{ root: () => 42 }`.
  // The subscriber then evaluates it during pubsub delivery and hands the
  // result to `sameRoot` — which used to throw from inside the callback, where
  // nothing catches it and the View just stops updating.
  //
  // Evaluating the getter at subscribe time would not help: it is a getter
  // precisely because its answer changes. So the value is made safe where it
  // is USED, and this test drives that boundary the way the subscriber does.
  const filePath = (): string => "stories/deck.json";
  const handler = (): void => {};

  it("accepts the subscription and never throws when the getter is evaluated", () => {
    const subscription = normalizeGenerationSubscription({ filePath, root: () => 42, handler } as never);
    assert.doesNotThrow(() => sameRoot("repoA", subscription.root()));
    assert.doesNotThrow(() => sameRoot(undefined, subscription.root()));
  });

  it("treats the malformed answer as the default root", () => {
    // Not as a match for every named root, which is the failure that would
    // route another repository's events to this View.
    const subscription = normalizeGenerationSubscription({ filePath, root: () => 42, handler } as never);
    assert.equal(sameRoot("repoA", subscription.root()), false);
    assert.equal(sameRoot(undefined, subscription.root()), true);
  });
});
