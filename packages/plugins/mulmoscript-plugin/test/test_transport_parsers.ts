// The pubsub boundary must not drop `root` (#3014).
//
// Four separate rounds of #3015 had the same shape: a comparison or a key was
// widened to the pair `(root, filePath)`, while the path that CARRIES the root
// to it was not. The parsers here are the last such path — they rebuild each
// event field by field, so any field nobody listed is silently discarded, and
// a downstream pair check then compares `undefined` against every named root
// and filters out exactly the events it was written to route.
//
// A round trip is the only assertion that catches that class: it fails when a
// field is added to the contract and not to the parser.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseGenerationEvent, parseScriptChangedEvent } from "../src/vue/transport";
import type { MulmoScriptChangedEvent, MulmoScriptGenerationEvent } from "../src/core/contract";

describe("the pubsub boundary preserves the root", () => {
  it("keeps `root` on a generation event", () => {
    const wire: MulmoScriptGenerationEvent = { kind: "movie", filePath: "stories/deck.json", key: "", done: false, root: "repoA" };
    assert.deepEqual(parseGenerationEvent(wire), wire);
  });

  it("keeps `root` on a script-changed event", () => {
    const wire: MulmoScriptChangedEvent = { filePath: "stories/deck.json", origin: "view-1", root: "repoA" };
    assert.deepEqual(parseScriptChangedEvent(wire), wire);
  });

  it("omits `root` when the server omitted it, so the default root round-trips unchanged", () => {
    // A pre-#3014 event must survive byte for byte: the downstream comparison
    // normalizes absent to the default, and an invented `root: ""` would be a
    // different shape on the wire for no reason.
    const generation = { kind: "movie", filePath: "stories/deck.json", key: "", done: true };
    assert.deepEqual(parseGenerationEvent(generation), generation);
    const changed = { filePath: "stories/deck.json" };
    assert.deepEqual(parseScriptChangedEvent(changed), changed);
  });

  it("drops a non-string root rather than passing it through", () => {
    const parsed = parseGenerationEvent({ kind: "movie", filePath: "stories/deck.json", key: "", done: false, root: 42 });
    assert.ok(parsed);
    assert.ok(!("root" in parsed), "a malformed root must not reach the comparison");
  });
});
